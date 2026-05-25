import platform from './platform/index.js';
import { maybeShowWelcome, showWelcome } from './welcome.js';
import { initLineNumbers, refreshLineNumbers } from './line-numbers.js';
import { installFind } from './find.js';

const menuToggle = document.getElementById('menu-toggle');
if (menuToggle) {
  menuToggle.addEventListener('click', () => {
    // Restart the spin animation cleanly on every click. Remove the class,
    // force a reflow so the browser doesn't optimize the no-op toggle away,
    // then re-add the class.
    menuToggle.classList.remove('spinning');
    void menuToggle.offsetWidth;
    menuToggle.classList.add('spinning');
    showWelcome();
  });
  // Drop the class once the spin finishes so the next click can re-add it.
  // animationend bubbles up from the inner <img>.
  menuToggle.addEventListener('animationend', (e) => {
    if (e.animationName === 'menu-spin') {
      menuToggle.classList.remove('spinning');
    }
  });
}

const editor = document.getElementById('text-editor');
let savedSnapshot = '';
let dirty = false;
// True when the loaded file's bytes weren't valid UTF-8, so the textarea
// holds Latin-1 (one char per source byte). Save must re-encode each
// char's low byte back to raw bytes instead of writing as UTF-8.
let binaryMode = false;

function setDirty(next) {
  if (next === dirty) return;
  dirty = next;
  platform.setDirty(dirty);
}

function recomputeDirty() {
  setDirty(editor.value !== savedSnapshot);
}

async function doSave() {
  // First save on an unnamed buffer prompts for a filename inside the
  // platform; every save after that writes silently to the same file.
  // binaryMode tells the platform to Latin-1-encode each char back to a
  // byte (preserving the source file's raw bytes round-trip).
  const result = await platform.saveFile(editor.value, binaryMode);
  if (result && result.ok) {
    savedSnapshot = editor.value;
    setDirty(false);
  }
  return result;
}

async function doOpen() {
  const result = await platform.openFile();
  if (result && result.ok) {
    // onLoad callback updates the editor.
  }
  return result;
}

function doNew() {
  if (dirty) {
    const ok = window.confirm('Discard unsaved changes?');
    if (!ok) return;
  }
  binaryMode = false;
  editor.value = '';
  savedSnapshot = '';
  setDirty(false);
  if (typeof platform.newFile === 'function') platform.newFile();
  refreshLineNumbers();
  editor.focus();
}

// Map welcome-dialog shortcut buttons to their handlers. Clicking a button
// briefly plays a flash animation on the row (so taps register visually,
// especially on touch), then closes the dialog and runs the action.
// installFind wires its own Cmd/Ctrl+F handler; we keep a reference so the
// welcome-dialog Find row can open the bar without going through keydown.
const find = installFind({ editor });
function doFind() { find.open(); }

const SHORTCUT_ACTIONS = {
  // The row's job is just to surface the Escape-key binding. Closing the
  // dialog is the action, and the click handler below already does that
  // for every row — this entry just keeps `handler()` from throwing.
  'this-dialog': () => {},
  'new': doNew,
  'open': doOpen,
  'save': doSave,
  'find': doFind
};
const ACTIVATE_DURATION_MS = 180;

document.querySelectorAll('.welcome-shortcut').forEach((btn) => {
  const action = btn.getAttribute('data-action');
  const handler = SHORTCUT_ACTIONS[action];
  if (!handler) return;
  btn.addEventListener('click', () => {
    btn.classList.add('activating');
    setTimeout(() => {
      btn.classList.remove('activating');
      const dialog = document.getElementById('welcome-dialog');
      if (dialog && dialog.open) dialog.close();
      handler();
    }, ACTIVATE_DURATION_MS);
  });
});

// Welcome icon click — spin once + toggle the info popup. The popup is a
// fixed-position bubble anchored to the right of the icon (positioned via
// JS so it survives the dialog's internal overflow on small screens).
const welcomeIconBtn = document.getElementById('welcome-icon-btn');
const infoPopup = document.getElementById('info-popup');

function positionInfoPopup() {
  if (!welcomeIconBtn || !infoPopup) return;
  const rect = welcomeIconBtn.getBoundingClientRect();
  infoPopup.style.top = (rect.top + rect.height / 2) + 'px';
  infoPopup.style.left = (rect.right + 14) + 'px';
}

function showInfoPopup() {
  if (!infoPopup) return;
  positionInfoPopup();
  infoPopup.hidden = false;
}

function hideInfoPopup() {
  if (infoPopup) infoPopup.hidden = true;
}

if (welcomeIconBtn) {
  welcomeIconBtn.addEventListener('click', (e) => {
    welcomeIconBtn.classList.remove('spinning');
    void welcomeIconBtn.offsetWidth;
    welcomeIconBtn.classList.add('spinning');
    if (infoPopup && infoPopup.hidden) showInfoPopup();
    else hideInfoPopup();
    // Don't let the document-level "click anywhere dismisses popup" handler
    // immediately close what this click just opened.
    e.stopPropagation();
  });
  welcomeIconBtn.addEventListener('animationend', (e) => {
    if (e.animationName === 'menu-spin') {
      welcomeIconBtn.classList.remove('spinning');
    }
  });
}

// Any click anywhere closes the popup (including clicks on the link, which
// still navigate first thanks to target="_blank"). The icon's own click
// handler above stops propagation, so the click that opens the popup
// doesn't immediately close it.
document.addEventListener('click', () => {
  if (infoPopup && !infoPopup.hidden) hideInfoPopup();
});

// Any keypress closes the popup. Capture phase so we run before the
// dialog's auto-dismiss handler; stopImmediatePropagation prevents that
// handler from also firing and triggering a dialog dismiss + insert.
document.addEventListener('keydown', (e) => {
  if (infoPopup && !infoPopup.hidden) {
    hideInfoPopup();
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}, true);

// When the welcome dialog is open and the user starts typing, dismiss the
// dialog and forward the first character into the textarea so nothing is
// lost. Skip Enter/Space when an interactive child has focus so buttons
// and the checkbox still activate normally.
const welcomeDialog = document.getElementById('welcome-dialog');
if (welcomeDialog) {
  welcomeDialog.addEventListener('keydown', (e) => {
    if (!welcomeDialog.open) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const tag = e.target && e.target.tagName;
    const isInteractive = tag === 'BUTTON' || tag === 'INPUT' || tag === 'A' || tag === 'TEXTAREA' || tag === 'SELECT';
    const isActivation = e.key === 'Enter' || e.key === ' ';
    if (isInteractive && isActivation) return;

    let ch = null;
    if (e.key.length === 1) ch = e.key;
    else if (e.key === 'Enter') ch = '\n';
    if (ch === null) return;

    e.preventDefault();
    welcomeDialog.close();

    editor.focus();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText(ch, start, end, 'end');
    recomputeDirty();
    refreshLineNumbers();
  });
}

// Escape toggles the welcome dialog. When the dialog is open the browser
// already closes it on Escape (native <dialog> behavior). When it's closed,
// pressing Escape opens it again.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (welcomeDialog && !welcomeDialog.open) {
    e.preventDefault();
    showWelcome();
  }
});

editor.addEventListener('input', recomputeDirty);

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText('\t', start, end, 'end');
    recomputeDirty();
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    doSave();
  } else if (e.key === 'o' || e.key === 'O') {
    e.preventDefault();
    doOpen();
  }
});

platform.onLoad(({ content, isBinary }) => {
  binaryMode = !!isBinary;
  editor.value = content ?? '';
  savedSnapshot = editor.value;
  setDirty(false);
  editor.focus();
  // Setting .value doesn't fire 'input' — nudge the gutter manually.
  refreshLineNumbers();
});

platform.onMenuNew?.(doNew);
platform.onMenuSave(doSave);

// In-app "Save as" prompt used by the web shim on non-FSA browsers
// (Firefox / Safari / iOS). Returns the picked name, or null if cancelled.
// Wires up backdrop-click + Escape + close events so all the natural ways
// to dismiss a <dialog> resolve to null exactly once.
function promptForFilename(suggested) {
  const dialog = document.getElementById('save-as-dialog');
  const input = document.getElementById('save-as-name');
  const okBtn = document.getElementById('save-as-ok');
  const cancelBtn = document.getElementById('save-as-cancel');
  if (!dialog || !input || !okBtn || !cancelBtn) {
    // Should not happen, but degrade gracefully if the markup is missing.
    return Promise.resolve(suggested || 'Untitled.txt');
  }
  return new Promise((resolve) => {
    input.value = suggested || 'Untitled.txt';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      dialog.removeEventListener('close', onClose);
      dialog.removeEventListener('click', onBackdrop);
      input.removeEventListener('keydown', onKey);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onOk = () => {
      const trimmed = (input.value || '').trim();
      finish(trimmed || 'Untitled.txt');
    };
    const onCancel = () => finish(null);
    const onClose = () => finish(null);
    const onBackdrop = (e) => { if (e.target === dialog) finish(null); };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.addEventListener('click', onBackdrop);
    input.addEventListener('keydown', onKey);

    dialog.showModal();
    // Focus + select-all so Enter-to-confirm or just-typing is one keystroke.
    try { input.focus(); input.select(); } catch (e) { /* ignore */ }
  });
}
platform.setNameAsker?.(promptForFilename);

platform.onSaveAndClose(async () => {
  const result = await doSave();
  if (result && result.ok) platform.confirmClose();
});

window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  platform.openDroppedFile(file);
});

editor.focus();
initLineNumbers();
maybeShowWelcome();

// Service worker for offline use; only meaningful in the web build (Tauri
// serves over its own protocol where SW is unavailable / unnecessary).
if (platform.name === 'web' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
