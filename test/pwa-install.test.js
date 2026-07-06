'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Behaviour tests for src/pwa-install.js. The module is browser-only at runtime
// but takes an injectable window, so we drive it with a tiny event-bus mock —
// no JSDOM, in keeping with the rest of the suite.

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

  describe('createInstallController()', () => {
    test('not installable until beforeinstallprompt fires', async () => {
      const { createInstallController } = await fresh();
      const win = makeWin({ matchMedia: () => ({ matches: false }) });
      const c = createInstallController({ window: win });
      assert.equal(c.canInstall(), false);

      let prevented = false;
      win.dispatch('beforeinstallprompt', { preventDefault() { prevented = true; }, prompt() {} });
      assert.equal(prevented, true, 'browser mini-infobar suppressed');
      assert.equal(c.canInstall(), true);
    });

    test('onChange fires when installability changes', async () => {
      const { createInstallController } = await fresh();
      const win = makeWin({ matchMedia: () => ({ matches: false }) });
      const c = createInstallController({ window: win });
      let changes = 0;
      c.onChange(() => { changes++; });
      win.dispatch('beforeinstallprompt', { preventDefault() {}, prompt() {} });
      assert.equal(changes, 1, 'notified when prompt captured');
    });

    test('prompt() replays the native prompt, then clears availability (one-shot)', async () => {
      const { createInstallController } = await fresh();
      const win = makeWin({ matchMedia: () => ({ matches: false }) });
      const c = createInstallController({ window: win });

      let prompted = false;
      let resolveChoice;
      win.dispatch('beforeinstallprompt', {
        preventDefault() {},
        prompt() { prompted = true; },
        userChoice: new Promise((r) => { resolveChoice = r; })
      });
      assert.equal(c.canInstall(), true);

      // onChange MUST fire when the prompt is consumed — the open welcome
      // dialog relies on it (via refreshHeadsUp) to clear the install line
      // once installed. canInstall() flips to false regardless, so without
      // this assertion a dropped notify() would leave the line lingering yet
      // still pass every other test.
      let changes = 0;
      c.onChange(() => { changes++; });

      const p = c.prompt();
      assert.equal(prompted, true, 'native prompt invoked');
      resolveChoice({ outcome: 'accepted' });
      assert.equal(await p, true, 'prompt() reports it showed a prompt');
      assert.equal(c.canInstall(), false, 'a consumed prompt is not reusable');
      assert.equal(changes, 1, 'onChange fired so the install line can clear itself');
    });

    test('prompt() with nothing captured is a safe no-op', async () => {
      const { createInstallController } = await fresh();
      const win = makeWin({ matchMedia: () => ({ matches: false }) });
      const c = createInstallController({ window: win });
      assert.equal(await c.prompt(), false);
    });

    test('appinstalled clears availability for good', async () => {
      const { createInstallController } = await fresh();
      const win = makeWin({ matchMedia: () => ({ matches: false }) });
      const c = createInstallController({ window: win });
      win.dispatch('beforeinstallprompt', { preventDefault() {}, prompt() {} });
      assert.equal(c.canInstall(), true);
      // onChange MUST fire on install so a live dialog drops the install line.
      let changes = 0;
      c.onChange(() => { changes++; });
      win.dispatch('appinstalled', {});
      assert.equal(c.canInstall(), false);
      assert.equal(changes, 1, 'onChange fired on appinstalled');
      // A stray late beforeinstallprompt after install must not re-offer.
      win.dispatch('beforeinstallprompt', { preventDefault() {}, prompt() {} });
      assert.equal(c.canInstall(), false);
    });

    test('already standalone → never installable, no listeners wired', async () => {
      const { createInstallController } = await fresh();
      const win = makeWin({ matchMedia: () => ({ matches: true }) });
      const c = createInstallController({ window: win });
      win.dispatch('beforeinstallprompt', { preventDefault() {}, prompt() {} });
      assert.equal(c.canInstall(), false);
    });

    test('no window → inert controller (no throw)', async () => {
      const { createInstallController } = await fresh();
      let c;
      assert.doesNotThrow(() => { c = createInstallController({ window: null }); });
      assert.equal(c.canInstall(), false);
      assert.equal(await c.prompt(), false);
    });

    test('a throwing onChange listener does not break the others', async () => {
      const { createInstallController } = await fresh();
      const win = makeWin({ matchMedia: () => ({ matches: false }) });
      const c = createInstallController({ window: win });
      let reached = false;
      c.onChange(() => { throw new Error('boom'); });
      c.onChange(() => { reached = true; });
      assert.doesNotThrow(() => win.dispatch('beforeinstallprompt', { preventDefault() {}, prompt() {} }));
      assert.equal(reached, true);
    });
  });
});
