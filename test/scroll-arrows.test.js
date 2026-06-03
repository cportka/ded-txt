'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Pure-logic tests for the scroll-arrow visibility rule in
// src/scroll-arrows.js. The arrows must both hide when the whole document
// fits, and each must hide once that end of the scroll range is reached.

async function freshArrows() {
  const cb = `?cb=${Date.now()}-${Math.random()}`;
  return await import('../src/scroll-arrows.js' + cb);
}

describe('arrowVisibility()', () => {
  test('both hidden when the whole document fits', async () => {
    const { arrowVisibility } = await freshArrows();
    assert.deepEqual(
      arrowVisibility({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 }),
      { top: false, bottom: false }
    );
  });

  test('at the top: up hidden, down shown', async () => {
    const { arrowVisibility } = await freshArrows();
    assert.deepEqual(
      arrowVisibility({ scrollTop: 0, clientHeight: 500, scrollHeight: 2000 }),
      { top: false, bottom: true }
    );
  });

  test('at the bottom: up shown, down hidden', async () => {
    const { arrowVisibility } = await freshArrows();
    assert.deepEqual(
      arrowVisibility({ scrollTop: 1500, clientHeight: 500, scrollHeight: 2000 }),
      { top: true, bottom: false }
    );
  });

  test('in the middle: both shown', async () => {
    const { arrowVisibility } = await freshArrows();
    assert.deepEqual(
      arrowVisibility({ scrollTop: 700, clientHeight: 500, scrollHeight: 2000 }),
      { top: true, bottom: true }
    );
  });

  test('1px tolerance absorbs sub-pixel scroll metrics', async () => {
    const { arrowVisibility } = await freshArrows();
    // Effectively at the bottom (off by 1px) — down stays hidden.
    assert.deepEqual(
      arrowVisibility({ scrollTop: 1499, clientHeight: 500, scrollHeight: 2000 }),
      { top: true, bottom: false }
    );
    // Effectively at the top (off by 1px) — up stays hidden.
    assert.deepEqual(
      arrowVisibility({ scrollTop: 1, clientHeight: 500, scrollHeight: 2000 }),
      { top: false, bottom: true }
    );
  });
});
