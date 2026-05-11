// Capacitor platform: uses @capacitor/filesystem (exposed at runtime by
// the native bridge as `window.Capacitor.Plugins.Filesystem`) for save/load
// to the app's Documents directory, and falls back to the browser file
// picker for opening arbitrary files (the Capacitor WebView surfaces the
// native iOS/Android document picker for <input type="file">).
//
// On iOS, Files app integration is wired via Info.plist UTI declarations
// (configured in the native project). On Android, ACTION_VIEW intents
// handle the same job (configured in AndroidManifest.xml).

import web from './web.js';

let currentName = null;
let dirty = false;
let loadCb = null;

function getFilesystem() {
  const fs = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
  if (!fs) throw new Error('Capacitor Filesystem plugin not available');
  return fs;
}

function updateTitle() {
  const base = currentName || 'Untitled';
  const dot = dirty ? ' •' : '';
  document.title = `${base}${dot} — DedTxt`;
}

const capacitor = {
  name: 'capacitor',

  async openFile() {
    return web.openFile();
  },

  async saveFile(content) {
    if (!currentName) return capacitor.saveFileAs(content);
    try {
      await getFilesystem().writeFile({
        path: currentName,
        directory: 'DOCUMENTS',
        encoding: 'utf8',
        data: content
      });
      return { ok: true, filePath: currentName };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  async saveFileAs(content) {
    const suggested = currentName || 'Untitled.txt';
    const name = (typeof window !== 'undefined' && window.prompt)
      ? window.prompt('Save as:', suggested)
      : suggested;
    if (!name) return { ok: false, canceled: true };
    try {
      await getFilesystem().writeFile({
        path: name,
        directory: 'DOCUMENTS',
        encoding: 'utf8',
        data: content
      });
      currentName = name;
      updateTitle();
      return { ok: true, filePath: name };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  async openDroppedFile(file) {
    return web.openDroppedFile(file);
  },

  setDirty(next) {
    dirty = !!next;
    updateTitle();
  },

  setName(name) {
    currentName = name || null;
    updateTitle();
  },

  onLoad(cb) {
    loadCb = cb;
    web.onLoad((payload) => {
      currentName = payload.filePath || null;
      updateTitle();
      if (loadCb) loadCb(payload);
    });
  },

  onMenuSave(_cb) { /* no system menus on mobile */ },
  onMenuSaveAs(_cb) { /* no system menus on mobile */ },
  onSaveAndClose(_cb) { /* OS handles app close */ },
  confirmClose() { /* OS handles app close */ }
};

export default capacitor;
