'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Unit tests for src/notice.js: formatResultError (the decision logic that
// keeps renderer.js honest about WHEN to surface an error) and showNotice's
// DOM structure, driven through a tiny fake document (no JSDOM, in keeping
// with the suite). Layout itself is guarded in the browser by
// e2e/responsive.e2e.js.

let mod;

describe('src/notice.js', () => {
  before(async () => {
    // notice.js imports welcome.js (for prefersReducedMotion), which reads
    // navigator lazily — safe to import without browser globals.
    mod = await import('../src/notice.js');
  });

  describe('formatResultError()', () => {
    test('success → null (nothing to report)', () => {
      assert.equal(mod.formatResultError({ ok: true }, 'Save'), null);
      assert.equal(mod.formatResultError({ ok: true, filePath: 'a.txt' }, 'Save'), null);
    });

    test('unconfirmed download-fallback save is still ok → null', () => {
      assert.equal(mod.formatResultError({ ok: true, unconfirmed: true }, 'Save'), null);
    });

    test('a canceled picker is a user decision → null', () => {
      assert.equal(mod.formatResultError({ ok: false, canceled: true }, 'Open'), null);
    });

    test('missing result (desktop no-op paths) → null', () => {
      assert.equal(mod.formatResultError(undefined, 'Save'), null);
      assert.equal(mod.formatResultError(null, 'Open'), null);
    });

    test('failure with an error message includes it', () => {
      assert.equal(
        mod.formatResultError({ ok: false, error: 'Write permission denied' }, 'Save'),
        'Save failed — Write permission denied'
      );
      assert.equal(
        mod.formatResultError({ ok: false, error: 'File too large (25 MB max)' }, 'Open'),
        'Open failed — File too large (25 MB max)'
      );
    });

    test('failure without detail still reports the verb', () => {
      assert.equal(mod.formatResultError({ ok: false }, 'Save'), 'Save failed');
      assert.equal(mod.formatResultError({ ok: false, error: '' }, 'Open'), 'Open failed');
    });
  });

  describe('showNotice() structure', () => {
    let region;
    function fakeEl(tag) {
      const listeners = {};
      const classes = new Set();
      const el = {
        tagName: tag.toUpperCase(),
        children: [],
        parent: null,
        textContent: '',
        attrs: {},
        get className() { return [...classes].join(' '); },
        set className(v) {
          classes.clear();
          String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
        },
        classList: {
          add: (c) => classes.add(c),
          remove: (c) => classes.delete(c),
          contains: (c) => classes.has(c)
        },
        setAttribute(k, v) { el.attrs[k] = String(v); },
        addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
        removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
        appendChild(c) { c.parent = el; el.children.push(c); return c; },
        remove() {
          if (!el.parent) return;
          el.parent.children = el.parent.children.filter((c) => c !== el);
          el.parent = null;
        },
        get isConnected() { let n = el; while (n.parent) n = n.parent; return n === region; },
        click() { (listeners.click || []).forEach((fn) => fn({})); }
      };
      return el;
    }

    before(() => {
      region = fakeEl('div');
      globalThis.document = {
        getElementById: (id) => (id === 'notice-region' ? region : null),
        createElement: fakeEl
      };
      // Reduced motion → dismiss removes synchronously (no animationend wait).
      globalThis.window = { matchMedia: () => ({ matches: true }) };
    });
    // Leave no globals behind for other tests in this process.
    after(() => { delete globalThis.document; delete globalThis.window; });

    const classesOf = (n) => n.className.split(' ');

    test('actions are grouped in one .notice-actions container (the #75 layout hook)', () => {
      region.children = [];
      const { el } = mod.showNotice('Recovered “a.txt” from 2 minutes ago.', {
        sticky: true,
        actions: [{ label: 'Restore', onClick() {} }, { label: 'Discard', onClick() {} }]
      });
      assert.deepEqual(classesOf(el).sort(), ['notice', 'notice-with-actions']);
      // Order matters for the grid areas + DOM/tab order: text → actions → ✕.
      assert.deepEqual(el.children.map((c) => c.className), ['notice-text', 'notice-actions', 'notice-dismiss']);
      const group = el.children[1];
      assert.deepEqual(group.children.map((b) => b.textContent), ['Restore', 'Discard']);
      assert.ok(group.children.every((b) => b.className === 'notice-action' && b.type === 'button'));
      assert.equal(el.children[2].attrs['aria-label'], 'Dismiss notice');
    });

    test('a plain notice has no actions container or modifier class', () => {
      region.children = [];
      const { el } = mod.showNotice('Save failed — Disk full', { kind: 'error', sticky: true });
      assert.deepEqual(classesOf(el).sort(), ['notice', 'notice-error']);
      assert.deepEqual(el.children.map((c) => c.className), ['notice-text', 'notice-dismiss']);
      // textContent, never HTML: the message is rendered verbatim.
      assert.equal(el.children[0].textContent, 'Save failed — Disk full');
    });

    test('an action returning false keeps the notice; otherwise it dismisses', () => {
      region.children = [];
      let dismissed = 0;
      const { el } = mod.showNotice('x', {
        sticky: true,
        onDismiss: () => { dismissed++; },
        actions: [{ label: 'Keep', onClick: () => false }, { label: 'Go', onClick() {} }]
      });
      const [keep, go] = el.children[1].children;
      keep.click();
      assert.ok(el.isConnected, 'declined action leaves the notice up');
      assert.equal(dismissed, 0);
      go.click();
      assert.equal(el.isConnected, false, 'accepted action dismisses');
      assert.equal(dismissed, 1, 'onDismiss fires exactly once');
    });
  });
});

