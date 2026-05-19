// First-visit / new-version welcome dialog. Shown once per version on
// desktop only — mobile users don't have keyboard shortcuts and get
// straight to the editor. The "Don't show this again" checkbox is
// pre-checked, so dismissing without touching it (the expected path)
// records this version as seen.
//
// Re-shown automatically when VERSION changes. When the user has seen a
// previous version, the new version number is visually highlighted.
//
// isMobile / isMac / shortcutMap are exported for unit testing (test/).

import { VERSION } from './version.js';

const VERSION_KEY = 'dedtxt-last-version';

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

export function maybeShowWelcome() {
  if (isMobile()) return;

  let lastSeen = null;
  try { lastSeen = localStorage.getItem(VERSION_KEY); } catch (e) { /* private mode */ }

  // Already dismissed this exact version — stay out of the way.
  if (lastSeen === VERSION) return;

  const dialog = document.getElementById('welcome-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;

  // Fill in shortcut keys for this platform.
  const keys = shortcutMap();
  dialog.querySelectorAll('[data-key]').forEach((el) => {
    const k = el.getAttribute('data-key');
    if (keys[k]) el.textContent = keys[k];
  });

  // Stamp the version. Highlight as "new" only if the user has previously
  // seen a DIFFERENT version — first-time visitors don't get the badge.
  const versionEl = document.getElementById('welcome-version');
  if (versionEl) {
    versionEl.textContent = `v${VERSION}`;
    if (lastSeen && lastSeen !== VERSION) {
      versionEl.classList.add('new');
    }
  }

  const dontShow = document.getElementById('welcome-dont-show');
  const dismiss = document.getElementById('welcome-dismiss');

  dismiss.addEventListener('click', () => dialog.close());

  dialog.addEventListener('close', () => {
    if (dontShow && dontShow.checked) {
      try { localStorage.setItem(VERSION_KEY, VERSION); } catch (e) { /* ignore */ }
    }
  }, { once: true });

  dialog.showModal();
}
