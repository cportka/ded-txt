'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Unit tests for src/sw-update.js — the pure decisions behind the web PWA
// update notice. The DOM/SW wiring is exercised end-to-end in the browser
// (a real v1→v2 update cycle); here we pin the two rules that decide WHEN the
// "update ready" notice appears and HOW OFTEN the app re-checks for a deploy.

async function fresh() {
  const cb = `?cb=${Date.now()}-${Math.random()}`;
  return import('../src/sw-update.js' + cb);
}

describe('src/sw-update.js', () => {
  describe('shouldSurfaceWebUpdate()', () => {
    test('installed + existing controller = an update → surface the notice', async () => {
      const { shouldSurfaceWebUpdate } = await fresh();
      assert.equal(shouldSurfaceWebUpdate('installed', true), true);
      // A truthy controller object counts.
      assert.equal(shouldSurfaceWebUpdate('installed', { active: true }), true);
    });

    test('installed with NO controller = first-ever install → stay quiet', async () => {
      const { shouldSurfaceWebUpdate } = await fresh();
      // The initial visit must not nag "an update is ready" — there is no
      // previous version to update from.
      assert.equal(shouldSurfaceWebUpdate('installed', null), false);
      assert.equal(shouldSurfaceWebUpdate('installed', undefined), false);
      assert.equal(shouldSurfaceWebUpdate('installed', false), false);
    });

    test('any non-installed state never surfaces', async () => {
      const { shouldSurfaceWebUpdate } = await fresh();
      for (const s of ['installing', 'activating', 'activated', 'redundant', '']) {
        assert.equal(shouldSurfaceWebUpdate(s, true), false, `state ${s}`);
      }
    });
  });

  describe('shouldRecheckUpdate()', () => {
    test('does not re-check the instant after registration (seeded lastMs)', async () => {
      const { shouldRecheckUpdate, RECHECK_GAP_MS } = await fresh();
      // Renderer seeds lastMs with the registration time; a refocus 1ms later
      // must NOT re-check — that would hammer the network on every tab switch.
      const registeredAt = 1_700_000_000_000;
      assert.equal(shouldRecheckUpdate(registeredAt, registeredAt + 1, RECHECK_GAP_MS), false);
      // ...but once the gap has elapsed, it does.
      assert.equal(shouldRecheckUpdate(registeredAt, registeredAt + RECHECK_GAP_MS, RECHECK_GAP_MS), true);
    });

    test('waits for the full gap to elapse', async () => {
      const { shouldRecheckUpdate, RECHECK_GAP_MS } = await fresh();
      const last = 1_000_000;
      assert.equal(shouldRecheckUpdate(last, last + RECHECK_GAP_MS - 1, RECHECK_GAP_MS), false);
      assert.equal(shouldRecheckUpdate(last, last + RECHECK_GAP_MS, RECHECK_GAP_MS), true);
      assert.equal(shouldRecheckUpdate(last, last + RECHECK_GAP_MS + 1, RECHECK_GAP_MS), true);
    });

    test('a non-finite clock never triggers a check (no network spam)', async () => {
      const { shouldRecheckUpdate } = await fresh();
      assert.equal(shouldRecheckUpdate(0, NaN, 1000), false);
      assert.equal(shouldRecheckUpdate(NaN, 5000, 1000), false);
      assert.equal(shouldRecheckUpdate(0, Infinity, 1000), false);
    });

    test('RECHECK_GAP_MS is a sane 30 minutes', async () => {
      const { RECHECK_GAP_MS } = await fresh();
      assert.equal(RECHECK_GAP_MS, 30 * 60 * 1000);
    });
  });
});
