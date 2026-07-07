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
    });

    test('on Windows uses Ctrl + ...', () => {
      setNav('Win32');
      const m = mod.shortcutMap();
      assert.equal(m.new, 'Ctrl + N');
      assert.equal(m.open, 'Ctrl + O');
      assert.equal(m.save, 'Ctrl + S');
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

    test('Tauri desktop + FSA available → only the ESC notice', () => {
      const active = mod.headsUpNotices({ hasFsa: true, onTauri: true, isTouchOnly: false });
      assert.deepEqual(active.map(n => n.id), ['esc-hint']);
    });

    test('Chromium web (FSA, not Tauri) → ESC + Cmd+N notices', () => {
      const active = mod.headsUpNotices({ hasFsa: true, onTauri: false, isTouchOnly: false });
      assert.deepEqual(active.map(n => n.id), ['esc-hint', 'no-cmd-n']);
      assert.match(active[1].text, /Cmd\/Ctrl\+N/);
    });

    test('Firefox/Safari desktop (no FSA, not Tauri) → ESC, FSA, Cmd+N in order', () => {
      const active = mod.headsUpNotices({ hasFsa: false, onTauri: false, isTouchOnly: false });
      assert.deepEqual(active.map(n => n.id), ['esc-hint', 'no-fsa', 'no-cmd-n']);
    });

    test('Tauri without FSA (theoretical) → ESC + FSA notices', () => {
      // Tauri's webview ships with FSA in practice, but the predicates
      // are independent — verify the registry treats them that way.
      const active = mod.headsUpNotices({ hasFsa: false, onTauri: true, isTouchOnly: false });
      assert.deepEqual(active.map(n => n.id), ['esc-hint', 'no-fsa']);
    });

    test('touch-only mobile (no FSA, not Tauri) → NO notices (no misleading save advice)', () => {
      // On mobile there is no browser you can switch to that has the FSA
      // (iOS is all WebKit; Android Chrome lacks it too), so the "use Chrome
      // or Edge" no-fsa notice would be actively wrong — suppress it. The
      // keyboard-shortcut notices are already touch-suppressed, so the box is
      // empty here. (Regression guard for the iOS "silent save" heads-up.)
      const active = mod.headsUpNotices({ hasFsa: false, onTauri: false, isTouchOnly: true });
      assert.deepEqual(active, []);
    });

    test('the no-fsa notice is desktop-only (never fires on touch)', () => {
      // Fires on desktop without FSA...
      assert.ok(mod.headsUpNotices({ hasFsa: false, onTauri: false, isTouchOnly: false })
        .some(n => n.id === 'no-fsa'));
      // ...but never on a touch-only device, regardless of the other flags.
      for (const env of [
        { hasFsa: false, onTauri: false, isTouchOnly: true },
        { hasFsa: false, onTauri: true, isTouchOnly: true },
        { hasFsa: false, isTouchOnly: true, canInstall: true }
      ]) {
        assert.ok(!mod.headsUpNotices(env).some(n => n.id === 'no-fsa'));
      }
    });

    test('touch-only with FSA (rare) → no notices', () => {
      const active = mod.headsUpNotices({ hasFsa: true, onTauri: false, isTouchOnly: true });
      assert.deepEqual(active, []);
    });

    test('ESC notice is first on non-touch and absent on touch-only', () => {
      // The ESC hint replaces the removed "This" shortcut row; it only makes
      // sense where a keyboard (and thus an Escape key) exists.
      const desktop = mod.headsUpNotices({ hasFsa: true, onTauri: true, isTouchOnly: false });
      assert.equal(desktop[0].id, 'esc-hint');
      const touch = mod.headsUpNotices({ hasFsa: true, onTauri: true, isTouchOnly: true });
      assert.ok(!touch.some(n => n.id === 'esc-hint'));
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

    test('web update available → adds update-web notice with an apply action', () => {
      const active = mod.headsUpNotices({ hasFsa: true, onTauri: true, isTouchOnly: false, update: { kind: 'web' } });
      const note = active.find(n => n.id === 'update-web');
      assert.ok(note, 'update-web notice present');
      assert.deepEqual(note.action, { label: 'Click here to update', onClick: 'applyUpdate' });
    });

    test('native update available → adds update-native notice with a Releases link', () => {
      const active = mod.headsUpNotices({ hasFsa: true, onTauri: true, isTouchOnly: false, update: { kind: 'native', url: 'https://example.test/r' } });
      const note = active.find(n => n.id === 'update-native');
      assert.ok(note, 'update-native notice present');
      assert.equal(note.action.href, 'https://example.test/r');
    });

    test('native update without an explicit url falls back to GitHub Releases', () => {
      const active = mod.headsUpNotices({ hasFsa: true, onTauri: true, isTouchOnly: false, update: { kind: 'native' } });
      const note = active.find(n => n.id === 'update-native');
      assert.match(note.action.href, /github\.com\/cportka\/ded-txt\/releases/);
    });

    test('canInstall → adds a one-click install-app notice with an installApp action', () => {
      const active = mod.headsUpNotices({ hasFsa: true, onTauri: false, isTouchOnly: false, canInstall: true });
      const note = active.find(n => n.id === 'install-app');
      assert.ok(note, 'install-app notice present when installable');
      assert.deepEqual(note.action, { label: 'Click here to install', onClick: 'installApp' });
    });

    test('install-app notice is absent unless canInstall is set', () => {
      // Not installable (default), already installed, or an engine that never
      // fires beforeinstallprompt → no install line.
      for (const env of [
        { hasFsa: true, onTauri: false, isTouchOnly: false },
        { hasFsa: true, onTauri: false, isTouchOnly: false, canInstall: false },
        { hasFsa: false, onTauri: false, isTouchOnly: true } // iOS-ish
      ]) {
        assert.ok(!mod.headsUpNotices(env).some(n => n.id === 'install-app'));
      }
    });

    test('install-app coexists with update-web when both are available', () => {
      const active = mod.headsUpNotices({
        hasFsa: true, onTauri: false, isTouchOnly: false, canInstall: true, update: { kind: 'web' }
      });
      const ids = active.map(n => n.id);
      assert.ok(ids.includes('install-app'));
      assert.ok(ids.includes('update-web'));
    });

    test('no update in env → no update notices, plain items stay { id, text }', () => {
      const active = mod.headsUpNotices({ hasFsa: false, onTauri: false, isTouchOnly: false });
      assert.ok(!active.some(n => n.id === 'update-web' || n.id === 'update-native'));
      for (const item of active) {
        assert.deepEqual(Object.keys(item).sort(), ['id', 'text']);
      }
    });

    test('predicates handle missing env keys without throwing', () => {
      // Defensive contract: callers shouldn't have to construct a complete
      // env object just to ask "what notices fire here?"
      assert.doesNotThrow(() => mod.headsUpNotices({}));
      assert.doesNotThrow(() => mod.headsUpNotices({ hasFsa: undefined, onTauri: undefined, isTouchOnly: undefined }));
    });
  });

  describe('actionNodeSpec()', () => {
    test('null for a notice with no action', () => {
      assert.equal(mod.actionNodeSpec({ id: 'x', text: 'y' }), null);
      assert.equal(mod.actionNodeSpec(null), null);
    });

    test('button spec for an onClick action', () => {
      assert.deepEqual(
        mod.actionNodeSpec({ action: { label: 'Click here to update', onClick: 'applyUpdate' } }),
        { tag: 'button', label: 'Click here to update', onClick: 'applyUpdate' }
      );
    });

    test('anchor spec for an href action', () => {
      assert.deepEqual(
        mod.actionNodeSpec({ action: { label: 'Get the new desktop build →', href: 'https://example.test/r' } }),
        { tag: 'a', label: 'Get the new desktop build →', href: 'https://example.test/r' }
      );
    });
  });
});
