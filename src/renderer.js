import platform from './platform/index.js';
import { maybeShowWelcome, showWelcome } from './welcome.js';
import { initLineNumbers, refreshLineNumbers } from './line-numbers.js';

const THEME_KEY = 'dedtxt-theme';
const themeToggle = document.getElementById('theme-toggle');
const themeMeta = document.getElementById('theme-color-meta');

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  if (themeMeta) themeMeta.setAttribute('content', t === 'light' ? '#ffffff' : '#111111');
}

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
  });
}

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

function setDirty(next) {
  if (next === dirty) return;
  dirty = next;
  platform.setDirty(dirty);
}

function recomputeDirty() {
  setDirty(editor.value !== savedSnapshot);
}

async function doSave() {
  const result = await platform.saveFile(editor.value);
  if (result && result.ok) {
    savedSnapshot = editor.value;
    setDirty(false);
  }
  return result;
}

async function doSaveAs() {
  const result = await platform.saveFileAs(editor.value);
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
  editor.value = '';
  savedSnapshot = '';
  setDirty(false);
  if (typeof platform.newFile === 'function') platform.newFile();
  refreshLineNumbers();
  editor.focus();
}

function doQuit() {
  if (typeof platform.quit === 'function') platform.quit();
}

// Map welcome-dialog shortcut buttons to their handlers. Clicking a button
// briefly plays a flash animation on the row (so taps register visually,
// especially on touch), then closes the dialog and runs the action.
const SHORTCUT_ACTIONS = {
  // The row's job is just to surface the Escape-key binding. Closing the
  // dialog is the action, and the click handler below already does that
  // for every row — this entry just keeps `handler()` from throwing.
  'this-dialog': () => {},
  'new': doNew,
  'open': doOpen,
  'save': doSave,
  'save-as': doSaveAs,
  'quit': doQuit
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
    if (e.shiftKey) doSaveAs(); else doSave();
  } else if (e.key === 'o' || e.key === 'O') {
    e.preventDefault();
    doOpen();
  }
});

platform.onLoad(({ content }) => {
  editor.value = content ?? '';
  savedSnapshot = editor.value;
  setDirty(false);
  editor.focus();
  // Setting .value doesn't fire 'input' — nudge the gutter manually.
  refreshLineNumbers();
});

platform.onMenuNew?.(doNew);
platform.onMenuSave(doSave);
platform.onMenuSaveAs(doSaveAs);

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
