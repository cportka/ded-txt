// First-visit / new-version / on-demand welcome dialog. Shown:
//   * automatically on first visit and after any version bump (desktop only),
//   * manually any time the user clicks the hamburger menu (via showWelcome()).
//
// The "Don't show this again" checkbox is pre-checked, so dismissing without
// touching it (the expected path) records this version as seen and the
// dialog won't auto-fire again until the next version bump. Manual opens
// via the hamburger ignore both the mobile check and the version state.
//
// isMobile / isMac / shortcutMap are exported for unit testing (test/).

import { VERSION } from './version.js';

const VERSION_KEY = 'dedtxt-last-version';

let listenersAttached = false;

export function isMobile() {
  // No hover-capable pointer = touch-primary device.
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return !window.matchMedia('(any-hover: hover)').matches;
}

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

  // Wire up dismiss + close listeners once; subsequent opens reuse them.
  if (!listenersAttached) {
    const dismiss = document.getElementById('welcome-dismiss');
    if (dismiss) dismiss.addEventListener('click', () => dialog.close());

    dialog.addEventListener('close', () => {
      const dontShow = document.getElementById('welcome-dont-show');
      if (dontShow && dontShow.checked) {
        try { localStorage.setItem(VERSION_KEY, VERSION); } catch (e) { /* ignore */ }
      }
    });
    listenersAttached = true;
  }

  dialog.showModal();
}

// Auto-open on first visit or after a version bump (desktop only).
export function maybeShowWelcome() {
  if (isMobile()) return;

  let lastSeen = null;
  try { lastSeen = localStorage.getItem(VERSION_KEY); } catch (e) { /* private mode */ }

  if (lastSeen === VERSION) return;

  openDialog(!!(lastSeen && lastSeen !== VERSION));
}

// Force-open from the hamburger menu — ignores mobile check and version state.
export function showWelcome() {
  openDialog(false);
}
