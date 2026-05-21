'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

function setNav(platform, userAgent = '') {
  // Node 21+ exposes `navigator` as a getter-only global. Use defineProperty
  // so this works regardless of whether the platform's `navigator` is the
  // built-in or already overridden.
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform, userAgent },
    configurable: true,
    writable: true
  });
}

let mod;

describe('src/welcome.js', () => {
  before(async () => {
    // welcome.js reads navigator only at call time, so a default at import is fine.
    setNav('Linux x86_64');
    mod = await import('../src/welcome.js');
  });

  describe('isMac()', () => {
    test('true for MacIntel platform', () => {
      setNav('MacIntel');
      assert.equal(mod.isMac(), true);
    });

    test('true for iPhone platform', () => {
      setNav('iPhone');
      assert.equal(mod.isMac(), true);
    });

    test('false for Win32', () => {
      setNav('Win32');
      assert.equal(mod.isMac(), false);
    });

    test('false for Linux x86_64', () => {
      setNav('Linux x86_64');
      assert.equal(mod.isMac(), false);
    });

    test('falls back to /Mac/ in userAgent when platform is empty', () => {
      setNav('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)');
      assert.equal(mod.isMac(), true);
    });
  });

  describe('shortcutMap()', () => {
    test('on Mac uses Cmd symbol', () => {
      setNav('MacIntel');
      const m = mod.shortcutMap();
      assert.equal(m.new, '⌘ N');
      assert.equal(m.open, '⌘ O');
      assert.equal(m.save, '⌘ S');
      assert.equal(m['this-dialog'], 'ESC');
    });

    test('on Windows uses Ctrl + ...', () => {
      setNav('Win32');
      const m = mod.shortcutMap();
      assert.equal(m.new, 'Ctrl + N');
      assert.equal(m.open, 'Ctrl + O');
      assert.equal(m.save, 'Ctrl + S');
      assert.equal(m['this-dialog'], 'ESC');
    });

    test('on Linux uses Ctrl + ... like Windows', () => {
      setNav('Linux x86_64');
      const m = mod.shortcutMap();
      assert.equal(m.new, 'Ctrl + N');
      assert.equal(m.save, 'Ctrl + S');
    });

    test('does not expose save-as or quit', () => {
      setNav('MacIntel');
      const m = mod.shortcutMap();
      assert.equal('save-as' in m, false);
      assert.equal('quit' in m, false);
    });
  });

  describe('headsUpNotices()', () => {
    // headsUpNotices(env) is a pure function — `env` is the synthetic
    // `{ hasFsa, onTauri, isTouchOnly }` triple that the welcome dialog
    // would normally derive at runtime. Tests pin which notices fire in
    // each environment so adding a new notice can't silently break the
    // existing two.

    test('Tauri desktop + FSA available → no notices', () => {
      const active = mod.headsUpNotices({ hasFsa: true, onTauri: true, isTouchOnly: false });
      assert.deepEqual(active, []);
    });

    test('Chromium web (FSA, not Tauri) → only the Cmd+N notice', () => {
      const active = mod.headsUpNotices({ hasFsa: true, onTauri: false, isTouchOnly: false });
      assert.equal(active.length, 1);
      assert.equal(active[0].id, 'no-cmd-n');
      assert.match(active[0].text, /Cmd\/Ctrl\+N/);
    });

    test('Firefox/Safari desktop (no FSA, not Tauri) → both notices, FSA first', () => {
      const active = mod.headsUpNotices({ hasFsa: false, onTauri: false, isTouchOnly: false });
      assert.equal(active.length, 2);
      assert.deepEqual(active.map(n => n.id), ['no-fsa', 'no-cmd-n']);
    });

    test('Tauri without FSA (theoretical) → only the FSA notice', () => {
      // Tauri's webview ships with FSA in practice, but the predicates
      // are independent — verify the registry treats them that way.
      const active = mod.headsUpNotices({ hasFsa: false, onTauri: true, isTouchOnly: false });
      assert.equal(active.length, 1);
      assert.equal(active[0].id, 'no-fsa');
    });

    test('touch-only mobile (no FSA, not Tauri) → only the FSA notice, no Cmd+N', () => {
      // Touch users have no keyboard — surfacing a keyboard-shortcut
      // limitation would just confuse. The CSS already hides shortcut
      // hints on touch via the same media query.
      const active = mod.headsUpNotices({ hasFsa: false, onTauri: false, isTouchOnly: true });
      assert.equal(active.length, 1);
      assert.equal(active[0].id, 'no-fsa');
    });

    test('touch-only with FSA (Android Chrome) → no notices', () => {
      const active = mod.headsUpNotices({ hasFsa: true, onTauri: false, isTouchOnly: true });
      assert.deepEqual(active, []);
    });

    test('returned items expose only { id, text } — no leaking the predicate fn', () => {
      // Defensive: predicates are an implementation detail. Callers get
      // plain data they can render or serialise without surprises.
      const active = mod.headsUpNotices({ hasFsa: false, onTauri: false, isTouchOnly: false });
      for (const item of active) {
        assert.deepEqual(Object.keys(item).sort(), ['id', 'text']);
        assert.equal(typeof item.text, 'string');
        // Notice text must NOT include "Heads up" — the renderer prefixes
        // it in the correct grammatical form for 1-vs-many active items.
        assert.doesNotMatch(item.text, /Heads up/i);
      }
    });

    test('predicates handle missing env keys without throwing', () => {
      // Defensive contract: callers shouldn't have to construct a complete
      // env object just to ask "what notices fire here?"
      assert.doesNotThrow(() => mod.headsUpNotices({}));
      assert.doesNotThrow(() => mod.headsUpNotices({ hasFsa: undefined, onTauri: undefined, isTouchOnly: undefined }));
    });
  });
});
