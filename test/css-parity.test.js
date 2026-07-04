'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Text-layout parity guard for the find-highlight / line-number machinery.
//
// #text-editor (the real textarea), #editor-highlights-inner (the find-match
// overlay), and #editor-mirror (the wrap-measurement mirror) MUST share
// identical text-layout CSS. If any of font, size, line-height, tab-size,
// padding, or wrap behaviour drifts on one of them, find marks paint behind
// the wrong glyphs and gutter numbers slide off their lines — silently.
// Same for the touch-viewport 16px bump: all three must move together.
//
// This is a source-text check (no browser), so it can only guard the
// declared values — but declared-value drift is exactly how this breaks.

const CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

const IDS = ['#text-editor', '#editor-highlights-inner', '#editor-mirror'];
const PARITY_PROPS = [
  'font-family', 'font-size', 'line-height', 'tab-size', '-moz-tab-size',
  'padding', 'box-sizing', 'white-space', 'overflow-wrap', 'word-break'
];

// Minimal CSS block parser: strips comments, tracks @media nesting, skips
// @keyframes bodies, and returns { selector, body, media } per rule.
function parseCss(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const mediaStack = [];
  let buf = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      const sel = buf.trim();
      buf = '';
      i++;
      if (sel.startsWith('@media') || sel.startsWith('@supports')) {
        mediaStack.push(sel);
        continue;
      }
      if (sel.startsWith('@keyframes')) {
        let depth = 1;
        while (i < src.length && depth > 0) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') depth--;
          i++;
        }
        continue;
      }
      const end = src.indexOf('}', i);
      rules.push({ selector: sel, body: src.slice(i, end), media: mediaStack.join(' && ') });
      i = end + 1;
      continue;
    }
    if (ch === '}') {
      mediaStack.pop();
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  return rules;
}

function declsOf(body) {
  const map = {};
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    map[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).trim();
  }
  return map;
}

// Merge every top-level (non-media) rule whose selector list contains the
// BARE id (not #id:focus / #id mark / #id > div) — later rules win, like
// the cascade at equal specificity.
function mergedDecls(rules, id) {
  const out = {};
  for (const r of rules) {
    if (r.media) continue;
    const selectors = r.selector.split(',').map((s) => s.trim());
    if (!selectors.includes(id)) continue;
    Object.assign(out, declsOf(r.body));
  }
  return out;
}

const rules = parseCss(CSS);

describe('editor / highlights / mirror text-layout parity (styles.css)', () => {
  const decls = Object.fromEntries(IDS.map((id) => [id, mergedDecls(rules, id)]));

  for (const prop of PARITY_PROPS) {
    test(`'${prop}' is identical across the three layers`, () => {
      const editorVal = decls['#text-editor'][prop];
      assert.ok(editorVal !== undefined,
        `#text-editor no longer declares '${prop}' — update this test's PARITY_PROPS with care`);
      for (const id of IDS.slice(1)) {
        assert.equal(
          decls[id][prop], editorVal,
          `${id} '${prop}' (${decls[id][prop]}) differs from #text-editor (${editorVal}) — ` +
          'find marks / gutter numbers will silently drift. Change all three together.'
        );
      }
    });
  }

  test('media-scoped parity-prop overrides always cover all three layers', () => {
    // A viewport-conditional override of any text-layout prop on ONE layer
    // (e.g. a mobile-only font-size on the textarea alone) drifts the marks
    // exactly like a top-level change would — but only on that viewport.
    // For every @media condition, any parity prop declared for one of the
    // three ids must be declared identically for all three.
    const byMedia = new Map();
    for (const r of rules) {
      if (!r.media) continue;
      const d = declsOf(r.body);
      const selectors = r.selector.split(',').map((s) => s.trim());
      for (const id of IDS) {
        if (!selectors.includes(id)) continue;
        if (!byMedia.has(r.media)) byMedia.set(r.media, {});
        const perId = byMedia.get(r.media);
        perId[id] = Object.assign(perId[id] || {}, d);
      }
    }
    for (const [media, perId] of byMedia) {
      const declaredProps = new Set();
      for (const id of Object.keys(perId)) {
        for (const p of Object.keys(perId[id])) {
          if (PARITY_PROPS.includes(p)) declaredProps.add(p);
        }
      }
      for (const prop of declaredProps) {
        const values = IDS.map((id) => (perId[id] || {})[prop]);
        for (const [i, id] of IDS.entries()) {
          assert.equal(
            values[i], values[0],
            `In ${media}: ${id} '${prop}' (${values[i]}) diverges from ${IDS[0]} (${values[0]}) — ` +
            'a media-scoped layout change must cover all three layers.'
          );
        }
      }
    }
  });

  test('the touch-viewport font-size bump covers all three layers together', () => {
    // The 16px lift (defeats iOS auto-zoom) must apply to the textarea AND
    // both mirrors, or character positions drift only on phones.
    const touchRules = rules.filter((r) =>
      r.media.includes('any-hover: none') && r.media.includes('pointer: coarse'));
    assert.ok(touchRules.length > 0, 'expected a touch-viewport @media block');

    const sizes = {};
    for (const r of touchRules) {
      const d = declsOf(r.body);
      if (!d['font-size']) continue;
      for (const sel of r.selector.split(',').map((s) => s.trim())) {
        if (IDS.includes(sel)) sizes[sel] = d['font-size'];
      }
    }
    for (const id of IDS) {
      assert.ok(sizes[id], `${id} is missing from the touch font-size bump`);
      assert.equal(sizes[id], sizes['#text-editor'],
        `${id} touch font-size (${sizes[id]}) differs from #text-editor (${sizes['#text-editor']})`);
    }
  });
});
