import platform from './platform/index.js';
import { maybeShowWelcome, showWelcome, closeWelcome, prefersReducedMotion } from './welcome.js';
import { initLineNumbers, refreshLineNumbers } from './line-numbers.js';
import { installFind } from './find.js';

// Restart the one-shot spin animation cleanly: drop the class, force a
// reflow so the browser doesn't coalesce the toggle into a no-op, then
// re-add it. Shared by the corner menu button and the welcome icon.
function restartSpin(el) {
  el.classList.remove('spinning');
  void el.offsetWidth;
  el.classList.add('spinning');
}

// Drop .spinning once the spin finishes so the next click can re-trigger
// it. animationend bubbles from the inner <img>; the name filter ignores
// the welcome icon's unrelated boot animation.
function clearSpinOnEnd(el) {
  el.addEventListener('animationend', (e) => {
    if (e.animationName === 'menu-spin') el.classList.remove('spinning');
  });
}

const menuToggle = document.getElementById('menu-toggle');
if (menuToggle) {
  menuToggle.addEventListener('click', () => {
    restartSpin(menuToggle);
    showWelcome();
  });
  clearSpinOnEnd(menuToggle);
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
  'new': doNew,
  'open': doOpen,
  'save': doSave,
  'find': doFind
};

document.querySelectorAll('.welcome-shortcut').forEach((btn) => {
  const action = btn.getAttribute('data-action');
  const handler = SHORTCUT_ACTIONS[action];
  if (!handler) return;
  btn.addEventListener('click', () => {
    if (action === 'open' || action === 'save') {
      // Open/Save raise a native file picker / download that iOS Safari only
      // permits from inside the originating tap. Close the menu synchronously
      // (no glitch-out gap) and run the action in the same gesture so user
      // activation isn't lost — deferring it behind the ~300ms glitch-out is
      // exactly what silently broke Open on mobile.
      closeWelcome(handler, { immediate: true });
      return;
    }
    // New/Find need no gesture, but do need the modal fully closed before they
    // grab focus (editor / find input), so keep the flash + glitch-out and run
    // the action once the card has truly closed.
    btn.classList.add('activating');
    closeWelcome(() => {
      btn.classList.remove('activating');
      handler();
    });
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
    restartSpin(welcomeIconBtn);
    if (infoPopup && infoPopup.hidden) showInfoPopup();
    else hideInfoPopup();
    // Don't let the document-level "click anywhere dismisses popup" handler
    // immediately close what this click just opened.
    e.stopPropagation();
  });
  clearSpinOnEnd(welcomeIconBtn);
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
    // Close immediately (no glitch-out): the character is inserted into the
    // editor synchronously just below, so we don't want a ~240ms modal
    // lingering over the text being edited.
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
  const card = dialog.querySelector('.welcome-card');
  return new Promise((resolve) => {
    input.value = suggested || 'Untitled.txt';
    let settled = false;

    const teardown = () => {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancelEvt);
      dialog.removeEventListener('close', onClose);
      dialog.removeEventListener('click', onBackdrop);
      input.removeEventListener('keydown', onKey);
    };

    // animate === true plays the card glitch-out before closing (dismissals).
    // For "Save" it MUST be false: the caller's download fires right after
    // this resolve, and on iOS Safari that only works inside the original tap
    // — a ~240ms glitch defer would drop the user-activation gesture (the same
    // failure that broke the welcome Open/Save shortcuts). Reduced motion and
    // a missing card also close instantly.
    const finish = (value, animate) => {
      if (settled) return;
      settled = true;
      teardown();
      if (!animate || !card || prefersReducedMotion()) {
        if (dialog.open) dialog.close();
        resolve(value);
        return;
      }
      let done = false;
      const closeNow = () => {
        if (done) return;
        done = true;
        card.removeEventListener('animationend', onGlitchEnd);
        card.classList.remove('glitching-out');
        if (dialog.open) dialog.close();
        resolve(value);
      };
      const onGlitchEnd = (e) => {
        if (e.animationName === 'welcome-card-glitch-out') closeNow();
      };
      // Drop the entrance class first — its rule sits later in the cascade and
      // would otherwise win the `animation` property over the glitch-out.
      card.classList.remove('save-glitch-in', 'glitching-out');
      void card.offsetWidth;
      card.classList.add('glitching-out');
      card.addEventListener('animationend', onGlitchEnd);
      // Safety net if animationend never lands (interrupted / unsupported).
      setTimeout(closeNow, 360);
    };

    // Save resolves in-tap (no glitch-out) so the download stays in-gesture.
    const onOk = () => {
      const trimmed = (input.value || '').trim();
      finish(trimmed || 'Untitled.txt', false);
    };
    // Dismissals have no downstream gesture, so they get the glitch-out.
    const onCancel = () => finish(null, true);
    const onBackdrop = (e) => { if (e.target === dialog) finish(null, true); };
    // Native ESC fires 'cancel' first; intercept it to play the glitch-out
    // (mirrors welcome.js). Under reduced motion, let the native close proceed.
    const onCancelEvt = (e) => {
      if (prefersReducedMotion()) return;
      e.preventDefault();
      finish(null, true);
    };
    // Catch-all: any other close (incl. reduced-motion ESC) resolves once.
    const onClose = () => finish(null, false);
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancelEvt);
    dialog.addEventListener('close', onClose);
    dialog.addEventListener('click', onBackdrop);
    input.addEventListener('keydown', onKey);

    dialog.showModal();
    // One-shot glitch-in (skipped under reduced motion). Reflow between remove
    // and add so a rapid re-open re-fires cleanly.
    if (card && !prefersReducedMotion()) {
      card.classList.remove('save-glitch-in');
      void card.offsetWidth;
      card.classList.add('save-glitch-in');
    }
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
