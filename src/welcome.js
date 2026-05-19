// First-visit / new-version / on-demand welcome dialog. Shown:
//   * automatically on first visit and after any version bump,
//   * automatically on every start if the user opted in via "Show on start",
//   * manually any time the user clicks the hamburger menu (via showWelcome()).
//
// The "Show on start" checkbox is unchecked by default. If checked, the
// dialog reappears on every page load. If unchecked, it stays out of the
// way until the next version bump (which always shows once, to surface
// what changed).
//
// isMac / shortcutMap are exported for unit testing (test/).

import { VERSION } from './version.js';

const VERSION_KEY = 'dedtxt-last-version';
const SHOW_ON_START_KEY = 'dedtxt-show-on-start';

let listenersAttached = false;

export function isMac() {
  const plat = (navigator.platform || '').toLowerCase();
  if (plat.includes('mac') || plat.includes('iphone') || plat.includes('ipad') || plat.includes('ipod')) return true;
  return /Mac/i.test(navigator.userAgent || '');
}

export function shortcutMap() {
  const mac = isMac();
  const mod = mac ? '⌘' : 'Ctrl';
  const shift = mac ? '⇧' : 'Shift';
  const plus = mac ? ' ' : ' + ';
  return {
    'new':     `${mod}${plus}N`,
    'open':    `${mod}${plus}O`,
    'save':    `${mod}${plus}S`,
    'save-as': `${mod}${plus}${shift}${plus}S`,
    'quit':    mac ? `${mod} Q` : 'Alt + F4'
  };
}

function openDialog(highlightAsNew) {
  const dialog = document.getElementById('welcome-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;

  // Fill in shortcut keys for this platform.
  const keys = shortcutMap();
  dialog.querySelectorAll('[data-key]').forEach((el) => {
    const k = el.getAttribute('data-key');
    if (keys[k]) el.textContent = keys[k];
  });

  // Stamp the version. Highlight only when this is a new-version-vs-last-seen
  // auto-open — manual hamburger opens never highlight.
  const versionEl = document.getElementById('welcome-version');
  if (versionEl) {
    versionEl.textContent = `v${VERSION}`;
    versionEl.classList.toggle('new', !!highlightAsNew);
  }

  // Restore the user's saved "show on start" preference so the next dismiss
  // can persist their (possibly unchanged) choice.
  const showOnStart = document.getElementById('welcome-show-on-start');
  if (showOnStart) {
    let saved = null;
    try { saved = localStorage.getItem(SHOW_ON_START_KEY); } catch (e) { /* ignore */ }
    showOnStart.checked = saved === 'true';
  }

  // Wire up dismiss + close listeners once; subsequent opens reuse them.
  if (!listenersAttached) {
    const dismiss = document.getElementById('welcome-dismiss');
    if (dismiss) dismiss.addEventListener('click', () => dialog.close());

    dialog.addEventListener('close', () => {
      const sos = document.getElementById('welcome-show-on-start');
      const checked = !!(sos && sos.checked);
      try {
        localStorage.setItem(VERSION_KEY, VERSION);
        localStorage.setItem(SHOW_ON_START_KEY, checked ? 'true' : 'false');
      } catch (e) { /* ignore */ }
    });
    listenersAttached = true;
  }

  // Avoid auto-focusing the first shortcut button (which iOS Safari paints
  // with the same border as :hover, making "New" look pre-selected). Move
  // focus to the dialog itself; Tab from here still lands on the first
  // shortcut for keyboard users.
  dialog.setAttribute('tabindex', '-1');
  dialog.showModal();
  try { dialog.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
}

// Auto-open on first visit, after any version bump, or if the user opted
// in to "Show on start".
export function maybeShowWelcome() {
  let lastSeen = null;
  let showOnStart = false;
  try {
    lastSeen = localStorage.getItem(VERSION_KEY);
    showOnStart = localStorage.getItem(SHOW_ON_START_KEY) === 'true';
  } catch (e) { /* private mode */ }

  // Skip only if the user has seen THIS exact version AND hasn't opted in.
  if (lastSeen === VERSION && !showOnStart) return;

  openDialog(!!(lastSeen && lastSeen !== VERSION));
}

// Force-open from the hamburger menu — ignores version state.
export function showWelcome() {
  openDialog(false);
}
