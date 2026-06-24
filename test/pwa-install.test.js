'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Behaviour tests for src/pwa-install.js. The module is browser-only at runtime
// but takes injectable window/document, so we drive it with tiny event-bus
// mocks — no JSDOM, in keeping with the rest of the suite.

function makeWin(opts = {}) {
  const handlers = {};
  return {
    navigator: opts.navigator || {},
    matchMedia: opts.matchMedia,
    addEventListener(type, fn) {
      if (!handlers[type]) handlers[type] = [];
      handlers[type].push(fn);
    },
    dispatch(type, ev) {
      (handlers[type] || []).forEach((fn) => fn(ev));
    }
  };
}

function makeBtn() {
  const handlers = {};
  return {
    hidden: true,
    disabled: false,
    addEventListener(type, fn) {
      if (!handlers[type]) handlers[type] = [];
      handlers[type].push(fn);
    },
    click() { (handlers.click || []).forEach((fn) => fn()); }
  };
}

function makeDoc(btn) {
  return { getElementById: (id) => (id === 'install-pwa' ? btn : null) };
}

async function fresh() {
  const cb = `?cb=${Date.now()}-${Math.random()}`;
  return import('../src/pwa-install.js' + cb);
}

describe('src/pwa-install.js', () => {
  describe('isStandalone()', () => {
    test('true when display-mode: standalone matches', async () => {
      const { isStandalone } = await fresh();
      assert.equal(isStandalone(makeWin({ matchMedia: () => ({ matches: true }) })), true);
    });

    test('true for the iOS navigator.standalone flag', async () => {
      const { isStandalone } = await fresh();
      assert.equal(isStandalone(makeWin({ navigator: { standalone: true } })), true);
    });

    test('false in a normal browser tab', async () => {
      const { isStandalone } = await fresh();
      assert.equal(isStandalone(makeWin({ matchMedia: () => ({ matches: false }) })), false);
    });

    test('null window → false (no throw)', async () => {
      const { isStandalone } = await fresh();
      assert.equal(isStandalone(null), false);
    });
  });

  describe('initInstallPrompt()', () => {
    test('reveals the button on beforeinstallprompt, then prompts on click', async () => {
      const { initInstallPrompt } = await fresh();
      const btn = makeBtn();
      const win = makeWin({ matchMedia: () => ({ matches: false }) });
      initInstallPrompt({ window: win, document: makeDoc(btn) });
      assert.equal(btn.hidden, true, 'hidden until installable');

      let prevented = false;
      let prompted = false;
      let resolveChoice;
      const ev = {
        preventDefault() { prevented = true; },
        prompt() { prompted = true; },
        userChoice: new Promise((r) => { resolveChoice = r; })
      };
      win.dispatch('beforeinstallprompt', ev);
      assert.equal(prevented, true, 'browser mini-infobar suppressed');
      assert.equal(btn.hidden, false, 'our button revealed');

      btn.click();
      assert.equal(prompted, true, 'native prompt invoked');
      resolveChoice({ outcome: 'accepted' });
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(btn.hidden, true, 'a one-shot prompt hides the button again');
    });

    test('stays hidden when already installed (standalone)', async () => {
      const { initInstallPrompt } = await fresh();
      const btn = makeBtn();
      const win = makeWin({ matchMedia: () => ({ matches: true }) });
      initInstallPrompt({ window: win, document: makeDoc(btn) });
      // No beforeinstallprompt listener is registered in standalone mode.
      win.dispatch('beforeinstallprompt', { preventDefault() {}, prompt() {} });
      assert.equal(btn.hidden, true);
    });

    test('appinstalled hides the button', async () => {
      const { initInstallPrompt } = await fresh();
      const btn = makeBtn();
      const win = makeWin({ matchMedia: () => ({ matches: false }) });
      initInstallPrompt({ window: win, document: makeDoc(btn) });
      win.dispatch('beforeinstallprompt', { preventDefault() {}, prompt() {}, userChoice: Promise.resolve({}) });
      assert.equal(btn.hidden, false);
      win.dispatch('appinstalled', {});
      assert.equal(btn.hidden, true);
    });

    test('no button in the DOM → no-op (no throw)', async () => {
      const { initInstallPrompt } = await fresh();
      const win = makeWin({ matchMedia: () => ({ matches: false }) });
      assert.doesNotThrow(() => initInstallPrompt({ window: win, document: { getElementById: () => null } }));
    });
  });
});
