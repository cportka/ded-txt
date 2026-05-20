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
});
