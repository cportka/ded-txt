'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

// Unit tests for src/drafts.js — crash/draft recovery. Everything here is
// storage-injected or pure, so no browser globals are needed.

let mod;

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); }
  };
}

describe('src/drafts.js', () => {
  before(async () => {
    mod = await import('../src/drafts.js');
  });

  describe('serializeDraft() / parseDraft()', () => {
    test('round-trips content, name, isBinary and savedAt', () => {
      const raw = mod.serializeDraft({ content: 'héllo\n\0', name: 'a.txt', isBinary: true, savedAt: 123 });
      const d = mod.parseDraft(raw);
      assert.deepEqual(d, { content: 'héllo\n\0', name: 'a.txt', isBinary: true, savedAt: 123 });
    });

    test('empty or non-string content is not a draft', () => {
      assert.equal(mod.serializeDraft({ content: '', savedAt: 1 }), null);
      assert.equal(mod.serializeDraft({ content: null, savedAt: 1 }), null);
    });

    test('oversized content is refused (localStorage quota safety)', () => {
      const big = 'x'.repeat(mod.MAX_DRAFT_CHARS + 1);
      assert.equal(mod.serializeDraft({ content: big, savedAt: 1 }), null);
      const exactlyMax = 'x'.repeat(mod.MAX_DRAFT_CHARS);
      assert.notEqual(mod.serializeDraft({ content: exactlyMax, savedAt: 1 }), null);
    });

    test('parseDraft rejects garbage without throwing', () => {
      assert.equal(mod.parseDraft(null), null);
      assert.equal(mod.parseDraft(''), null);
      assert.equal(mod.parseDraft('not json {'), null);
      assert.equal(mod.parseDraft('42'), null);
      assert.equal(mod.parseDraft('{"content":""}'), null);
      assert.equal(mod.parseDraft('{"name":"x.txt"}'), null);
    });

    test('parseDraft normalizes missing optional fields', () => {
      const d = mod.parseDraft('{"content":"hi"}');
      assert.deepEqual(d, { content: 'hi', name: null, isBinary: false, savedAt: 0 });
    });
  });

  describe('relativeTime()', () => {
    const now = 1_000_000_000_000;
    test('coarse buckets', () => {
      assert.equal(mod.relativeTime(now - 5 * 1000, now), 'just now');
      assert.equal(mod.relativeTime(now - 60 * 1000, now), 'a minute ago');
      assert.equal(mod.relativeTime(now - 5 * 60 * 1000, now), '5 minutes ago');
      assert.equal(mod.relativeTime(now - 60 * 60 * 1000, now), 'an hour ago');
      assert.equal(mod.relativeTime(now - 3 * 60 * 60 * 1000, now), '3 hours ago');
      assert.equal(mod.relativeTime(now - 24 * 60 * 60 * 1000, now), 'yesterday');
      assert.equal(mod.relativeTime(now - 3 * 24 * 60 * 60 * 1000, now), '3 days ago');
    });
    test('unknown or ancient timestamps degrade gracefully', () => {
      assert.equal(mod.relativeTime(0, now), 'a while ago');
      assert.equal(mod.relativeTime(now - 30 * 24 * 60 * 60 * 1000, now), 'a while ago');
    });
    test('a clock that went backwards reads as just now, not the far future', () => {
      assert.equal(mod.relativeTime(now + 60 * 1000, now), 'just now');
    });
  });

  describe('describeDraft()', () => {
    test('named draft quotes the filename', () => {
      const now = 10 * 60 * 1000;
      const s = mod.describeDraft({ name: 'notes.txt', savedAt: now - 5 * 60 * 1000 }, now);
      assert.equal(s, 'Recovered “notes.txt” from 5 minutes ago.');
    });
    test('unnamed draft says unsaved text', () => {
      const s = mod.describeDraft({ name: null, savedAt: 0 }, 50);
      assert.equal(s, 'Recovered unsaved text from a while ago.');
    });
  });

  describe('createDraftStash()', () => {
    function makeStash(snapshot, storage = fakeStorage()) {
      const state = { snap: snapshot };
      const stash = mod.createDraftStash({
        storage,
        getSnapshot: () => state.snap,
        debounceMs: 0
      });
      return { stash, state, storage };
    }

    test('flush() writes only while dirty', () => {
      const { stash, state, storage } = makeStash({ content: 'abc', name: null, isBinary: false, dirty: false });
      stash.flush();
      assert.equal(storage.map.size, 0);
      state.snap = { ...state.snap, dirty: true };
      stash.flush();
      const d = mod.parseDraft(storage.getItem(mod.DRAFT_KEY));
      assert.equal(d.content, 'abc');
    });

    test('schedule() captures the snapshot at write time, not schedule time', async () => {
      const { stash, state, storage } = makeStash({ content: 'first', dirty: true });
      stash.schedule();
      state.snap = { content: 'second', dirty: true };
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(mod.parseDraft(storage.getItem(mod.DRAFT_KEY)).content, 'second');
    });

    test('clear() removes the draft and cancels a pending write', async () => {
      const { stash, storage } = makeStash({ content: 'abc', dirty: true });
      stash.flush();
      stash.schedule();
      stash.clear();
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(storage.getItem(mod.DRAFT_KEY), null);
    });

    test('suspend() blocks writes until resume() (restore offer pending)', async () => {
      const { stash, storage } = makeStash({ content: 'typed over the offer', dirty: true });
      stash.suspend();
      stash.schedule();
      stash.flush();
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(storage.getItem(mod.DRAFT_KEY), null);
      stash.resume();
      stash.flush();
      assert.equal(mod.parseDraft(storage.getItem(mod.DRAFT_KEY)).content, 'typed over the offer');
    });

    test('peek() surfaces the parsed draft and survives corrupt storage', () => {
      const storage = fakeStorage({ [mod.DRAFT_KEY]: '{"content":"kept","savedAt":9}' });
      const { stash } = makeStash({ content: '', dirty: false }, storage);
      assert.equal(stash.peek().content, 'kept');
      storage.setItem(mod.DRAFT_KEY, '%%% not json');
      assert.equal(stash.peek(), null);
    });

    test('a throwing storage never propagates (private mode / quota)', () => {
      const storage = {
        getItem() { throw new Error('nope'); },
        setItem() { throw new Error('nope'); },
        removeItem() { throw new Error('nope'); }
      };
      const stash = mod.createDraftStash({ storage, getSnapshot: () => ({ content: 'x', dirty: true }), debounceMs: 0 });
      assert.doesNotThrow(() => stash.flush());
      assert.doesNotThrow(() => stash.clear());
      assert.equal(stash.peek(), null);
    });
  });
});
