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
      assert.equal(document.title, 'a.txt • — DedTxt');

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

    test('named file dirty → "name • — DedTxt"', async () => {
      installGlobals();
      const web = await freshWeb();
      web.setName('notes.md');
      web.setDirty(true);
      assert.equal(document.title, 'notes.md • — DedTxt');
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
      assert.equal(document.title, 'A.txt • — DedTxt');

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
  });

  describe('saveFile() download fallback (no FSA)', () => {
    test('triggers a download Blob with the file content', async () => {
      const env = installGlobals(); // no showSaveFilePicker stubbed
      const web = await freshWeb();

      const res = await web.saveFile('safari payload');
      assert.equal(res.ok, true);
      assert.equal(res.filePath, 'Untitled.txt');

      assert.equal(env.blobs.length, 1);
      assert.deepEqual(env.blobs[0].parts, ['safari payload']);
      assert.equal(env.blobs[0].options.type, 'text/plain;charset=utf-8');
    });

    test('does NOT label the tab "Untitled.txt" when no real file is open', async () => {
      // Regression: rc.21 still wrote currentName = 'Untitled.txt' in the
      // fallback path, so the title falsely claimed a name after every
      // Safari/Firefox save.
      installGlobals();
      const web = await freshWeb();

      await web.saveFile('content');
      assert.equal(document.title, 'DedTxt');
    });

    test('preserves the real opened filename in the title across a fallback save', async () => {
      installGlobals();
      const web = await freshWeb();
      web.onLoad(() => {});

      await web.openDroppedFile(makeFakeFile('myfile.txt', 'old'));
      assert.equal(document.title, 'myfile.txt — DedTxt');

      await web.saveFile('new'); // download fallback (no save picker)
      assert.equal(document.title, 'myfile.txt — DedTxt');
    });
  });

  describe('UTF-8 / emoji / weird ASCII roundtrip', () => {
    // The editor stores raw JS strings (UTF-16 internally, but the full
    // Unicode codepoint set). Anything we receive on load should land in
    // the loadCb verbatim; anything we save should land in the write call
    // verbatim. These tests pin that down for cases that historically
    // tripped up text editors.
    const cases = [
      ['plain ASCII', 'Hello, world.'],
      ['emoji single', '🎉'],
      ['emoji sequence', '🎉🎂🥳'],
      ['skin-tone modifier', '👍🏽'],
      ['ZWJ family', '👨‍👩‍👧‍👦'],
      ['combining diacritics', 'Naïve café résumé'],
      ['mixed scripts', '日本語 + 中文 + Ελληνικά + עברית'],
      ['RTL text', 'مرحبا بالعالم'],
      ['shrug', '¯\\_(ツ)_/¯'],
      ['emdash + ellipsis', 'one — two … three'],
      ['NUL byte', 'a b'],
      ['high BMP', 'snowman: ☃'],
      ['supplementary plane', 'mathbold: 𝐀𝐁𝐂'],
      ['mixed CRLF / LF / CR', 'a\r\nb\nc\rd'],
      ['trailing newline', 'tail\n'],
      ['only whitespace', '   \t\n  ']
    ];

    for (const [label, content] of cases) {
      test(`load preserves ${label} verbatim`, async () => {
        installGlobals();
        const web = await freshWeb();
        let received = null;
        web.onLoad((p) => { received = p.content; });

        await web.openDroppedFile(makeFakeFile('x.txt', content));
        assert.equal(received, content);
      });

      test(`download-fallback save preserves ${label} verbatim`, async () => {
        const env = installGlobals();
        const web = await freshWeb();
        await web.saveFile(content);
        assert.equal(env.blobs.length, 1);
        assert.deepEqual(env.blobs[0].parts, [content]);
      });

      test(`FSA save preserves ${label} verbatim`, async () => {
        const handle = makeFakeHandle('x.txt');
        installGlobals({ showSaveFilePicker: async () => handle });
        const web = await freshWeb();
        await web.saveFile(content);
        assert.deepEqual(handle.writes, [content]);
      });

      test(`FSA save→load roundtrip preserves ${label}`, async () => {
        // Most meaningful end-to-end: write via FSA, then reading the same
        // handle back via getFile().text() returns the exact same string.
        const handle = makeFakeHandle('rt.txt');
        installGlobals({
          showSaveFilePicker: async () => handle,
          showOpenFilePicker: async () => [handle]
        });
        const web = await freshWeb();
        let reloaded = null;
        web.onLoad((p) => { reloaded = p.content; });

        await web.saveFile(content);
        // Drop the handle association so openFile reads via the picker.
        web.newFile();
        await web.openFile();
        assert.equal(reloaded, content);
      });
    }

    test('shrug specifically — "¯\\_(ツ)_/¯" survives load + FSA save', async () => {
      const shrug = '¯\\_(ツ)_/¯';
      const handle = makeFakeHandle('shrug.txt');
      installGlobals({
        showSaveFilePicker: async () => handle,
        showOpenFilePicker: async () => [handle]
      });
      const web = await freshWeb();
      let loaded = null;
      web.onLoad((p) => { loaded = p.content; });

      await web.openDroppedFile(makeFakeFile('shrug.txt', shrug));
      assert.equal(loaded, shrug);

      await web.saveFile(shrug);
      assert.deepEqual(handle.writes, [shrug]);
    });
  });

  describe('setDirty() side effects', () => {
    test('true installs onbeforeunload, false removes it', async () => {
      installGlobals();
      const web = await freshWeb();
      web.setName('foo.txt');
      web.setDirty(true);
      assert.equal(typeof window.onbeforeunload, 'function');

      web.setDirty(false);
      assert.equal(window.onbeforeunload, null);
    });

    test('coerces truthy/falsy values', async () => {
      installGlobals();
      const web = await freshWeb();
      web.setName('foo.txt');
      web.setDirty(1);
      assert.equal(document.title, 'foo.txt • — DedTxt');
      web.setDirty(0);
      assert.equal(document.title, 'foo.txt — DedTxt');
    });
  });

  describe('non-FSA save: in-app filename prompter', () => {
    // Firefox / Safari / iOS have no File System Access API. The renderer
    // registers an async name-asker via web.setNameAsker so the first save
    // in those browsers can capture a filename, paint it in the tab, and
    // reuse it as the suggested download name on subsequent saves.

    test('first save with null currentName invokes the asker', async () => {
      const env = installGlobals(); // no FSA stubs → download-fallback path
      const web = await freshWeb();
      let askedWith = null;
      web.setNameAsker(async (suggested) => { askedWith = suggested; return 'notes.txt'; });

      const res = await web.saveFile('hi');
      assert.equal(askedWith, 'Untitled.txt');
      assert.deepEqual(res, { ok: true, filePath: 'notes.txt' });
      // currentName persists; title reflects it.
      assert.equal(document.title, 'notes.txt — DedTxt');
      // Blob carries the actual content.
      assert.equal(env.blobs.length, 1);
      assert.deepEqual(env.blobs[0].parts, ['hi']);
    });

    test('asker returning null cancels the save without state changes', async () => {
      const env = installGlobals();
      const web = await freshWeb();
      web.setNameAsker(async () => null);

      const res = await web.saveFile('hi');
      assert.deepEqual(res, { ok: false, canceled: true });
      // No blob created, currentName not set, title untouched.
      assert.equal(env.blobs.length, 0);
      assert.equal(document.title, 'DedTxt');
    });

    test('second save reuses currentName and does NOT re-invoke the asker', async () => {
      const env = installGlobals();
      const web = await freshWeb();
      let askCount = 0;
      web.setNameAsker(async () => { askCount += 1; return 'foo.txt'; });

      await web.saveFile('one');
      await web.saveFile('two');
      await web.saveFile('three');

      assert.equal(askCount, 1, 'asker fires once total');
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
      assert.equal(document.title, 'workflow.txt • — DedTxt');
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
});
