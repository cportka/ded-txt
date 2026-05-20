// First-visit / on-demand welcome dialog.
//
// Auto-shows exactly once per browser / install: if the user has ever
// dismissed the dialog before, it never auto-opens again (not even after a
// version bump). Manual opens via the hamburger icon or the Escape key
// always work; they just don't trigger the persistence guard differently.
//
// isMac / shortcutMap are exported for unit testing (test/).

import { VERSION } from './version.js';

const WELCOMED_KEY = 'dedtxt-welcomed';

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
    'this-dialog': 'ESC',
    'new':         `${mod}${plus}N`,
    'open':        `${mod}${plus}O`,
    'save':        `${mod}${plus}S`,
    'save-as':     `${mod}${plus}${shift}${plus}S`,
    'quit':        mac ? `${mod} Q` : 'Alt + F4'
  };
}

function openDialog() {
  const dialog = document.getElementById('welcome-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;

  // Fill in shortcut keys for this platform.
  const keys = shortcutMap();
  dialog.querySelectorAll('[data-key]').forEach((el) => {
    const k = el.getAttribute('data-key');
    if (keys[k]) el.textContent = keys[k];
  });

  // Stamp the version. No highlight state any more — show-once means we
  // never re-trigger the dialog to draw attention to an upgrade.
  const versionEl = document.getElementById('welcome-version');
  if (versionEl) versionEl.textContent = `v${VERSION}`;

  // Wire up dismiss + close + backdrop-click listeners once; subsequent
  // opens reuse them.
  if (!listenersAttached) {
    const dismiss = document.getElementById('welcome-dismiss');
    if (dismiss) dismiss.addEventListener('click', () => dialog.close());

    // Click outside the card (i.e. on the backdrop, which is the dialog
    // element itself with showModal()) dismisses the dialog. Clicks inside
    // the card bubble up with event.target as the inner element, so we
    // only act when the click target is the dialog itself.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });

    // Any close — auto, manual, Escape, backdrop, button — marks the user
    // as having been welcomed. Future visits skip the auto-open.
    dialog.addEventListener('close', () => {
      try { localStorage.setItem(WELCOMED_KEY, 'true'); } catch (e) { /* ignore */ }
    });
    listenersAttached = true;
  }

  // Avoid auto-focusing the first shortcut button (which iOS Safari paints
  // with the same border as :hover, making the first row look pre-selected).
  // Move focus to the dialog itself; Tab from here still lands on the first
  // shortcut for keyboard users.
  dialog.setAttribute('tabindex', '-1');
  dialog.showModal();
  try { dialog.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
}

// Auto-open exactly once. After the first dismissal, this is a no-op
// forever (unless the user clears their localStorage).
export function maybeShowWelcome() {
  let welcomed = false;
  try { welcomed = localStorage.getItem(WELCOMED_KEY) === 'true'; } catch (e) { /* private mode */ }
  if (welcomed) return;
  openDialog();
}

// Force-open from the hamburger menu or the Escape key.
export function showWelcome() {
  openDialog();
}
