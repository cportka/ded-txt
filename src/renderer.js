import platform from './platform/index.js';
import { maybeShowWelcome, showWelcome, closeWelcome, setUpdateResult, setInstallAvailable, refreshHeadsUp, setHeadsUpHandlers, showUpdateProgress } from './welcome.js';
import { createInstallController } from './pwa-install.js';
import { initLineNumbers, refreshLineNumbers } from './line-numbers.js';
import { installFind } from './find.js';
import { initScrollArrows } from './scroll-arrows.js';
import { showNotice, formatResultError } from './notice.js';
import { createDraftStash, describeDraft } from './drafts.js';
import { shouldSurfaceWebUpdate, shouldRecheckUpdate, RECHECK_GAP_MS } from './sw-update.js';

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
// Last name the platform reported for this buffer (open / save result).
// Only used to label the crash-recovery draft — the platform owns the title.
let currentFileName = null;

// Crash / draft recovery: stash the dirty buffer to localStorage (debounced
// on input, flushed on page hide) so a crash or accidental close can offer a
// restore on the next boot. See drafts.js for the full clear/keep semantics.
const draftStash = createDraftStash({
  storage: (() => {
    try { return window.localStorage; } catch (_e) { /* private mode */ }
    // Inert stand-in so every stash call is a safe no-op.
    return { getItem() { return null; }, setItem() {}, removeItem() {} };
  })(),
  getSnapshot: () => ({
    content: editor.value,
    name: currentFileName,
    isBinary: binaryMode,
    dirty
  })
});
// True while the boot-time Restore/Discard offer is on screen. While set,
// nothing else may clear the stored draft — it belongs to the previous
// session and only the offer's own buttons decide its fate.
let restoreOfferPending = false;

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
    if (result.unconfirmed) {
      // Firefox/Safari download-fallback save: the download API can't
      // confirm the file actually landed, so the buffer stays dirty (and
      // the recovery draft stays stashed) until a verifiable save. The
      // returned name is only a suggestion the browser may not have used —
      // don't adopt it as the buffer's name either.
    } else {
      if (result.filePath) currentFileName = result.filePath;
      savedSnapshot = editor.value;
      setDirty(false);
      // While the boot restore offer is undecided, the stored draft belongs
      // to the PREVIOUS session — saving the current buffer must not delete
      // it out from under the pending Restore/Discard question.
      if (!restoreOfferPending) draftStash.clear();
    }
  } else {
    const msg = formatResultError(result, 'Save');
    if (msg) showNotice(msg, { kind: 'error' });
  }
  return result;
}

async function doOpen() {
  const result = await platform.openFile();
  // Success flows through the onLoad callback; cancels stay silent.
  const msg = formatResultError(result, 'Open');
  if (msg) showNotice(msg, { kind: 'error' });
  return result;
}

function doNew() {
  if (dirty) {
    const ok = window.confirm('Discard unsaved changes?');
    if (!ok) return;
  }
  binaryMode = false;
  currentFileName = null;
  editor.value = '';
  savedSnapshot = '';
  setDirty(false);
  // The user explicitly discarded the buffer — drop the recovery draft too,
  // unless the boot restore offer is still undecided (that draft is the
  // previous session's; only its own Restore/Discard buttons may settle it).
  if (!restoreOfferPending) draftStash.clear();
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
  if (welcomeIconBtn) welcomeIconBtn.setAttribute('aria-expanded', 'true');
  // Move focus to the popup's first link so keyboard users land inside it
  // (it sits at the end of the dialog's DOM — tabbing there from the icon
  // would otherwise mean walking every shortcut button first). Escape hands
  // focus back to the icon.
  const first = infoPopup.querySelector('a, button');
  if (first) first.focus();
}

function hideInfoPopup() {
  if (infoPopup) infoPopup.hidden = true;
  if (welcomeIconBtn) welcomeIconBtn.setAttribute('aria-expanded', 'false');
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

// PWA install: capture the browser's install prompt and surface a one-click
// "install" line in the welcome dialog's Heads-up box (see welcome.js). The
// beforeinstallprompt event can fire after the dialog has already opened, so
// push availability into the welcome state and refresh the box in place —
// exactly the pattern the update notice uses.
const installController = createInstallController();
setInstallAvailable(installController.canInstall());
installController.onChange(() => {
  setInstallAvailable(installController.canInstall());
  refreshHeadsUp();
});

// Any click anywhere closes the popup (including clicks on the link, which
// still navigate first thanks to target="_blank"). The icon's own click
// handler above stops propagation, so the click that opens the popup
// doesn't immediately close it.
document.addEventListener('click', () => {
  if (infoPopup && !infoPopup.hidden) hideInfoPopup();
});

// Keyboard handling while the popup is open. Capture phase so we run before
// the dialog's auto-dismiss handler; stopImmediatePropagation prevents that
// handler from also firing and triggering a dialog dismiss + insert.
// Tab/Shift+Tab pass through so keyboard users can actually reach the
// popup's links and copy buttons (it used to close on ANY keydown, trapping
// them out); Enter/Space activate a focused control inside it; Escape (or
// any other typing) closes it, returning focus to the icon on Escape.
document.addEventListener('keydown', (e) => {
  if (!infoPopup || infoPopup.hidden) return;
  // Tab (incl. Shift+Tab) and bare modifier presses must not close the
  // popup, or Shift+Tab-ing through its links would be impossible.
  if (e.key === 'Tab' || e.key === 'Shift' || e.key === 'Control'
    || e.key === 'Alt' || e.key === 'Meta') return;
  if (infoPopup.contains(document.activeElement)
    && (e.key === 'Enter' || e.key === ' ')) return;
  hideInfoPopup();
  e.stopImmediatePropagation();
  e.preventDefault();
  if (e.key === 'Escape' && welcomeIconBtn) welcomeIconBtn.focus();
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
    // setRangeText fires no 'input' event — stash the draft explicitly.
    draftStash.schedule();
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

editor.addEventListener('input', () => {
  recomputeDirty();
  // Debounced crash-recovery stash — only writes while dirty (drafts.js).
  draftStash.schedule();
});

// The tab can vanish before a pending debounce fires — flush the stash the
// moment the page hides. pagehide covers bfcache navigations and closes;
// visibilitychange covers tab switches and mobile app backgrounding.
window.addEventListener('pagehide', () => draftStash.flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') draftStash.flush();
});

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText('\t', start, end, 'end');
    recomputeDirty();
    // setRangeText fires no 'input' event — stash the draft explicitly.
    draftStash.schedule();
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

platform.onLoad(({ filePath, content, isBinary }) => {
  binaryMode = !!isBinary;
  currentFileName = filePath || null;
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
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  const result = await platform.openDroppedFile(file);
  const msg = formatResultError(result, 'Open');
  if (msg) showNotice(msg, { kind: 'error' });
});

editor.focus();
initLineNumbers();
maybeShowWelcome();

// Boot-time draft recovery: if a dirty buffer was stashed before a crash /
// close, offer to restore it. The offer is sticky (waits for a decision) and
// stashing is suspended while it's up, so fresh typing can't overwrite the
// recoverable draft before the user chooses.
{
  const draft = draftStash.peek();
  if (draft) {
    draftStash.suspend();
    restoreOfferPending = true;
    showNotice(describeDraft(draft, Date.now()), {
      sticky: true,
      // Fires on EVERY way the offer leaves (Restore, Discard, the ✕
      // button). Without this, closing the offer via ✕ would leave the
      // stash suspended for the whole session — crash recovery silently
      // dead. ✕ means "not now": stashing resumes protecting the CURRENT
      // buffer; the old draft survives until new edits overwrite it.
      onDismiss: () => {
        restoreOfferPending = false;
        draftStash.resume();
      },
      actions: [
        {
          label: 'Restore',
          onClick: () => {
            // Don't clobber text the user typed while the offer sat open.
            // Returning false keeps the offer (and the suspended stash) up,
            // so declining costs nothing — the draft stays recoverable.
            if (editor.value !== '' && editor.value !== draft.content
              && !window.confirm('Replace the current text with the recovered draft?')) {
              return false;
            }
            // Drop any file association picked up while the offer was
            // pending (Ctrl+O / OS file-handler launch): the restored
            // draft is NOT that file's content, and a silent FSA re-save
            // would overwrite the wrong file. newFile() resets the
            // platform's handle + name, so the next save prompts.
            if (typeof platform.newFile === 'function') platform.newFile();
            binaryMode = draft.isBinary;
            currentFileName = draft.name;
            editor.value = draft.content;
            // A restored draft is by definition unsaved — snapshot stays
            // empty so the dirty marker comes on (and stashing resumes).
            savedSnapshot = '';
            recomputeDirty();
            if (draft.name && typeof platform.setName === 'function') platform.setName(draft.name);
            find.reset();
            refreshLineNumbers();
            arrows.update();
            editor.focus();
            // No re-stash here: the stored draft already holds this content,
            // and the stash resumes via onDismiss right after this returns.
          }
        },
        {
          label: 'Discard',
          onClick: () => {
            draftStash.clear();
          }
        }
      ]
    });
  }
}

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
  },
  // One-click install from the Heads-up "install" line. Replays the browser's
  // captured native prompt; onChange (above) re-renders the box so the line
  // clears itself once the prompt is consumed or the app is installed.
  installApp: () => { installController.prompt(); }
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
// so surface the "click to reload" notice (decision in sw-update.js).
if (platform.name === 'web' && 'serviceWorker' in navigator) {
  const notify = () => {
    setUpdateResult({ kind: 'web' });
    refreshHeadsUp({ kind: 'web' });
  };
  let registration = null;
  let lastUpdateCheck = 0;
  // Re-check for a new deploy when the tab regains focus (throttled). This is
  // what makes an update surface on its own for an always-open installed PWA —
  // the "click to update" notice appears without the user manually reloading.
  // The browser's built-in ~24h SW check is far too slow for a continuously-
  // deployed app; a fresh sw.js on the server triggers updatefound → the notify
  // wiring below, exactly as a page load would.
  const maybeRecheck = () => {
    if (!registration) return;
    const now = Date.now();
    if (!shouldRecheckUpdate(lastUpdateCheck, now, RECHECK_GAP_MS)) return;
    lastUpdateCheck = now;
    registration.update().catch(() => { /* offline — retry on next refocus */ });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') maybeRecheck();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      registration = reg;
      lastUpdateCheck = Date.now();
      // An update that installed while the app was closed is already waiting.
      if (reg.waiting && navigator.serviceWorker.controller) notify();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (shouldSurfaceWebUpdate(nw.state, navigator.serviceWorker.controller)) notify();
        });
      });
    } catch (_e) { /* offline / unsupported — ignore */ }
  });
}
