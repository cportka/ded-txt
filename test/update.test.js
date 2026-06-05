'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let mod;

describe('src/update.js', () => {
  before(async () => {
    mod = await import('../src/update.js');
  });

  describe('compareVersions()', () => {
    test('equal versions compare 0', () => {
      assert.equal(mod.compareVersions('1.0.0-rc.48', '1.0.0-rc.48'), 0);
    });

    test('rc ordering is numeric, not lexical (rc.9 < rc.10)', () => {
      assert.equal(mod.compareVersions('1.0.0-rc.9', '1.0.0-rc.10'), -1);
      assert.equal(mod.compareVersions('1.0.0-rc.10', '1.0.0-rc.9'), 1);
    });

    test('a final release outranks its own rc', () => {
      assert.equal(mod.compareVersions('1.0.0', '1.0.0-rc.99'), 1);
      assert.equal(mod.compareVersions('1.0.0-rc.99', '1.0.0'), -1);
    });

    test('major/minor/patch precedence (numeric, not lexical)', () => {
      assert.equal(mod.compareVersions('1.2.0', '1.10.0'), -1);
      assert.equal(mod.compareVersions('2.0.0', '1.9.9'), 1);
    });

    test('unparseable inputs compare equal (never claim an update)', () => {
      assert.equal(mod.compareVersions('garbage', '1.0.0'), 0);
      assert.equal(mod.compareVersions('1.0.0', ''), 0);
      assert.equal(mod.compareVersions(undefined, '1.0.0'), 0);
    });
  });

  describe('updateKind()', () => {
    test('not newer → none', () => {
      assert.equal(mod.updateKind('1.0.0-rc.49', '1.0.0-rc.49', '1.0.0-rc.40', '1.0.0-rc.49'), 'none');
      assert.equal(mod.updateKind('1.0.0-rc.50', '1.0.0-rc.49', '1.0.0-rc.40', '1.0.0-rc.50'), 'none');
    });

    test('newer + native compatible → web', () => {
      assert.equal(mod.updateKind('1.0.0-rc.48', '1.0.0-rc.49', '1.0.0-rc.40', '1.0.0-rc.48'), 'web');
    });

    test('newer but native shell too old → native', () => {
      assert.equal(mod.updateKind('1.0.0-rc.48', '1.0.0-rc.49', '1.0.0-rc.49', '1.0.0-rc.48'), 'native');
    });

    test('web context (no native shell) is always web when newer', () => {
      assert.equal(mod.updateKind('1.0.0-rc.48', '1.0.0-rc.49', '1.0.0-rc.99', null), 'web');
    });

    test('unparseable nativeMin defaults to compatible (web)', () => {
      assert.equal(mod.updateKind('1.0.0-rc.48', '1.0.0-rc.49', undefined, '1.0.0-rc.48'), 'web');
    });
  });
});
