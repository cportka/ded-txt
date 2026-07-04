'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Pure-logic tests for src/find.js. The DOM-side `installFind` is exercised
// by the smoke checks in the renderer; here we pin down the search-and-
// replace math so a future "minor cleanup" can't quietly drop $1 backrefs
// or whole-word semantics.

async function freshFind() {
  // Cache-bust so each test re-imports cleanly (no shared state to reset,
  // but keeps the pattern uniform with web-platform.test.js).
  const cb = `?cb=${Date.now()}-${Math.random()}`;
  return await import('../src/find.js' + cb);
}

describe('escapeRegex()', () => {
  test('escapes the canonical regex metacharacters', async () => {
    const { escapeRegex } = await freshFind();
    assert.equal(escapeRegex('a.b*c+d?'), 'a\\.b\\*c\\+d\\?');
    assert.equal(escapeRegex('(x)[y]{z}'), '\\(x\\)\\[y\\]\\{z\\}');
    assert.equal(escapeRegex('a|b\\c'), 'a\\|b\\\\c');
    assert.equal(escapeRegex('plain'), 'plain');
  });
});

describe('compilePattern()', () => {
  test('null query → null pattern', async () => {
    const { compilePattern } = await freshFind();
    assert.equal(compilePattern('', {}), null);
  });

  test('plain query is case-insensitive by default', async () => {
    const { compilePattern } = await freshFind();
    const re = compilePattern('foo', {});
    assert.ok(re instanceof RegExp);
    assert.equal(re.flags, 'gi');
  });

  test('case-sensitive when opts.case', async () => {
    const { compilePattern } = await freshFind();
    const re = compilePattern('foo', { case: true });
    assert.equal(re.flags, 'g');
  });

  test('regex mode passes source through unescaped', async () => {
    const { compilePattern } = await freshFind();
    const re = compilePattern('a.b', { regex: true });
    assert.equal(re.source, 'a.b');
    assert.ok(re.test('axb'));
  });

  test('invalid regex returns null instead of throwing', async () => {
    const { compilePattern } = await freshFind();
    assert.equal(compilePattern('[unclosed', { regex: true }), null);
  });

  test('whole-word wraps in \\b boundaries', async () => {
    const { compilePattern } = await freshFind();
    const re = compilePattern('cat', { word: true });
    assert.equal(re.source, '\\bcat\\b');
    assert.ok(re.test('the cat sat'));
    re.lastIndex = 0;
    assert.ok(!re.test('concatenate'));
  });
});

describe('buildMatches()', () => {
  test('finds every occurrence and reports [start, end] tuples', async () => {
    const { buildMatches } = await freshFind();
    assert.deepEqual(
      buildMatches('foo bar foo baz foo', 'foo', {}),
      [[0, 3], [8, 11], [16, 19]]
    );
  });

  test('case-insensitive by default', async () => {
    const { buildMatches } = await freshFind();
    assert.deepEqual(buildMatches('Foo FOO foo', 'foo', {}), [[0, 3], [4, 7], [8, 11]]);
  });

  test('case-sensitive when opts.case', async () => {
    const { buildMatches } = await freshFind();
    assert.deepEqual(buildMatches('Foo FOO foo', 'foo', { case: true }), [[8, 11]]);
  });

  test('whole-word filters substring hits', async () => {
    const { buildMatches } = await freshFind();
    assert.deepEqual(
      buildMatches('the cat is in concatenate', 'cat', { word: true }),
      [[4, 7]]
    );
  });

  test('regex mode evaluates the pattern as-is', async () => {
    const { buildMatches } = await freshFind();
    assert.deepEqual(
      buildMatches('a1 b2 c3', '[a-z]\\d', { regex: true, case: true }),
      [[0, 2], [3, 5], [6, 8]]
    );
  });

  test('zero-length matches do not infinite-loop', async () => {
    const { buildMatches } = await freshFind();
    // \b matches between word/non-word chars — many zero-length positions.
    const matches = buildMatches('a b', '\\b', { regex: true });
    assert.ok(matches.length >= 4, 'should return word boundaries without hanging');
  });

  test('invalid regex returns []', async () => {
    const { buildMatches } = await freshFind();
    assert.deepEqual(buildMatches('anything', '(', { regex: true }), []);
  });

  test('empty query returns []', async () => {
    const { buildMatches } = await freshFind();
    assert.deepEqual(buildMatches('text', '', {}), []);
  });
});

describe('applyReplaceAll()', () => {
  test('replaces every match and returns the count', async () => {
    const { applyReplaceAll } = await freshFind();
    const res = applyReplaceAll('foo bar foo baz', 'foo', 'XYZ', {});
    assert.equal(res.text, 'XYZ bar XYZ baz');
    assert.equal(res.count, 2);
  });

  test('no matches → unchanged text, count 0', async () => {
    const { applyReplaceAll } = await freshFind();
    const res = applyReplaceAll('hello', 'world', 'X', {});
    assert.equal(res.text, 'hello');
    assert.equal(res.count, 0);
  });

  test('plain mode treats $1 as a literal in the replacement', async () => {
    const { applyReplaceAll } = await freshFind();
    const res = applyReplaceAll('foo', 'foo', '$1', {});
    assert.equal(res.text, '$1');
  });

  test('regex mode honours $1 backrefs in the replacement', async () => {
    const { applyReplaceAll } = await freshFind();
    const res = applyReplaceAll('Alice and Bob', '(\\w+) and (\\w+)', '$2 and $1', { regex: true });
    assert.equal(res.text, 'Bob and Alice');
    assert.equal(res.count, 1);
  });

  test('whole-word leaves substring matches intact', async () => {
    const { applyReplaceAll } = await freshFind();
    const res = applyReplaceAll('cat concatenate cat', 'cat', 'dog', { word: true });
    assert.equal(res.text, 'dog concatenate dog');
    assert.equal(res.count, 2);
  });

  test('replace-all is idempotent on its own output when target ≠ replacement', async () => {
    const { applyReplaceAll } = await freshFind();
    const first = applyReplaceAll('aaa', 'a', 'b', {});
    const second = applyReplaceAll(first.text, 'a', 'b', {});
    assert.equal(first.text, 'bbb');
    assert.equal(second.count, 0);
  });

  test('empty query → no-op', async () => {
    const { applyReplaceAll } = await freshFind();
    const res = applyReplaceAll('anything', '', 'X', {});
    assert.equal(res.text, 'anything');
    assert.equal(res.count, 0);
  });
});

describe('escapeHtml()', () => {
  test('escapes only & < > (text-content position is otherwise safe)', async () => {
    const { escapeHtml } = await freshFind();
    assert.equal(escapeHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
    assert.equal(escapeHtml('"quotes" stay \'as-is\''), '"quotes" stay \'as-is\'');
  });
});

describe('buildHighlightHtml()', () => {
  test('reproduces the full text with a mark around each match', async () => {
    const { buildHighlightHtml } = await freshFind();
    const html = buildHighlightHtml('foo bar foo', [[0, 3], [8, 11]], 0);
    assert.equal(
      html,
      '<mark class="find-match find-match-active">foo</mark> bar <mark class="find-match">foo</mark>'
    );
  });

  test('keeps the unmatched tail so overlay wrapping matches the textarea', async () => {
    const { buildHighlightHtml } = await freshFind();
    // Emitting only the matched spans (dropping " world") would let the overlay
    // wrap differently from the textarea — the exact cause of drifting marks.
    const html = buildHighlightHtml('hello world', [[0, 5]], 0);
    assert.ok(html.endsWith(' world'), 'trailing context preserved');
  });

  test('only the active index carries find-match-active', async () => {
    const { buildHighlightHtml } = await freshFind();
    const html = buildHighlightHtml('a a a', [[0, 1], [2, 3], [4, 5]], 1);
    assert.equal((html.match(/find-match-active/g) || []).length, 1);
    const marks = html.match(/<mark class="[^"]*">/g);
    assert.ok(!marks[0].includes('find-match-active'));
    assert.ok(marks[1].includes('find-match-active'));
    assert.ok(!marks[2].includes('find-match-active'));
  });

  test('no active class when nothing is active (idx -1)', async () => {
    const { buildHighlightHtml } = await freshFind();
    assert.ok(!buildHighlightHtml('xx', [[0, 1]], -1).includes('find-match-active'));
  });

  test('escapes &<> in both matched and surrounding text', async () => {
    const { buildHighlightHtml } = await freshFind();
    // match [1,4] covers "<b>"; the surrounds are "a" and "&c"
    const html = buildHighlightHtml('a<b>&c', [[1, 4]], -1);
    assert.equal(html, 'a<mark class="find-match">&lt;b&gt;</mark>&amp;c');
  });

  test('adjacent matches leave no gap between marks', async () => {
    const { buildHighlightHtml } = await freshFind();
    const html = buildHighlightHtml('abcd', [[0, 2], [2, 4]], 0);
    assert.equal(
      html,
      '<mark class="find-match find-match-active">ab</mark><mark class="find-match">cd</mark>'
    );
  });

  test('no matches → plain escaped text', async () => {
    const { buildHighlightHtml } = await freshFind();
    assert.equal(buildHighlightHtml('a<b', [], -1), 'a&lt;b');
  });
});

describe('nextFocusIndex()', () => {
  const ROW = { count: 5, isInput: false };

  test('Right/Down advance, Left/Up retreat (on a button)', async () => {
    const { nextFocusIndex } = await freshFind();
    assert.equal(nextFocusIndex({ ...ROW, index: 1, key: 'ArrowRight' }), 2);
    assert.equal(nextFocusIndex({ ...ROW, index: 1, key: 'ArrowDown' }), 2);
    assert.equal(nextFocusIndex({ ...ROW, index: 3, key: 'ArrowLeft' }), 2);
    assert.equal(nextFocusIndex({ ...ROW, index: 3, key: 'ArrowUp' }), 2);
  });

  test('wraps around both ends', async () => {
    const { nextFocusIndex } = await freshFind();
    assert.equal(nextFocusIndex({ ...ROW, index: 4, key: 'ArrowRight' }), 0);
    assert.equal(nextFocusIndex({ ...ROW, index: 0, key: 'ArrowLeft' }), 4);
  });

  test('non-arrow keys are ignored (-1)', async () => {
    const { nextFocusIndex } = await freshFind();
    assert.equal(nextFocusIndex({ ...ROW, index: 1, key: 'Tab' }), -1);
    assert.equal(nextFocusIndex({ ...ROW, index: 1, key: 'Enter' }), -1);
    assert.equal(nextFocusIndex({ ...ROW, index: 1, key: 'a' }), -1);
  });

  test('in an input, Left/Right move the caret until it is at the edge', async () => {
    const { nextFocusIndex } = await freshFind();
    // Caret mid-text: let the browser move it (-1), do not change focus.
    assert.equal(
      nextFocusIndex({ count: 5, index: 0, key: 'ArrowRight', isInput: true, atStart: false, atEnd: false }),
      -1
    );
    assert.equal(
      nextFocusIndex({ count: 5, index: 2, key: 'ArrowLeft', isInput: true, atStart: false, atEnd: false }),
      -1
    );
    // Caret at the edge: cross into the neighbouring control.
    assert.equal(
      nextFocusIndex({ count: 5, index: 0, key: 'ArrowRight', isInput: true, atStart: false, atEnd: true }),
      1
    );
    assert.equal(
      nextFocusIndex({ count: 5, index: 2, key: 'ArrowLeft', isInput: true, atStart: true, atEnd: false }),
      1
    );
  });

  test('in an input, Up/Down always move regardless of caret position', async () => {
    const { nextFocusIndex } = await freshFind();
    assert.equal(
      nextFocusIndex({ count: 5, index: 0, key: 'ArrowDown', isInput: true, atStart: false, atEnd: false }),
      1
    );
    assert.equal(
      nextFocusIndex({ count: 5, index: 2, key: 'ArrowUp', isInput: true, atStart: false, atEnd: false }),
      1
    );
  });

  test('guards against an empty list or an out-of-range index (-1)', async () => {
    const { nextFocusIndex } = await freshFind();
    assert.equal(nextFocusIndex({ count: 0, index: 0, key: 'ArrowRight' }), -1);
    assert.equal(nextFocusIndex({ count: 3, index: -1, key: 'ArrowRight' }), -1);
    assert.equal(nextFocusIndex({ count: 3, index: 5, key: 'ArrowRight' }), -1);
  });
});

// --- Overlay structure: marks below the first screenful must still render ---
//
// The reported bug was that only matches in the initial viewport highlighted.
// Root cause: the overlay was a single element that both clipped
// (overflow:hidden) and carried the transformed text, so CSS clipped every
// off-screen match before the transform could reveal it. The fix splits it
// into a fixed clip window (#editor-highlights) + a transformed full-height
// inner (#editor-highlights-inner), mirroring #line-gutter / -inner.

describe('find overlay structure', () => {
  test('index.html nests #editor-highlights-inner inside #editor-highlights', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
    assert.match(html, /<div id="editor-highlights"[^>]*>\s*<div id="editor-highlights-inner">/);
  });

  test('outer #editor-highlights clips; inner carries the scroll-sync transform', () => {
    const css = fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8');
    const outer = css.match(/#editor-highlights\s*\{[^}]*\}/);
    assert.ok(outer, '#editor-highlights rule exists');
    assert.match(outer[0], /overflow:\s*hidden/, 'outer is the clip window');
    const inner = css.match(/#editor-highlights-inner\s*\{[^}]*\}/);
    assert.ok(inner, '#editor-highlights-inner rule exists');
    assert.match(inner[0], /will-change:\s*transform/, 'inner is the scroll-synced layer');
  });
});

// --- DOM-mock wiring test: marks + transform target the inner, not the outer ---

function makeEl(over = {}) {
  const e = {
    hidden: false,
    value: '',
    style: { setProperty() {} },
    _attrs: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    removeEventListener() {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    focus() {},
    select() {},
    setSelectionRange() {},
    replaceChildren() { this.innerHTML = ''; },
    querySelector() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 600, bottom: 500, width: 600, height: 500 }; },
    offsetTop: 0, offsetLeft: 40, offsetWidth: 1, clientWidth: 600, scrollTop: 0,
  };
  return Object.assign(e, over);
}

describe('installFind() overlay wiring', () => {
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
  });

  test('marks + scroll transform land on the inner layer; geometry on the outer', async () => {
    const bar = makeEl();
    const findInput = makeEl({ value: '' });
    const counter = makeEl();
    const wrap = makeEl();
    const highlightsInner = makeEl();
    const highlights = makeEl({
      querySelector(sel) {
        return sel.indexOf('find-match-active') !== -1
          ? { getBoundingClientRect: () => ({ top: 100, left: 0, right: 50, bottom: 114, width: 50, height: 14 }) }
          : null;
      },
    });
    const editor = makeEl({ value: 'x chris y chris z' });

    const byId = {
      'find-bar': bar,
      'find-input': findInput,
      'find-counter': counter,
      'editor-wrap': wrap,
      'editor-highlights': highlights,
      'editor-highlights-inner': highlightsInner,
    };
    globalThis.document = { getElementById: (id) => byId[id] || null, addEventListener() {} };
    globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: true }) };

    const { installFind } = await freshFind();
    installFind({ editor }).open('chris');

    // Inner gets the marks and the scroll-sync transform...
    assert.match(highlightsInner.innerHTML, /<mark/, 'marks render into the inner layer');
    assert.match(highlightsInner.style.transform, /translateY/, 'inner carries the scroll transform');
    // ...the outer stays a bare clip window: geometry only, never the content.
    assert.equal(highlights.innerHTML, undefined, 'outer clip window never holds the marks');
    assert.ok(highlights.style.width, 'outer clip window receives the box geometry');
  });

  test('open() prefills the query and parks the caret at its end (not selected)', async () => {
    const sel = [];
    const findInput = makeEl({ value: '', setSelectionRange(s, e) { sel.length = 0; sel.push(s, e); } });
    const editor = makeEl({ value: 'x chris y' });
    const byId = {
      'find-bar': makeEl(),
      'find-input': findInput,
      'find-counter': makeEl(),
      'editor-wrap': makeEl(),
      'editor-highlights': makeEl(),
      'editor-highlights-inner': makeEl(),
    };
    globalThis.document = { getElementById: (id) => byId[id] || null, addEventListener() {} };
    globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: true }) };

    const { installFind } = await freshFind();
    installFind({ editor }).open('chris');

    assert.equal(findInput.value, 'chris', 'query prefilled');
    assert.deepEqual(sel, [5, 5], 'caret parked at the end, nothing selected');
  });
});

describe('findRefreshDelay() — large-document debounce policy', () => {
  test('small documents search on every keystroke (0 delay)', async () => {
    const { findRefreshDelay } = await freshFind();
    assert.equal(findRefreshDelay(0), 0);
    assert.equal(findRefreshDelay(10_000), 0);
  });

  test('documents at/over the threshold wait for a typing pause', async () => {
    const { findRefreshDelay, FIND_DEBOUNCE_THRESHOLD, FIND_DEBOUNCE_MS } = await freshFind();
    assert.equal(findRefreshDelay(FIND_DEBOUNCE_THRESHOLD), FIND_DEBOUNCE_MS);
    assert.equal(findRefreshDelay(FIND_DEBOUNCE_THRESHOLD * 10), FIND_DEBOUNCE_MS);
  });

  test('the boundary sits exactly at the threshold', async () => {
    const { findRefreshDelay, FIND_DEBOUNCE_THRESHOLD } = await freshFind();
    assert.equal(findRefreshDelay(FIND_DEBOUNCE_THRESHOLD - 1), 0);
  });
});
