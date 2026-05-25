// Tauri platform: bridges to the Rust main via window.__TAURI__ globals
// (enabled by withGlobalTauri = true in tauri.conf.json). Mirrors the same
// surface as the old electron.js so renderer.js doesn't care which runtime
// it's in.
//
// The title bar (filename + dirty bullet) is computed in Rust based on the
// current path + the dirty flag pushed via set_dirty, so setName() here is
// a no-op.

const t = (typeof window !== 'undefined') ? (window.__TAURI__ || null) : null;
const invoke = t ? t.core.invoke : null;
const listen = t ? t.event.listen : null;

let loadCb = null;
let newCb = null;
let saveCb = null;
let saveAndCloseCb = null;
const pendingLoads = [];

function emitLoad(payload) {
  if (loadCb) loadCb(payload);
  else pendingLoads.push(payload);
}

function buildLoadPayload(result) {
  const payload = { filePath: result.filePath, content: result.content };
  if (result.isBinary) payload.isBinary = true;
  return payload;
}

async function openByPath(path) {
  if (!invoke || !path) return;
  const result = await invoke('open_path', { path });
  if (result && result.ok) {
    emitLoad(buildLoadPayload(result));
  }
}

if (listen) {
  // Rust pushes paths here for files opened via macOS "Open with…",
  // second-instance launches, etc.
  listen('dt://open-path', (e) => { openByPath(e.payload); });

  // Menu actions from the system menu bar.
  listen('dt://menu-new', () => { if (newCb) newCb(); });
  listen('dt://menu-save', () => { if (saveCb) saveCb(); });
  listen('dt://save-and-close', () => { if (saveAndCloseCb) saveAndCloseCb(); });

  // Tauri's native drag-drop event — unlike DOM drop, this includes real
  // file system paths because the OS, not the browser, handled the gesture.
  listen('tauri://drag-drop', (e) => {
    const paths = e.payload && e.payload.paths;
    if (paths && paths.length) openByPath(paths[0]);
  });
}

const tauri = {
  name: 'tauri',

  async openFile() {
    const result = await invoke('open_file');
    if (result && result.ok) {
      emitLoad(buildLoadPayload(result));
    }
    return result ? { ok: result.ok, filePath: result.filePath, canceled: result.canceled, error: result.error } : { ok: false };
  },

  async saveFile(content, isBinary) {
    return invoke('save_file', { content, isBinary: !!isBinary });
  },

  async openDroppedFile(_file) {
    // Tauri's native drag-drop listener (above) handles real-path opening.
    // The DOM File object passed here has no usable path, so this is a no-op.
    return { ok: true };
  },

  setDirty(dirty) {
    if (invoke) invoke('set_dirty', { dirty: !!dirty });
  },

  setName(_name) {
    // Title is computed in Rust from the current file path; nothing to do here.
  },

  newFile() {
    if (invoke) invoke('reset_state');
  },

  onLoad(cb) {
    loadCb = cb;
    while (pendingLoads.length) cb(pendingLoads.shift());
  },
  onMenuNew(cb) { newCb = cb; },
  onMenuSave(cb) { saveCb = cb; },
  onSaveAndClose(cb) { saveAndCloseCb = cb; },
  confirmClose() { if (invoke) invoke('confirm_close'); },

  // Tauri uses native OS save dialogs — no in-app filename prompt needed.
  setNameAsker(_fn) {}
};

// Once the DOM is up, pull any paths Rust buffered before the frontend
// existed (CLI argv at launch, macOS open-file fired pre-window).
if (invoke) {
  const drain = async () => {
    try {
      const paths = await invoke('drain_pending');
      if (Array.isArray(paths)) {
        for (const p of paths) await openByPath(p);
      }
    } catch (_e) { /* ignore */ }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', drain, { once: true });
  } else {
    drain();
  }
}

export default tauri;
