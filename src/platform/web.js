// Web platform: uses the File System Access API where available, with
// a download/upload fallback for Safari & Firefox. The renderer treats
// this just like Electron's window.dt.

const TEXT_TYPES = {
  description: 'Text files',
  accept: {
    'text/plain': ['.txt', '.md', '.log', '.json', '.csv', '.ini', '.yml', '.yaml', '.xml']
  }
};

let currentHandle = null;
let currentName = null;
let dirty = false;

let loadCb = null;

function hasFsAccess() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

function updateTitle() {
  // No file open → bare "DedTxt". Only show a name (and dirty bullet) once
  // the user has actually opened or named a file.
  if (!currentName) {
    document.title = 'DedTxt';
    return;
  }
  const dot = dirty ? ' •' : '';
  document.title = `${currentName}${dot} — DedTxt`;
}

function fireLoad(name, content) {
  // Clear local dirty before firing the load callback so the title we paint
  // afterwards reflects the fresh file, not a leftover bullet from the
  // previously-loaded file.
  currentName = name;
  dirty = false;
  if (loadCb) loadCb({ filePath: name, content });
  updateTitle();
}

async function pickAndRead() {
  if (hasFsAccess()) {
    try {
      // mode: 'readwrite' grants write permission up front so a subsequent
      // Save can call createWritable() on this handle silently. Without it
      // Chrome treats the handle as read-only and re-prompts on first write.
      const [handle] = await window.showOpenFilePicker({ types: [TEXT_TYPES], multiple: false, mode: 'readwrite' });
      const file = await handle.getFile();
      const content = await file.text();
      currentHandle = handle;
      fireLoad(file.name, content);
      return { ok: true };
    } catch (err) {
      if (err && err.name === 'AbortError') return { ok: false, canceled: true };
      return { ok: false, error: err.message };
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.log,.json,.csv,.ini,.yml,.yaml,.xml,text/plain';
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const cleanup = () => { input.remove(); };
    input.onchange = async () => {
      const file = input.files && input.files[0];
      cleanup();
      if (!file) { settled = true; return resolve({ ok: false, canceled: true }); }
      try {
        const content = await file.text();
        currentHandle = null;
        fireLoad(file.name, content);
        settled = true;
        resolve({ ok: true });
      } catch (err) {
        settled = true;
        resolve({ ok: false, error: err.message });
      }
    };
    // No reliable cancel event in older browsers; resolve as canceled
    // if the picker closes without a selection (handled by oncancel where supported).
    input.oncancel = () => { if (!settled) { cleanup(); resolve({ ok: false, canceled: true }); } };
    input.click();
  });
}

async function writeHandle(handle, content) {
  // Chrome may downgrade an FSA permission after the tab has been idle.
  // Query first and re-request only if needed so the common (already-granted)
  // path stays prompt-free.
  if (typeof handle.queryPermission === 'function') {
    const state = await handle.queryPermission({ mode: 'readwrite' });
    if (state !== 'granted') {
      const req = await handle.requestPermission({ mode: 'readwrite' });
      if (req !== 'granted') throw new Error('Write permission denied');
    }
  }
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

function downloadFallback(content, suggestedName) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName || 'Untitled.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const web = {
  name: 'web',

  async openFile() { return pickAndRead(); },

  async saveFile(content) {
    // Re-save to the same file once we have a handle; otherwise prompt the
    // user for a path/name on the first save and remember it from then on.
    if (currentHandle) {
      try {
        await writeHandle(currentHandle, content);
        return { ok: true, filePath: currentHandle.name };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    if (hasFsAccess() && typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: currentName || 'Untitled.txt',
          types: [TEXT_TYPES]
        });
        await writeHandle(handle, content);
        currentHandle = handle;
        currentName = handle.name;
        // Clear dirty before painting so the first frame after the picker
        // closes shows "foo.txt — DedTxt" without a stale bullet.
        dirty = false;
        updateTitle();
        return { ok: true, filePath: handle.name };
      } catch (err) {
        if (err && err.name === 'AbortError') return { ok: false, canceled: true };
        return { ok: false, error: err.message };
      }
    }
    // Safari / Firefox fallback: trigger a one-shot download. Without an FS
    // handle there's nothing to re-save to, so this path repeats every save.
    const name = currentName || 'Untitled.txt';
    downloadFallback(content, name);
    currentName = name;
    updateTitle();
    return { ok: true, filePath: name };
  },

  async openDroppedFile(file) {
    try {
      const content = await file.text();
      currentHandle = null;
      fireLoad(file.name, content);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  setDirty(next) {
    dirty = !!next;
    updateTitle();
    window.onbeforeunload = dirty
      ? (e) => { e.preventDefault(); e.returnValue = ''; return ''; }
      : null;
  },

  setName(name) {
    currentName = name || null;
    updateTitle();
  },

  newFile() {
    // Drop the current file association so the next Save prompts for a path.
    currentHandle = null;
    currentName = null;
    dirty = false;
    updateTitle();
  },

  onLoad(cb) {
    loadCb = cb;
    // Surface the original name on the next setName/load so the title is correct.
  },

  onMenuNew(_cb) { /* no system menus on web */ },
  onMenuSave(_cb) { /* no system menus on web */ },

  onSaveAndClose(_cb) { /* not applicable in browser */ },
  confirmClose() { /* not applicable in browser */ }
};

export default web;
