'use strict';
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Tests the runtime detection in src/platform/index.js — chooses tauri vs web
// based on whether window.__TAURI_INTERNALS__ is present.
//
// We bust Node's ESM cache between cases with a query-string suffix so each
// test re-evaluates the if/else in platform/index.js against fresh globals.

describe('src/platform/index.js', () => {
  beforeEach(() => {
    delete globalThis.window;
  });

  test('selects web platform when window is absent', async () => {
    const mod = await import('../src/platform/index.js?cb=' + Date.now() + '-no-window');
    assert.equal(mod.default.name, 'web');
  });

  test('selects web platform when window has no __TAURI_INTERNALS__', async () => {
    globalThis.window = {};
    const mod = await import('../src/platform/index.js?cb=' + Date.now() + '-empty-window');
    assert.equal(mod.default.name, 'web');
  });

  test('selects tauri platform when window.__TAURI_INTERNALS__ is set', async () => {
    globalThis.window = { __TAURI_INTERNALS__: {} };
    const mod = await import('../src/platform/index.js?cb=' + Date.now() + '-tauri');
    assert.equal(mod.default.name, 'tauri');
  });
});
