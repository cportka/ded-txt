'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

// Unit tests for src/notice.js's pure helper. The DOM side (showNotice) is
// exercised in the browser; formatResultError is the decision logic that
// keeps renderer.js honest about WHEN to surface an error.

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
});
