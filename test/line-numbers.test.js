'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Tests for src/line-numbers.js, covering the gutter-alignment bug from the
// screenshots: line numbers drifting off their text on wrapped lines and after
// the find bar resized the editor, plus the page scrolling past the last line.
//
//  - buildGutterTokens() pins down the wrap-row math (a wrapped line must emit
//    blank continuation tokens so the numbers stay on their rows).
//  - the initLineNumbers() wiring test pins down that the gutter re-measures
//    when the editor's *box* changes size (not just on window resize) — the
//    gap that let the numbers go stale when find opened.
//  - the CSS guard pins down that the measurement mirror stays clipped so its
//    full-document height can't inflate the page's scroll area.

async function freshLineNumbers() {
  const cb = `?cb=${Date.now()}-${Math.random()}`;
  return await import('../src/line-numbers.js' + cb);
}

describe('buildGutterTokens()', () => {
  test('one token per line when nothing wraps', async () => {
    const { buildGutterTokens } = await freshLineNumbers();
    assert.deepEqual(buildGutterTokens([20, 20, 20], 20), ['1', '2', '3']);
  });

  test('a wrapped line gets blank continuation tokens', async () => {
    const { buildGutterTokens } = await freshLineNumbers();
    // middle line is 3 rows tall: its number, then two blanks
    assert.deepEqual(buildGutterTokens([20, 60, 20], 20), ['1', '2', '', '', '3']);
  });

  test('total tokens equal the document total visual rows', async () => {
    const { buildGutterTokens } = await freshLineNumbers();
    const tokens = buildGutterTokens([20, 40, 20, 80], 20);
    assert.equal(tokens.length, 1 + 2 + 1 + 4);
    // every number lands on the first row of its logical line
    assert.equal(tokens[0], '1');
    assert.equal(tokens[1], '2');
    assert.equal(tokens[3], '3');
    assert.equal(tokens[4], '4');
  });

  test('rounds to the nearest row and never drops below one', async () => {
    const { buildGutterTokens } = await freshLineNumbers();
    // 0 -> 1 row, 25/20=1.25 -> 1 row, 31/20=1.55 -> 2 rows
    assert.deepEqual(buildGutterTokens([0, 25, 31], 20), ['1', '2', '3', '']);
  });

  test('falls back to a sane line-height when given 0', async () => {
    const { buildGutterTokens } = await freshLineNumbers();
    assert.deepEqual(buildGutterTokens([20, 20], 0), ['1', '2']);
  });
});

// --- DOM-mock wiring test: the gutter re-renders on editor resize ---

function installDom({ lineHeight = 20 } = {}) {
  const resizeObservers = [];
  const mk = (extra = {}) => Object.assign({ style: {}, addEventListener() {} }, extra);

  const gutterInner = mk({ textContent: '' });
  const gutter = mk();
  const mirror = mk({
    children: [],
    replaceChildren(frag) { this.children = frag ? frag._kids.slice() : []; },
  });
  const editor = mk({ value: '', clientWidth: 300, scrollTop: 0 });

  const byId = {
    'text-editor': editor,
    'line-gutter': gutter,
    'line-gutter-inner': gutterInner,
    'editor-mirror': mirror,
  };

  globalThis.document = {
    getElementById: (id) => byId[id] || null,
    createElement: () => {
      const d = { _text: '' };
      Object.defineProperty(d, 'textContent', { get() { return d._text; }, set(v) { d._text = v; } });
      // One row per div — enough to prove a re-render happens on resize.
      Object.defineProperty(d, 'offsetHeight', { get() { return lineHeight; } });
      return d;
    },
    createDocumentFragment: () => ({ _kids: [], appendChild(k) { this._kids.push(k); } }),
  };
  globalThis.window = { addEventListener() {} };
  globalThis.getComputedStyle = () => ({ lineHeight: lineHeight + 'px' });
  globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; resizeObservers.push(this); }
    observe(target) { this.target = target; }
    unobserve() {}
    disconnect() {}
  };
  return { editor, gutter, gutterInner, mirror, resizeObservers };
}

describe('initLineNumbers() wiring', () => {
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.getComputedStyle;
    delete globalThis.requestAnimationFrame;
    delete globalThis.ResizeObserver;
  });

  test('re-renders the gutter when the editor box resizes (find bar, keyboard, scrollbar)', async () => {
    const dom = installDom();
    const { initLineNumbers } = await freshLineNumbers();

    dom.editor.value = 'alpha\nbeta';
    initLineNumbers();
    assert.equal(dom.gutterInner.textContent, '1\n2', 'initial render numbers both lines');
    assert.equal(dom.resizeObservers.length, 1, 'observes the editor for size changes');
    assert.equal(dom.resizeObservers[0].target, dom.editor, 'the observed node is the editor');

    // The editor box changes (e.g. the find bar opens) and the text reflows.
    // Firing the observer must re-measure — otherwise the numbers go stale and
    // drift away from their lines, which is exactly the reported bug.
    dom.editor.value = 'alpha\nbeta\ngamma\ndelta';
    dom.resizeObservers[0].cb();
    assert.equal(dom.gutterInner.textContent, '1\n2\n3\n4', 'gutter re-rendered after resize');
  });
});

// --- CSS regression guard: the measurement mirror must stay clipped ---

describe('measurement mirror CSS', () => {
  test('#editor-mirror is clipped so it cannot inflate page scroll', () => {
    const css = fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8');
    const block = css.match(/#editor-mirror\s*\{[^}]*\}/);
    assert.ok(block, '#editor-mirror rule block exists');
    assert.match(block[0], /height:\s*0/, 'mirror sets height:0');
    assert.match(block[0], /overflow:\s*hidden/, 'mirror sets overflow:hidden');
  });
});
