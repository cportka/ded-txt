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
  menuToggle.addEventListener('click', () => showWelcome());
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
