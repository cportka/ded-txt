import platform from './platform/index.js';
import { maybeShowWelcome, showWelcome, closeWelcome, setUpdateResult, refreshHeadsUp, setHeadsUpHandlers, showUpdateProgress } from './welcome.js';
import { initInstallPrompt } from './pwa-install.js';
import { initLineNumbers, refreshLineNumbers } from './line-numbers.js';
import { installFind } from './find.js';
import { initScrollArrows } from './scroll-arrows.js';

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
  // Clear find state from the previous document so stale match highlights and
  // the find bar don't linger on the now-empty editor.
  find.reset();
  if (typeof platform.newFile === 'function') platform.newFile();
  refreshLineNumbers();
  arrows.update();
  editor.focus();
}

// Map welcome-dialog shortcut buttons to their handlers. Clicking a button
// briefly plays a flash animation on the row (so taps register visually,
// especially on touch), then closes the dialog and runs the action.
// installFind wires its own Cmd/Ctrl+F handler; we keep a reference so the
// welcome-dialog Find row can open the bar without going through keydown.
// closeWelcome is injected so Cmd/Ctrl+F dismisses the (modal, focus-
// trapping) welcome dialog before opening the bar.
const find = installFind({ editor, closeWelcome });
function doFind() { find.open(); }

// Floating scroll-to-start / scroll-to-end arrows. update() is called after
// programmatic content swaps (New / Open) since those fire no input/scroll.
const arrows = initScrollArrows({ editor });

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

// Copy text to the clipboard, preferring the async Clipboard API and falling
// back to a hidden-textarea execCommand for non-secure contexts (e.g. a
// file:// desktop shell) where navigator.clipboard is unavailable.
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (_e) { /* clipboard unavailable — nothing else to do */ }
}

// Crypto donations (ETH + BTC): click the abbreviated address to copy the full
// one and flash a check mark. data-address is the single source of truth; the
// visible text is an abbreviation recomputed here so it can never drift from
// the address actually copied. stopPropagation keeps the document-level "click
// anywhere closes the popup" handler (below) from hiding the popup before the
// confirmation is seen.
function wireCopyAddress(btnId, addrId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const fullAddress = btn.dataset.address || '';
  const addrEl = document.getElementById(addrId);
  if (addrEl && fullAddress.length > 12) {
    // 0x-prefixed (ETH) keeps the 0x + first 4; everything else (BTC) shows
    // the first 4 — both with the last 4.
    const head = fullAddress.startsWith('0x') ? 6 : 4;
    addrEl.textContent = `${fullAddress.slice(0, head)}…${fullAddress.slice(-4)}`;
  }
  let copiedTimer = 0;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyToClipboard(fullAddress);
    // Restart the one-shot glitch cleanly so rapid re-clicks re-animate
    // (same remove → reflow → re-add trick as the welcome icon boot).
    btn.classList.remove('copied');
    void btn.offsetWidth;
    btn.classList.add('copied');
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => btn.classList.remove('copied'), 1500);
  });
}
wireCopyAddress('donate-eth', 'donate-eth-addr');
wireCopyAddress('donate-btc', 'donate-btc-addr');

// "Install as web app" button in the welcome dialog (hidden unless the PWA is
// actually installable).
initInstallPrompt();

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
  // Fresh document: clear any leftover find state from the previous file.
  find.reset();
  // Setting .value doesn't fire 'input' — nudge the gutter + arrows manually.
  refreshLineNumbers();
  // Start at the top of the freshly-opened file. focus() first so its
  // caret-scroll doesn't fight us, then pin the caret + scroll to the start.
  editor.focus();
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  arrows.update();
});

platform.onMenuNew?.(doNew);
platform.onMenuOpen?.(doOpen);
platform.onMenuSave(doSave);

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

// "Update available" notice. The actionable heads-up entry (welcome.js) calls
// back here to apply it; guard unsaved work first since applying reloads.
setHeadsUpHandlers({
  applyUpdate: () => {
    if (dirty && !window.confirm('Discard unsaved changes to update?')) return;
    if (typeof platform.applyUpdate === 'function') {
      showUpdateProgress(0, 0);
      platform.applyUpdate(showUpdateProgress).then((ok) => {
        // Success ends in a reload; only a failure returns here — restore the
        // notice so the user can retry.
        if (ok === false) refreshHeadsUp();
      });
    } else if (typeof location !== 'undefined') {
      location.reload();
    }
  }
});

// Desktop: ask the native side whether a newer web layer is available (the
// webview CSP blocks the cross-origin fetch, so Rust does it). Fire-and-forget
// — offline / server-down just leaves the current assets in place. Web skips
// this and uses the service-worker lifecycle below instead.
if (platform.name !== 'web' && typeof platform.checkUpdate === 'function') {
  platform.checkUpdate().then((r) => {
    if (!r || !r.updateKind || r.updateKind === 'none') return;
    const update = { kind: r.updateKind, url: r.releasesUrl || null };
    setUpdateResult(update);
    refreshHeadsUp(update);
  }).catch(() => { /* offline / unreachable — keep current */ });
}

// Service worker for offline use; only meaningful in the web build (Tauri
// serves over its own protocol where SW is unavailable / unnecessary). The SW
// is cache-first, so a stale version.js makes version polling useless — detect
// updates via the SW lifecycle instead: when a new worker reaches 'installed'
// while an old one still controls the page, fresh assets are cached and ready,
// so surface the "click to reload" notice.
if (platform.name === 'web' && 'serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const notify = () => {
      setUpdateResult({ kind: 'web' });
      refreshHeadsUp({ kind: 'web' });
    };
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      if (reg.waiting && navigator.serviceWorker.controller) notify();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) notify();
        });
      });
    } catch (_e) { /* offline / unsupported — ignore */ }
  });
}
