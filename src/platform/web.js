// Web platform: uses the File System Access API where available, with
// a download/upload fallback for Safari & Firefox. The renderer treats
// this just like Electron's window.dt.

const MAX_BYTES = 25 * 1024 * 1024;

// Decode raw bytes into a textarea-friendly string.
//   - Valid UTF-8 with no NULL bytes  → text mode, decoded UTF-8.
//   - Anything else (invalid UTF-8, or text-shaped bytes containing NULL)
//     → binary mode, Latin-1 (byte 0xNN → codepoint U+00NN). Round-trips
//     exactly when re-encoded on save via charCodeAt & 0xFF.
function decode(bytes) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.includes('\0')) return { content: text, isBinary: false };
  } catch (_) { /* fall through to Latin-1 */ }
  // Latin-1: byte 0xNN → codepoint U+00NN. NB: `TextDecoder('latin1')` is
  // not what we want — WHATWG aliases that label to windows-1252, which
  // maps bytes 0x80-0x9F to non-Latin-1 codepoints (€, ‰, …) and breaks
  // the round-trip on save. Chunked `String.fromCharCode.apply` is the
  // round-trip-safe fast path: ~10x quicker than per-byte concatenation
  // on a 25 MB binary while still producing exactly U+0000..U+00FF.
  let s = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return { content: s, isBinary: true };
}

// Re-encode the textarea string to bytes for a binary save. Each char's
// low byte is the original file byte; chars > U+00FF (only possible if
// the user pasted multibyte text into a binary buffer) truncate to their
// low byte — documented behavior.
function encodeBinary(content) {
  const out = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) out[i] = content.charCodeAt(i) & 0xff;
  return out;
}

let currentHandle = null;
let currentName = null;
let dirty = false;

let loadCb = null;
// Renderer-supplied async prompter: askName(suggested) → Promise<string|null>.
// Only used in the non-FSA download-fallback path so Firefox/Safari users
// get a tab title + a consistent download name on first save.
let askName = null;

function hasFsAccess() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

function updateTitle() {
  // No file open → bare "DedTxt". Only show a name (and dirty bullets) once
  // the user has actually opened or named a file.
  if (!currentName) {
    document.title = 'DedTxt';
    return;
  }
  // Dirty marker flanks the filename on both sides so unsaved state is
  // visible at a glance regardless of how the OS truncates a long tab title.
  // Clean state stays bullet-free so the tab looks calm when nothing's pending.
  document.title = dirty
    ? `• ${currentName} • — DedTxt`
    : `${currentName} — DedTxt`;
}

function fireLoad(name, content, isBinary) {
  // Clear local dirty before firing so the title we paint afterwards
  // reflects the fresh file, not a leftover bullet from the previous one.
  currentName = name;
  dirty = false;
  if (loadCb) {
    const payload = { filePath: name, content };
    if (isBinary) payload.isBinary = true;
    loadCb(payload);
  }
  updateTitle();
}

async function readAndFire(file) {
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'File too large (25 MB max)' };
  }
  const buf = await file.arrayBuffer();
  const { content, isBinary } = decode(new Uint8Array(buf));
  fireLoad(file.name, content, isBinary);
  return { ok: true };
}

async function pickAndRead() {
  if (hasFsAccess()) {
    try {
      // mode: 'readwrite' grants write permission up front so a subsequent
      // Save can call createWritable() on this handle silently. Without it
      // Chrome treats the handle as read-only and re-prompts on first write.
      const [handle] = await window.showOpenFilePicker({ multiple: false, mode: 'readwrite' });
      const file = await handle.getFile();
      const res = await readAndFire(file);
      if (res.ok) currentHandle = handle;
      return res;
    } catch (err) {
      if (err && err.name === 'AbortError') return { ok: false, canceled: true };
      return { ok: false, error: err.message };
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // Visually hidden but RENDERED: iOS Safari won't open the picker for a
    // display:none file input. Off-screen + 1px + opacity 0 keeps it invisible
    // and non-interactive while staying "shown" enough for .click() to work.
    input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    document.body.appendChild(input);
    let settled = false;
    const cleanup = () => { input.remove(); };
    input.onchange = async () => {
      const file = input.files && input.files[0];
      cleanup();
      if (!file) { settled = true; return resolve({ ok: false, canceled: true }); }
      try {
        currentHandle = null;
        const res = await readAndFire(file);
        settled = true;
        resolve(res);
      } catch (err) {
        settled = true;
        resolve({ ok: false, error: err.message });
      }
    };
    // No reliable cancel event in older browsers; resolve as canceled
    // if the picker closes without a selection (handled by oncancel where supported).
    input.oncancel = () => { if (!settled) { cleanup(); resolve({ ok: false, canceled: true }); } };
    // Defer the click out of the current task. The welcome menu's Open button
    // closes the modal synchronously, then calls this in the same dispatch; on
    // iOS Safari a file picker opened synchronously mid-dispatch — while the
    // just-closed modal's inert subtree is still settling — is silently
    // dropped, so Open "does nothing". A 0ms timeout fires it from a clean task
    // after the dispatch and the close have committed, still well within the
    // transient-activation window (the earlier setTimeout-based open proved
    // activation survives the timer), so the native file sheet appears.
    setTimeout(() => input.click(), 0);
  });
}

async function writeHandle(handle, payload) {
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
  await writable.write(payload);
  await writable.close();
}

function downloadFallback(payload, suggestedName, mime) {
  // Blob accepts Uint8Array or string as a BlobPart, no branch needed.
  const blob = new Blob([payload], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Strip path separators and leading dots so a hostile or careless filename
  // can't write outside the user's intended save target. Browsers also
  // refuse path separators in `download` themselves, but being explicit
  // means we don't depend on that and confusion ("Save As" prefilling with
  // ../../foo.txt) doesn't reach the user.
  a.download = (suggestedName || 'Untitled.txt')
    .replace(/[/\\]/g, '_')
    .replace(/^\.+/, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const web = {
  name: 'web',

  async openFile() { return pickAndRead(); },

  async saveFile(content, isBinary) {
    const payload = isBinary ? encodeBinary(content) : content;
    const mime = isBinary ? 'application/octet-stream' : 'text/plain;charset=utf-8';
    // Re-save to the same file once we have a handle; otherwise prompt the
    // user for a path/name on the first save and remember it from then on.
    if (currentHandle) {
      try {
        await writeHandle(currentHandle, payload);
        return { ok: true, filePath: currentHandle.name };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    if (hasFsAccess() && typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: currentName || 'Untitled.txt',
        });
        await writeHandle(handle, payload);
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
    // If currentName is null AND the renderer registered a prompter, ask
    // once for a filename so the tab can show something meaningful and
    // future saves reuse the same suggested download name.
    if (!currentName && askName) {
      const picked = await askName('Untitled.txt');
      if (picked == null) return { ok: false, canceled: true };
      currentName = picked;
      updateTitle();
    }
    const suggestedName = currentName || 'Untitled.txt';
    downloadFallback(payload, suggestedName, mime);
    return { ok: true, filePath: suggestedName };
  },

  async openDroppedFile(file) {
    try {
      currentHandle = null;
      return await readAndFire(file);
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
    // Drop the current file association so the next Save prompts for a
    // path. Clear the onbeforeunload guard too — otherwise a fresh, clean
    // buffer still prompts "unsaved changes?" on tab close because the
    // guard was installed by the previous file's dirty state.
    currentHandle = null;
    currentName = null;
    dirty = false;
    updateTitle();
    window.onbeforeunload = null;
  },

  onLoad(cb) {
    loadCb = cb;
    // Surface the original name on the next setName/load so the title is correct.
  },

  onMenuNew(_cb) { /* no system menus on web */ },
  onMenuSave(_cb) { /* no system menus on web */ },

  onSaveAndClose(_cb) { /* not applicable in browser */ },
  confirmClose() { /* not applicable in browser */ },

  setNameAsker(fn) { askName = fn; }
};

export default web;
