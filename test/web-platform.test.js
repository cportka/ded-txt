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
    // Real index.html ships with <title>dedtxt</title>; mirror that so
    // tests for "title shouldn't change after a download-fallback save"
    // start from the same baseline.
    title: 'dedtxt',
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

// Build a fake FSA handle that captures every write and exposes the
// stored payload back through getFile() with the full File-ish surface
// web.js now reads from (arrayBuffer + size, plus text() for legacy).
function makeFakeHandle(name) {
  let stored = '';
  const writes = [];
  return {
    name,
    writes,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    createWritable: async () => ({
      write: async (payload) => { writes.push(payload); stored = payload; },
      close: async () => {}
    }),
    getFile: async () => {
      const bytes = stored instanceof Uint8Array
        ? stored
        : new TextEncoder().encode(stored);
      return {
        name,
        size: bytes.byteLength,
        text: async () => stored instanceof Uint8Array
          ? new TextDecoder().decode(bytes)
          : stored,
        arrayBuffer: async () => {
          const ab = new ArrayBuffer(bytes.length);
          new Uint8Array(ab).set(bytes);
          return ab;
        },
      };
    }
  };
}

// Build a fake dropped/picked File. `content` is a string (UTF-8 encoded)
// or a Uint8Array of raw bytes. The stub exposes both `.text()` (legacy)
// and the .arrayBuffer() + .size that web.js now uses for the universal
// raw-bytes read path.
function makeFakeFile(name, content) {
  const bytes = typeof content === 'string'
    ? new TextEncoder().encode(content)
    : content instanceof Uint8Array ? content : new Uint8Array(content);
  return {
    name,
    size: bytes.byteLength,
    text: async () => typeof content === 'string'
      ? content
      : new TextDecoder().decode(bytes),
    arrayBuffer: async () => {
      const ab = new ArrayBuffer(bytes.length);
      new Uint8Array(ab).set(bytes);
      return ab;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('src/platform/web.js', () => {
  beforeEach(() => { uninstallGlobals(); });

  describe('newFile() and initial title', () => {
    test('newFile() sets the tab title to bare "dedtxt"', async () => {
      installGlobals();
      const web = await freshWeb();
      web.newFile();
      assert.equal(document.title, 'dedtxt');
    });

    test('newFile() resets prior name + dirty state', async () => {
      installGlobals();
      const web = await freshWeb();
      await web.openDroppedFile(makeFakeFile('a.txt', 'hi'));
      web.setDirty(true);
      assert.equal(document.title, '• a.txt • — dedtxt');

      web.newFile();
      assert.equal(document.title, 'dedtxt');
      assert.equal(window.onbeforeunload, null);
    });
  });

  describe('title rendering', () => {
    test('no file → "dedtxt"', async () => {
      installGlobals();
      const web = await freshWeb();
      web.setDirty(false);
      assert.equal(document.title, 'dedtxt');
    });

    test('no file but dirty → still "dedtxt" (no bullet without a name)', async () => {
      installGlobals();
      const web = await freshWeb();
      web.setDirty(true);
      assert.equal(document.title, 'dedtxt');
    });

    test('named file clean → "name — dedtxt"', async () => {
      installGlobals();
      const web = await freshWeb();
      web.setName('notes.md');
      web.setDirty(false);
      assert.equal(document.title, 'notes.md — dedtxt');
    });

    test('named file dirty → "• name • — dedtxt"', async () => {
      installGlobals();
      const web = await freshWeb();
      web.setName('notes.md');
      web.setDirty(true);
      assert.equal(document.title, '• notes.md • — dedtxt');
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
      assert.equal(document.title, 'readme.md — dedtxt');
      web.setDirty(true);
      assert.equal(document.title, '• readme.md • — dedtxt');
      web.setDirty(false);
      assert.equal(document.title, 'readme.md — dedtxt');
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
      assert.equal(document.title, 'b.txt — dedtxt');
    });

    test('opening a second file replaces the title — not stuck on the first', async () => {
      // Regression: rc.20 bug — fireLoad didn't call updateTitle, so opening
      // file B over a clean file A left the tab showing A.
      installGlobals();
      const web = await freshWeb();
      web.onLoad(() => {});

      await web.openDroppedFile(makeFakeFile('A.txt', 'one'));
      assert.equal(document.title, 'A.txt — dedtxt');

      await web.openDroppedFile(makeFakeFile('B.txt', 'two'));
      assert.equal(document.title, 'B.txt — dedtxt');
    });

    test('a dirty bullet from the prior file does not leak into the new title', async () => {
      installGlobals();
      const web = await freshWeb();
      web.onLoad(() => {});

      await web.openDroppedFile(makeFakeFile('A.txt', 'one'));
      web.setDirty(true);
      assert.equal(document.title, '• A.txt • — dedtxt');

      await web.openDroppedFile(makeFakeFile('B.txt', 'two'));
      assert.equal(document.title, 'B.txt — dedtxt');
    });

    test('returns {ok:false} when file.arrayBuffer() throws', async () => {
      installGlobals();
      const web = await freshWeb();
      const res = await web.openDroppedFile({
        name: 'broken.txt',
        size: 5,
        arrayBuffer: async () => { throw new Error('boom'); }
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
      assert.equal(document.title, 'opened.txt — dedtxt');
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
      assert.equal(document.title, 'first.txt — dedtxt');
    });

    test('picker suggestedName defaults to untitled.txt, then uses the known name', async () => {
      const suggested = [];
      const handle = makeFakeHandle('picked.txt');
      installGlobals({ showSaveFilePicker: async (opts) => { suggested.push(opts.suggestedName); return handle; } });
      const web = await freshWeb();

      await web.saveFile('a');          // no name yet → default
      web.newFile();                    // drop the handle + name
      web.setName('notes.md');          // simulate an opened / known name
      await web.saveFile('b');          // → suggests the known name
      assert.deepEqual(suggested, ['untitled.txt', 'notes.md']);
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
    test('first save downloads a Blob named "untitled.txt" but does NOT claim that name in the title', async () => {
      const env = installGlobals();
      const web = await freshWeb();

      const res = await web.saveFile('some text');
      // unconfirmed: the download API can't verify the write landed, so the
      // renderer must keep the buffer dirty off this result (FUTURE.md item).
      assert.deepEqual(res, { ok: true, unconfirmed: true, filePath: 'untitled.txt' });
      assert.equal(env.anchors.find(a => a.download).download, 'untitled.txt');
      assert.equal(env.blobs.length, 1);
      assert.deepEqual(env.blobs[0].parts, ['some text']);
      assert.equal(env.blobs[0].options.type, 'text/plain;charset=utf-8');
      // The download API never reports what the browser's own save dialog
      // saved the file as, so the tab title must NOT assert "untitled.txt".
      assert.equal(document.title, 'dedtxt');
    });

    test('each save re-downloads — there is no FSA handle to write through', async () => {
      const env = installGlobals();
      const web = await freshWeb();

      await web.saveFile('one');
      await web.saveFile('two');
      await web.saveFile('three');

      assert.equal(env.blobs.length, 3);
      assert.deepEqual(env.blobs.map(b => b.parts[0]), ['one', 'two', 'three']);
      assert.equal(document.title, 'dedtxt');
    });

    test('an opened file reuses its name for the download (and the title keeps showing it)', async () => {
      const env = installGlobals();
      const web = await freshWeb();
      web.onLoad(() => {});

      await web.openDroppedFile(makeFakeFile('readme.md', 'old'));
      assert.equal(document.title, 'readme.md — dedtxt');

      const res = await web.saveFile('new');
      assert.equal(res.filePath, 'readme.md');
      assert.equal(env.anchors.find(a => a.download).download, 'readme.md');
      assert.equal(env.blobs.length, 1);
      assert.equal(document.title, 'readme.md — dedtxt');
    });

    test('binary save downloads with the octet-stream mime', async () => {
      const env = installGlobals();
      const web = await freshWeb();

      // Latin-1 "ÿ" (single byte 0xFF) saved in binary mode.
      const res = await web.saveFile('ÿ', true);
      assert.equal(res.ok, true);
      assert.equal(env.blobs.length, 1);
      assert.equal(env.blobs[0].options.type, 'application/octet-stream');
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
      assert.equal(document.title, 'workflow.txt — dedtxt');

      web.setDirty(true);
      assert.equal(document.title, '• workflow.txt • — dedtxt');
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

  describe('raw-file decoding (UTF-8 text vs Latin-1 binary)', () => {
    test('valid-UTF-8 file with no NULL bytes → text mode, no isBinary flag', async () => {
      installGlobals();
      const web = await freshWeb();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });

      await web.openDroppedFile(makeFakeFile('greeting.txt', 'héllo'));
      assert.equal(loaded.content, 'héllo');
      assert.equal(loaded.isBinary, undefined);
    });

    test('invalid-UTF-8 bytes → binary mode, Latin-1 one-char-per-byte', async () => {
      installGlobals();
      const web = await freshWeb();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });

      // PNG magic + a NULL + 0xFF. Not valid UTF-8 (0xFF cannot begin a UTF-8
      // sequence), so the decoder must fall back to Latin-1.
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
      await web.openDroppedFile(makeFakeFile('photo.png', bytes));
      assert.equal(loaded.isBinary, true);
      assert.equal(loaded.content.length, 6);
      assert.equal(loaded.content.charCodeAt(0), 0x89);
      assert.equal(loaded.content.charCodeAt(1), 0x50); // 'P'
      assert.equal(loaded.content.charCodeAt(4), 0x00);
      assert.equal(loaded.content.charCodeAt(5), 0xff);
    });

    test('valid UTF-8 with an embedded NULL → binary mode (NULL forces it)', async () => {
      installGlobals();
      const web = await freshWeb();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });

      // "hi\0there" is technically valid UTF-8 but the NULL marks it binary.
      const bytes = new Uint8Array([0x68, 0x69, 0x00, 0x74, 0x68, 0x65, 0x72, 0x65]);
      await web.openDroppedFile(makeFakeFile('mix.bin', bytes));
      assert.equal(loaded.isBinary, true);
      assert.equal(loaded.content.length, 8);
      assert.equal(loaded.content.charCodeAt(2), 0x00);
    });

    test('binary save writes a Uint8Array whose bytes equal the source file', async () => {
      // Round-trip pin: open binary → textarea has Latin-1 string → saveFile
      // with isBinary=true must encode each char's low byte back to the
      // original file bytes.
      const original = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x42]);
      const handle = makeFakeHandle('photo.png');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();
      let loaded = null;
      web.onLoad((p) => { loaded = p; });

      await web.openDroppedFile(makeFakeFile('photo.png', original));
      assert.equal(loaded.isBinary, true);

      const res = await web.saveFile(loaded.content, true);
      assert.equal(res.ok, true);
      assert.equal(handle.writes.length, 1);
      const written = handle.writes[0];
      assert.ok(written instanceof Uint8Array, 'binary save must write a Uint8Array');
      assert.deepEqual(Array.from(written), Array.from(original));
    });

    test('text save still writes a string (text-mode behaviour unchanged)', async () => {
      const handle = makeFakeHandle('notes.txt');
      installGlobals({ showSaveFilePicker: async () => handle });
      const web = await freshWeb();

      await web.saveFile('plain content', false);
      assert.deepEqual(handle.writes, ['plain content']);
    });

    test('file over the 25 MB cap is refused with an error, onLoad never fires', async () => {
      installGlobals();
      const web = await freshWeb();
      let loadedCalled = false;
      web.onLoad(() => { loadedCalled = true; });

      // Stub a file too large to read; .arrayBuffer() should never be called.
      const huge = {
        name: 'huge.bin',
        size: 26 * 1024 * 1024,
        arrayBuffer: async () => { throw new Error('should not be called for oversized files'); },
      };
      const res = await web.openDroppedFile(huge);
      assert.equal(res.ok, false);
      assert.match(res.error, /too large/i);
      assert.equal(loadedCalled, false);
    });
  });
});

describe('normalizeFilename() (src/platform/web.js)', () => {
  async function fresh() {
    const cb = `?cb=${Date.now()}-${Math.random()}`;
    const mod = await import('../src/platform/web.js' + cb);
    return mod.normalizeFilename;
  }

  test('keeps an existing extension', async () => {
    const n = await fresh();
    assert.equal(n('notes.md'), 'notes.md');
    assert.equal(n('archive.tar.gz'), 'archive.tar.gz');
    assert.equal(n('untitled.txt'), 'untitled.txt');
  });

  test('appends .txt when no extension is given', async () => {
    const n = await fresh();
    assert.equal(n('notes'), 'notes.txt');
    assert.equal(n('my report'), 'my report.txt');
  });

  test('blank / nullish → untitled.txt', async () => {
    const n = await fresh();
    assert.equal(n(''), 'untitled.txt');
    assert.equal(n('   '), 'untitled.txt');
    assert.equal(n(null), 'untitled.txt');
    assert.equal(n(undefined), 'untitled.txt');
  });

  test('strips trailing dots before deciding on an extension', async () => {
    const n = await fresh();
    assert.equal(n('foo.'), 'foo.txt');
    assert.equal(n('foo...'), 'foo.txt');
  });

  test('neutralizes path separators (download-name safety)', async () => {
    const n = await fresh();
    assert.equal(n('/abs/path.txt'), '_abs_path.txt');
    assert.ok(!/[\\/]/.test(n('../../etc/passwd')), 'no path separators remain');
  });
});

describe('launchQueue file-handler integration (src/platform/web.js)', () => {
  const { beforeEach: beforeEachLQ } = require('node:test');
  beforeEachLQ(() => { uninstallGlobals(); });

  // The consumer is registered at module load, so launchQueue must exist on
  // window BEFORE the import. Returns the captured consumer for manual firing.
  function installWithLaunchQueue() {
    const env = installGlobals();
    const captured = {};
    env.win.launchQueue = {
      setConsumer(fn) { captured.consumer = fn; }
    };
    return { env, captured };
  }

  test('registers a consumer when window.launchQueue exists', async () => {
    const { captured } = installWithLaunchQueue();
    await freshWeb();
    assert.equal(typeof captured.consumer, 'function');
  });

  test('no launchQueue on window → module still loads fine', async () => {
    installGlobals();
    const web = await freshWeb();
    assert.equal(web.name, 'web');
  });

  test('a launched file flows through onLoad and adopts the handle for silent re-save', async () => {
    const { captured } = installWithLaunchQueue();
    const web = await freshWeb();
    let loaded = null;
    web.onLoad((p) => { loaded = p; });

    const handle = makeFakeHandle('launched.txt');
    // Seed the fake handle's stored content via its own write surface.
    const w = await handle.createWritable();
    await w.write('from the OS');
    await w.close();

    await captured.consumer({ files: [handle] });
    assert.deepEqual(loaded, { filePath: 'launched.txt', content: 'from the OS' });
    assert.equal(document.title, 'launched.txt — dedtxt');

    // Re-save writes through the launch handle silently — no picker.
    const res = await web.saveFile('edited');
    assert.deepEqual(res, { ok: true, filePath: 'launched.txt' });
    assert.deepEqual(handle.writes, ['from the OS', 'edited']);
  });

  test('a launch delivered before onLoad subscribes is buffered, not dropped', async () => {
    const { captured } = installWithLaunchQueue();
    const web = await freshWeb();

    const handle = makeFakeHandle('early.txt');
    const w = await handle.createWritable();
    await w.write('early bird');
    await w.close();

    // Fire the launch BEFORE the renderer registers its callback.
    await captured.consumer({ files: [handle] });

    let loaded = null;
    web.onLoad((p) => { loaded = p; });
    assert.deepEqual(loaded, { filePath: 'early.txt', content: 'early bird' });
  });

  test('an empty or malformed launch is ignored', async () => {
    const { captured } = installWithLaunchQueue();
    const web = await freshWeb();
    let loadedCalled = false;
    web.onLoad(() => { loadedCalled = true; });

    await captured.consumer({ files: [] });
    await captured.consumer({});
    await captured.consumer(null);
    await captured.consumer({ files: [{ notAHandle: true }] });
    assert.equal(loadedCalled, false);
  });

  test('a handle whose getFile() throws leaves the buffer untouched', async () => {
    const { captured } = installWithLaunchQueue();
    const web = await freshWeb();
    let loadedCalled = false;
    web.onLoad(() => { loadedCalled = true; });

    await captured.consumer({ files: [{ getFile: async () => { throw new Error('gone'); } }] });
    assert.equal(loadedCalled, false);
    assert.equal(document.title, 'dedtxt');
  });
});
