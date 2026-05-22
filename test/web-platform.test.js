'use strict';
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Behaviour tests for src/platform/web.js. The recent rc.18-22 cycle had
// several bugs that should have been caught here: stale tab titles after a
// second open, save picker re-appearing because the FSA handle was lost,
// downloadFallback claiming "Untitled.txt" in the title. These tests pin
// those behaviours down.
//
// web.js holds module-scoped state (currentHandle / currentName / dirty /
// loadCb), so each test cache-busts the import to start from a clean slate.

// ---------------------------------------------------------------------------
// Mock browser globals
// ---------------------------------------------------------------------------

function makeAnchorStub(captured) {
  const a = {
    href: '',
    download: '',
    style: {},
    click() { captured.push({ kind: 'click-anchor', el: a }); },
    remove() { captured.push({ kind: 'remove-anchor', el: a }); }
  };
  return a;
}

function makeInputStub(inputs) {
  const inp = {
    type: '',
    accept: '',
    style: {},
    files: null,
    onchange: null,
    oncancel: null,
    click() { inputs.lastClicked = inp; },
    remove() {}
  };
  inputs.created.push(inp);
  return inp;
}

function installGlobals(opts = {}) {
  const blobs = [];
  const inputs = { created: [], lastClicked: null };
  const anchors = [];

  globalThis.document = {
    // Real index.html ships with <title>DedTxt</title>; mirror that so
    // tests for "title shouldn't change after a download-fallback save"
    // start from the same baseline.
    title: 'DedTxt',
    body: {
      appendChild() {},
      removeChild() {}
    },
    createElement(tag) {
      if (tag === 'input') return makeInputStub(inputs);
      const a = makeAnchorStub(anchors);
      anchors.push(a);
      return a;
    }
  };

  const win = { onbeforeunload: null };
  if (opts.showOpenFilePicker) win.showOpenFilePicker = opts.showOpenFilePicker;
  if (opts.showSaveFilePicker) win.showSaveFilePicker = opts.showSaveFilePicker;
  // hasFsAccess() gates on showOpenFilePicker. If the caller is only
  // exercising the save path, install a placeholder so the FSA save branch
  // runs (the placeholder throws if anything actually invokes it).
  if (win.showSaveFilePicker && !win.showOpenFilePicker) {
    win.showOpenFilePicker = async () => { throw new Error('open picker not configured for this test'); };
  }
  globalThis.window = win;

  globalThis.Blob = class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.options = options;
      blobs.push(this);
    }
  };
  globalThis.URL = {
    createObjectURL: () => 'blob:fake-url',
    revokeObjectURL() {}
  };

  return { blobs, inputs, anchors, win };
}

function uninstallGlobals() {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.Blob;
  delete globalThis.URL;
}

async function freshWeb() {
  // Query-string cache-buster so the module re-executes with reset state.
  const cb = `?cb=${Date.now()}-${Math.random()}`;
  const mod = await import('../src/platform/web.js' + cb);
  return mod.default;
}

// Build a fake FSA handle that captures every write and exposes them via
// getFile().text() so we can verify true save→load roundtrips.
function makeFakeHandle(name) {
  let stored = '';
  const writes = [];
  return {
    name,
    writes,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    createWritable: async () => ({
      write: async (content) => { writes.push(content); stored = content; },
      close: async () => {}
    }),
    getFile: async () => ({
      name,
      text: async () => stored
    })
  };
}

// Build a fake dropped/picked File whose .text() yields the given content.
function makeFakeFile(name, content) {
  return { name, text: async () => content };
}

// Build a fake binary File (MIME type provided by browser, no .text() needed).
function makeFakeBinaryFile(name, type) {
  return { name, type };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('src/platform/web.js', () => {
  beforeEach(() => { uninstallGlobals(); });

  describe('newFile() and initial title', () => {
    test('newFile() sets the tab title to bare "DedTxt"', async () => {
      installGlobals();
      const web = await freshWeb();
      web.newFile();
      assert.equal(document.title, 'DedTxt');
    });

    test('newFile() resets prior name + dirty state', async () => {
      installGlobals();
      const web = await freshWeb();
      await web.openDroppedFile(makeFakeFile('a.txt', 'hi'));
      web.setDirty(true);
      assert.equal(document.title, '• a.txt • — DedTxt');

      web.newFile();
      assert.equal(document.title, 'DedTxt');
      assert.equal(window.onbeforeunload, null);
    });
  });

  describe('title rendering', () => {
    test('no file → "DedTxt"', async () => {
      installGlobals();
      const web = await freshWeb();
      web.setDirty(false);
      assert.equal(document.title, 'DedTxt');
    });

    test('no file but dirty → still "DedTxt" (no bullet without a name)', async () => {
      installGlobals();
      const web = await freshWeb();
      web.setDirty(true);
      assert.equal(document.title, 'DedTxt');
    });

    test('named file clean → "name — DedTxt"', async () => {
      installGlobals();
      const web = await freshWeb();
      web.setName('notes.md');
      web.setDirty(false);
      assert.equal(document.title, 'notes.md — DedTxt');
    });

    test('named file dirty → "• name • — DedTxt"', async () => {
      installGlobals();
      const web = await freshWeb();
      web.setName('notes.md');
      web.setDirty(true);
      assert.equal(document.title, '• notes.md • — DedTxt');
    });

    test('clean → dirty → clean transitions never leak bullets or stray spaces', async () => {
      // Pins the branching format: the dirty bullets must appear ONLY when
      // dirty, with no trailing-bullet or double-space residue when clean.
      // Regression guard for the rc.24 single-side `${name}${dot} —` format
      // that silently grew a stale " • " into the clean title if any future
      // refactor reverts to suffix-only concatenation.
      installGlobals();
      const web = await freshWeb();
      web.setName('readme.md');
      web.setDirty(false);
      assert.equal(document.title, 'readme.md — DedTxt');
      web.setDirty(true);
      assert.equal(document.title, '• readme.md • — DedTxt');
      web.setDirty(false);
      assert.equal(document.title, 'readme.md — DedTxt');
    });
  });

  describe('openDroppedFile()', () => {
    test('emits onLoad with the file content and updates title', async () => {
      installGlobals();
      const web = await freshWeb();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });

      const res = await web.openDroppedFile(makeFakeFile('b.txt', 'hello'));
      assert.deepEqual(res, { ok: true });
      assert.deepEqual(loaded, { filePath: 'b.txt', content: 'hello' });
      assert.equal(document.title, 'b.txt — DedTxt');
    });

    test('opening a second file replaces the title — not stuck on the first', async () => {
      // Regression: rc.20 bug — fireLoad didn't call updateTitle, so opening
      // file B over a clean file A left the tab showing A.
      installGlobals();
      const web = await freshWeb();
      web.onLoad(() => {});

      await web.openDroppedFile(makeFakeFile('A.txt', 'one'));
      assert.equal(document.title, 'A.txt — DedTxt');

      await web.openDroppedFile(makeFakeFile('B.txt', 'two'));
      assert.equal(document.title, 'B.txt — DedTxt');
    });

    test('a dirty bullet from the prior file does not leak into the new title', async () => {
      installGlobals();
      const web = await freshWeb();
      web.onLoad(() => {});

      await web.openDroppedFile(makeFakeFile('A.txt', 'one'));
      web.setDirty(true);
      assert.equal(document.title, '• A.txt • — DedTxt');

      await web.openDroppedFile(makeFakeFile('B.txt', 'two'));
      assert.equal(document.title, 'B.txt — DedTxt');
    });

    test('returns {ok:false} when file.text() throws', async () => {
      installGlobals();
      const web = await freshWeb();
      const res = await web.openDroppedFile({
        name: 'broken.txt',
        text: async () => { throw new Error('boom'); }
      });
      assert.equal(res.ok, false);
      assert.equal(res.error, 'boom');
    });
  });

  describe('openFile() with FSA', () => {
    test('reads file, stores handle, fires onLoad, updates title', async () => {
      const handle = makeFakeHandle('opened.txt');
      // Pre-seed the handle's stored content via a write so getFile().text()
      // has something to return.
      const w = await handle.createWritable();
      await w.write('initial content');
      await w.close();

      installGlobals({
        showOpenFilePicker: async (opts) => {
          // The readwrite mode option is critical — without it Chrome
          // re-prompts on the first save. Pin it down.
          assert.equal(opts.mode, 'readwrite');
          return [handle];
        }
      });
      const web = await freshWeb();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });

      const res = await web.openFile();
      assert.equal(res.ok, true);
      assert.deepEqual(loaded, { filePath: 'opened.txt', content: 'initial content' });
      assert.equal(document.title, 'opened.txt — DedTxt');
    });

    test('returns {canceled:true} on AbortError', async () => {
      installGlobals({
        showOpenFilePicker: async () => {
          const err = new Error('user cancelled');
          err.name = 'AbortError';
          throw err;
        }
      });
      const web = await freshWeb();
      const res = await web.openFile();
      assert.deepEqual(res, { ok: false, canceled: true });
    });
  });

  describe('saveFile() with FSA', () => {
    test('first save prompts via picker, stores handle + currentName, clears dirty', async () => {
      const handle = makeFakeHandle('first.txt');
      let pickerCalls = 0;
      installGlobals({
        showSaveFilePicker: async () => { pickerCalls += 1; return handle; }
      });
      const web = await freshWeb();
      web.setDirty(true);

      const res = await web.saveFile('the content');
      assert.deepEqual(res, { ok: true, filePath: 'first.txt' });
      assert.equal(pickerCalls, 1);
      assert.deepEqual(handle.writes, ['the content']);
      // Title reflects the picked name with NO stale bullet (rc.21 fix).
      assert.equal(document.title, 'first.txt — DedTxt');
    });

    test('subsequent saves write silently to the stored handle — no second picker', async () => {
      // Regression: rc.20 lacked mode:'readwrite' so Chrome treated the
      // handle as read-only and re-prompted. Even with readwrite, the
      // handle must persist across saves.
      const handle = makeFakeHandle('persist.txt');
      let pickerCalls = 0;
      installGlobals({
        showSaveFilePicker: async () => { pickerCalls += 1; return handle; }
      });
      const web = await freshWeb();

      await web.saveFile('first body');
      await web.saveFile('second body');
      await web.saveFile('third body');

      assert.equal(pickerCalls, 1, 'picker must only appear on the first save');
      assert.deepEqual(handle.writes, ['first body', 'second body', 'third body']);
    });

    test('cancelling the picker returns {canceled:true} and does NOT set a handle', async () => {
      installGlobals({
        showSaveFilePicker: async () => {
          const err = new Error('cancelled');
          err.name = 'AbortError';
          throw err;
        }
      });
      const web = await freshWeb();

      const res = await web.saveFile('anything');
      assert.deepEqual(res, { ok: false, canceled: true });

      // Now a second saveFile must still prompt — we don't have a handle.
      let pickerCalls = 0;
      const handle = makeFakeHandle('eventually.txt');
      window.showSaveFilePicker = async () => { pickerCalls += 1; return handle; };
      await web.saveFile('retry');
      assert.equal(pickerCalls, 1);
    });

    test('writeHandle re-requests permission only when not already granted', async () => {
      // Simulate Chrome having downgraded the permission after idle.
      let queryCalls = 0;
      let requestCalls = 0;
      const handle = {
        name: 'idle.txt',
        queryPermission: async () => { queryCalls += 1; return 'prompt'; },
        requestPermission: async () => { requestCalls += 1; return 'granted'; },
        createWritable: async () => ({
          write: async () => {},
          close: async () => {}
        }),
        getFile: async () => ({ name: 'idle.txt', text: async () => '' })
      };
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();

      await web.saveFile('content');
      assert.equal(queryCalls, 1);
      assert.equal(requestCalls, 1);
    });

    test('writeHandle write failure surfaces as {ok:false} (not a silent crash)', async () => {
      const handle = {
        name: 'broken.txt',
        queryPermission: async () => 'granted',
        createWritable: async () => ({
          write: async () => { throw new Error('disk full'); },
          close: async () => {}
        }),
        getFile: async () => ({ name: 'broken.txt', text: async () => '' })
      };
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();

      // First save: picker path; the write error is caught at the inner
      // try and surfaces via the FSA branch's catch (returns ok:false).
      const res = await web.saveFile('payload');
      assert.equal(res.ok, false);
      assert.equal(res.error, 'disk full');
    });

    test('FSA save preserves plain ASCII verbatim', async () => {
      const handle = makeFakeHandle('ascii.txt');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();
      await web.saveFile('hello world');
      assert.equal(handle.writes[0], 'hello world');
    });

    test('FSA save→load roundtrip preserves plain ASCII', async () => {
      const handle = makeFakeHandle('ascii.txt');
      installGlobals({ showOpenFilePicker: async () => [handle] });
      const web = await freshWeb();
      const w = await handle.createWritable();
      await w.write('roundtrip content');
      await w.close();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });
      await web.openFile();
      assert.equal(loaded.content, 'roundtrip content');
    });

    test('FSA save preserves emoji single verbatim', async () => {
      const handle = makeFakeHandle('emoji.txt');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();
      await web.saveFile('😀');
      assert.equal(handle.writes[0], '😀');
    });

    test('FSA save→load roundtrip preserves emoji single', async () => {
      const handle = makeFakeHandle('emoji.txt');
      installGlobals({ showOpenFilePicker: async () => [handle] });
      const web = await freshWeb();
      const w = await handle.createWritable();
      await w.write('😀');
      await w.close();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });
      await web.openFile();
      assert.equal(loaded.content, '😀');
    });

    test('FSA save preserves emoji sequence verbatim', async () => {
      const handle = makeFakeHandle('seq.txt');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();
      await web.saveFile('👨‍👩‍👧');
      assert.equal(handle.writes[0], '👨‍👩‍👧');
    });

    test('FSA save→load roundtrip preserves emoji sequence', async () => {
      const handle = makeFakeHandle('seq.txt');
      installGlobals({ showOpenFilePicker: async () => [handle] });
      const web = await freshWeb();
      const w = await handle.createWritable();
      await w.write('👨‍👩‍👧');
      await w.close();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });
      await web.openFile();
      assert.equal(loaded.content, '👨‍👩‍👧');
    });

    test('FSA save preserves skin-tone modifier verbatim', async () => {
      const handle = makeFakeHandle('skin.txt');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();
      await web.saveFile('👍🏾');
      assert.equal(handle.writes[0], '👍🏾');
    });

    test('FSA save→load roundtrip preserves skin-tone modifier', async () => {
      const handle = makeFakeHandle('skin.txt');
      installGlobals({ showOpenFilePicker: async () => [handle] });
      const web = await freshWeb();
      const w = await handle.createWritable();
      await w.write('👍🏾');
      await w.close();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });
      await web.openFile();
      assert.equal(loaded.content, '👍🏾');
    });

    test('FSA save preserves ZWJ family verbatim', async () => {
      const handle = makeFakeHandle('zwj.txt');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();
      await web.saveFile('👨‍👧‍👦');
      assert.equal(handle.writes[0], '👨‍👧‍👦');
    });

    test('FSA save→load roundtrip preserves ZWJ family', async () => {
      const handle = makeFakeHandle('zwj.txt');
      installGlobals({ showOpenFilePicker: async () => [handle] });
      const web = await freshWeb();
      const w = await handle.createWritable();
      await w.write('👨‍👧‍👦');
      await w.close();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });
      await web.openFile();
      assert.equal(loaded.content, '👨‍👧‍👦');
    });

    test('FSA save preserves combining diacritics verbatim', async () => {
      const handle = makeFakeHandle('diac.txt');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();
      await web.saveFile('café');
      assert.equal(handle.writes[0], 'café');
    });

    test('FSA save→load roundtrip preserves combining diacritics', async () => {
      const handle = makeFakeHandle('diac.txt');
      installGlobals({ showOpenFilePicker: async () => [handle] });
      const web = await freshWeb();
      const w = await handle.createWritable();
      await w.write('café');
      await w.close();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });
      await web.openFile();
      assert.equal(loaded.content, 'café');
    });

    test('FSA save preserves mixed scripts verbatim', async () => {
      const handle = makeFakeHandle('mixed.txt');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();
      await web.saveFile('Hello, 世界! élève αβγ');
      assert.equal(handle.writes[0], 'Hello, 世界! élève αβγ');
    });

    test('FSA save→load roundtrip preserves mixed scripts', async () => {
      const handle = makeFakeHandle('mixed.txt');
      installGlobals({ showOpenFilePicker: async () => [handle] });
      const web = await freshWeb();
      const w = await handle.createWritable();
      await w.write('Hello, 世界! élève αβγ');
      await w.close();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });
      await web.openFile();
      assert.equal(loaded.content, 'Hello, 世界! élève αβγ');
    });

    test('FSA save preserves RTL text verbatim', async () => {
      const handle = makeFakeHandle('rtl.txt');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();
      await web.saveFile('שלום');
      assert.equal(handle.writes[0], 'שלום');
    });

    test('FSA save→load roundtrip preserves RTL text', async () => {
      const handle = makeFakeHandle('rtl.txt');
      installGlobals({ showOpenFilePicker: async () => [handle] });
      const web = await freshWeb();
      const w = await handle.createWritable();
      await w.write('שלום');
      await w.close();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });
      await web.openFile();
      assert.equal(loaded.content, 'שלום');
    });

    test('FSA save preserves shrug verbatim', async () => {
      const handle = makeFakeHandle('shrug.txt');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();
      await web.saveFile('¯\\_(ツ)_/¯');
      assert.equal(handle.writes[0], '¯\\_(ツ)_/¯');
    });

    test('FSA save→load roundtrip preserves shrug', async () => {
      const handle = makeFakeHandle('shrug.txt');
      installGlobals({ showOpenFilePicker: async () => [handle] });
      const web = await freshWeb();
      const w = await handle.createWritable();
      await w.write('¯\\_(ツ)_/¯');
      await w.close();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });
      await web.openFile();
      assert.equal(loaded.content, '¯\\_(ツ)_/¯');
    });

    test('FSA save preserves emdash + ellipsis verbatim', async () => {
      const handle = makeFakeHandle('punct.txt');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();
      await web.saveFile('—…');
      assert.equal(handle.writes[0], '—…');
    });

    test('FSA save→load roundtrip preserves emdash + ellipsis', async () => {
      const handle = makeFakeHandle('punct.txt');
      installGlobals({ showOpenFilePicker: async () => [handle] });
      const web = await freshWeb();
      const w = await handle.createWritable();
      await w.write('—…');
      await w.close();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });
      await web.openFile();
      assert.equal(loaded.content, '—…');
    });

    test('FSA save preserves NUL byte verbatim', async () => {
      const handle = makeFakeHandle('nul.txt');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();
      await web.saveFile('a\x00b');
      assert.equal(handle.writes[0], 'a\x00b');
    });

    test('FSA save→load roundtrip preserves NUL byte', async () => {
      const handle = makeFakeHandle('nul.txt');
      installGlobals({ showOpenFilePicker: async () => [handle] });
      const web = await freshWeb();
      const w = await handle.createWritable();
      await w.write('a\x00b');
      await w.close();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });
      await web.openFile();
      assert.equal(loaded.content, 'a\x00b');
    });
  });

  describe('saveFile() — non-FSA (download-fallback) path', () => {
    test('first save triggers a Blob download with the default "Untitled.txt" name when no asker', async () => {
      const env = installGlobals();
      const web = await freshWeb();

      const res = await web.saveFile('some text');
      assert.deepEqual(res, { ok: true, filePath: 'Untitled.txt' });
      assert.equal(env.anchors.find(a => a.download).download, 'Untitled.txt');
      assert.equal(env.blobs.length, 1);
      assert.deepEqual(env.blobs[0].parts, ['some text']);
      assert.equal(env.blobs[0].options.type, 'text/plain;charset=utf-8');
    });

    test('asker is called once on first save and the name is remembered for the second', async () => {
      const env = installGlobals();
      const web = await freshWeb();
      let askCount = 0;
      web.setNameAsker(async (suggested) => { askCount += 1; return `my-${suggested}`; });

      const r1 = await web.saveFile('first');
      assert.equal(askCount, 1);
      assert.equal(r1.filePath, 'my-Untitled.txt');
      assert.equal(document.title, 'my-Untitled.txt — DedTxt');

      const r2 = await web.saveFile('second');
      assert.equal(askCount, 1, 'asker must only fire once');
      assert.equal(r2.filePath, 'my-Untitled.txt');
      assert.equal(env.blobs.length, 2);
    });

    test('cancelling the asker returns {canceled:true} and does NOT set a name', async () => {
      installGlobals();
      const web = await freshWeb();
      web.setNameAsker(async () => null);

      const res = await web.saveFile('content');
      assert.deepEqual(res, { ok: false, canceled: true });
      // Title must not have been set.
      assert.equal(document.title, 'DedTxt');

      // Next save must still ask (no name was stored).
      let askCount = 0;
      web.setNameAsker(async () => { askCount += 1; return 'finally.txt'; });
      await web.saveFile('retry');
      assert.equal(askCount, 1);
    });

    test('three saves result in three blobs (no silent re-use of handle)', async () => {
      const env = installGlobals();
      const web = await freshWeb();
      web.setNameAsker(async () => 'foo.txt');

      await web.saveFile('one');
      await web.saveFile('two');
      await web.saveFile('three');

      assert.equal(env.blobs.length, 3);
      assert.deepEqual(env.blobs.map(b => b.parts[0]), ['one', 'two', 'three']);
      assert.equal(document.title, 'foo.txt — DedTxt');
    });

    test('opening a file first skips the prompt — currentName already set', async () => {
      const env = installGlobals();
      const web = await freshWeb();
      web.onLoad(() => {});
      let askCount = 0;
      web.setNameAsker(async () => { askCount += 1; return 'should-not-be-asked.txt'; });

      await web.openDroppedFile(makeFakeFile('readme.md', 'old'));
      assert.equal(document.title, 'readme.md — DedTxt');

      const res = await web.saveFile('new');
      assert.equal(askCount, 0);
      assert.equal(res.filePath, 'readme.md');
      assert.equal(env.blobs.length, 1);
      assert.equal(document.title, 'readme.md — DedTxt');
    });

    test('no asker registered → falls back to silent "Untitled.txt" download', async () => {
      // Backwards-compat with rc.22-23 behaviour for any caller that
      // doesn't wire up the prompter.
      const env = installGlobals();
      const web = await freshWeb();

      const res = await web.saveFile('content');
      assert.deepEqual(res, { ok: true, filePath: 'Untitled.txt' });
      assert.equal(env.blobs.length, 1);
      assert.deepEqual(env.blobs[0].parts, ['content']);
      // Title still doesn't claim "Untitled.txt" — rc.22 invariant.
      assert.equal(document.title, 'DedTxt');
    });

    test('asker is only consulted on the non-FSA path, not on FSA saves', async () => {
      const handle = makeFakeHandle('fsa.txt');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();
      let askCount = 0;
      web.setNameAsker(async () => { askCount += 1; return 'wrong.txt'; });

      const res = await web.saveFile('payload');
      assert.equal(res.ok, true);
      assert.equal(res.filePath, 'fsa.txt');
      assert.equal(askCount, 0, 'FSA save-picker path must not call the in-app asker');
    });
  });

  describe('cross-method state interactions', () => {
    test('open → modify → save → modify → save: only one picker total', async () => {
      // The full workflow the user described in their bug report.
      const handle = makeFakeHandle('workflow.txt');
      let pickerCalls = 0;
      installGlobals({
        showOpenFilePicker: async () => [handle],
        showSaveFilePicker: async () => { pickerCalls += 1; return handle; }
      });
      // Seed the handle with initial content
      const w0 = await handle.createWritable();
      await w0.write('original');
      await w0.close();

      const web = await freshWeb();
      web.onLoad(() => {});

      await web.openFile();
      assert.equal(document.title, 'workflow.txt — DedTxt');

      web.setDirty(true);
      assert.equal(document.title, '• workflow.txt • — DedTxt');
      await web.saveFile('edit one');

      web.setDirty(true);
      await web.saveFile('edit two');

      assert.equal(pickerCalls, 0, 'open established the handle — save should never prompt');
      // handle.writes also has the initial seed write
      assert.deepEqual(handle.writes, ['original', 'edit one', 'edit two']);
    });

    test('newFile() between two saves forces the picker for the second save', async () => {
      const handleA = makeFakeHandle('a.txt');
      const handleB = makeFakeHandle('b.txt');
      const queue = [handleA, handleB];
      let pickerCalls = 0;
      installGlobals({
        showSaveFilePicker: async () => { pickerCalls += 1; return queue.shift(); }
      });
      const web = await freshWeb();

      await web.saveFile('aaa');
      assert.equal(pickerCalls, 1);

      web.newFile();
      await web.saveFile('bbb');
      assert.equal(pickerCalls, 2);
      assert.deepEqual(handleA.writes, ['aaa']);
      assert.deepEqual(handleB.writes, ['bbb']);
    });
  });

  describe('binary file handling', () => {
    test('dropping an image file fires onLoad with isBinary + blobUrl, no content', async () => {
      const revoked = [];
      installGlobals();
      globalThis.URL.revokeObjectURL = (u) => revoked.push(u);
      const web = await freshWeb();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });

      const res = await web.openDroppedFile(makeFakeBinaryFile('photo.png', 'image/png'));
      assert.deepEqual(res, { ok: true });
      assert.equal(loaded.isBinary, true);
      assert.equal(loaded.mimeType, 'image/png');
      assert.equal(loaded.blobUrl, 'blob:fake-url');
      assert.equal(loaded.content, undefined);
      assert.equal(document.title, 'photo.png — DedTxt');
    });

    test('dropping a PDF file fires onLoad with isBinary + application/pdf', async () => {
      installGlobals();
      const web = await freshWeb();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });

      await web.openDroppedFile(makeFakeBinaryFile('doc.pdf', 'application/pdf'));
      assert.equal(loaded.isBinary, true);
      assert.equal(loaded.mimeType, 'application/pdf');
      assert.equal(loaded.blobUrl, 'blob:fake-url');
    });

    test('dropping a file with no MIME but image extension uses extension fallback', async () => {
      installGlobals();
      const web = await freshWeb();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });

      await web.openDroppedFile(makeFakeBinaryFile('photo.webp', ''));
      assert.equal(loaded.isBinary, true);
      assert.equal(loaded.mimeType, 'image/webp');
    });

    test('opening a second binary revokes the first blob URL', async () => {
      const revoked = [];
      installGlobals();
      globalThis.URL.revokeObjectURL = (u) => revoked.push(u);
      const web = await freshWeb();
      web.onLoad(() => {});

      await web.openDroppedFile(makeFakeBinaryFile('a.png', 'image/png'));
      assert.equal(revoked.length, 0);

      await web.openDroppedFile(makeFakeBinaryFile('b.png', 'image/png'));
      assert.equal(revoked.length, 1, 'first blob URL must be revoked when second file loads');
      assert.equal(revoked[0], 'blob:fake-url');
    });

    test('newFile() after binary revokes the blob URL', async () => {
      const revoked = [];
      installGlobals();
      globalThis.URL.revokeObjectURL = (u) => revoked.push(u);
      const web = await freshWeb();
      web.onLoad(() => {});

      await web.openDroppedFile(makeFakeBinaryFile('img.jpg', 'image/jpeg'));
      assert.equal(revoked.length, 0);

      web.newFile();
      assert.equal(revoked.length, 1, 'blob URL must be revoked on newFile()');
    });

    test('file with unknown extension and no MIME defaults to text path', async () => {
      installGlobals();
      const web = await freshWeb();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });

      // .zzz has no MIME mapping, browser gives empty string — treat as text
      const file = { name: 'data.zzz', type: '', text: async () => 'raw text content' };
      await web.openDroppedFile(file);
      assert.equal(loaded.isBinary, undefined);
      assert.equal(loaded.content, 'raw text content');
    });

    test('FSA open of image file fires onLoad with isBinary, no handle retained', async () => {
      const fakeFile = { name: 'shot.png', type: 'image/png' };
      const handle = {
        name: 'shot.png',
        queryPermission: async () => 'granted',
        getFile: async () => fakeFile,
      };
      installGlobals({ showOpenFilePicker: async (opts) => {
        assert.equal(opts.mode, 'readwrite');
        return [handle];
      } });
      const web = await freshWeb();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });

      const res = await web.openFile();
      assert.equal(res.ok, true);
      assert.equal(loaded.isBinary, true);
      assert.equal(loaded.mimeType, 'image/png');
      assert.equal(loaded.blobUrl, 'blob:fake-url');

      // No handle retained for binary files, so next save prompts
      let pickerCalls = 0;
      window.showSaveFilePicker = async () => { pickerCalls += 1; return handle; };
      await web.saveFile('text');
      assert.equal(pickerCalls, 1, 'binary open must not retain the FSA handle');
    });
  });
});
