// First-visit / on-demand welcome dialog.
//
// Auto-shows exactly once per browser / install: if the user has ever
// dismissed the dialog before, it never auto-opens again (not even after a
// version bump). Manual opens via the hamburger icon or the Escape key
// always work; they just don't trigger the persistence guard differently.
//
// isMac / shortcutMap / headsUpNotices are exported for unit testing (test/).

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
  const plus = mac ? ' ' : ' + ';
  return {
    'this-dialog': 'ESC',
    'new':         `${mod}${plus}N`,
    'open':        `${mod}${plus}O`,
    'save':        `${mod}${plus}S`,
    'find':        `${mod}${plus}F`
  };
}

// "Heads up" notices in the welcome dialog. Each entry is independently
// gated by its `active(env)` predicate; the renderer joins active items
// into a single styled box, prefixing with "Heads up —" inline when one
// fires or "Heads up:" + bulleted list when 2+ fire. Adding a new notice
// is a one-liner here — drop a new object in the array, give it a unique
// id, an active() predicate, and text. The text must NOT include "Heads
// up" itself; the renderer adds the prefix in the correct grammatical
// form for the active count.
//
// `env` is supplied by the caller so tests can pass synthetic environments
// without mocking `window` / `matchMedia`. See computeEnv() for the
// runtime composition.
export function headsUpNotices(env) {
  const all = [
    {
      id: 'no-fsa',
      // Firefox / Safari / iOS — no File System Access API, so every save
      // triggers a fresh download instead of writing back to disk.
      active: (e) => !e.hasFsa,
      text: "your browser can't silently save changes — each save downloads a fresh copy. For native-like save, use Chrome / Edge or the desktop app."
    },
    {
      id: 'no-cmd-n',
      // Cmd/Ctrl+N is reserved by every browser for "new window" and
      // can't be intercepted from JS. Tauri's native menu catches it, so
      // this only applies to web. Suppress on touch-only devices where
      // keyboard shortcuts don't apply (the shortcut hint is hidden by
      // CSS there too, so calling it out would just confuse).
      active: (e) => !e.onTauri && !e.isTouchOnly,
      text: "Cmd/Ctrl+N won't work on web — click New above."
    }
  ];
  return all
    .filter((n) => {
      try { return !!n.active(env); } catch (_e) { return false; }
    })
    .map(({ id, text }) => ({ id, text }));
}

function computeEnv() {
  const w = (typeof window !== 'undefined') ? window : null;
  if (!w) return { hasFsa: false, onTauri: false, isTouchOnly: false };
  const isTouchOnly = (typeof w.matchMedia === 'function')
    && w.matchMedia('(any-hover: none) and (pointer: coarse)').matches;
  return {
    hasFsa: typeof w.showOpenFilePicker === 'function',
    onTauri: typeof w.__TAURI__ !== 'undefined',
    isTouchOnly
  };
}

function renderHeadsUp(dialog, items) {
  const container = dialog.querySelector('.welcome-heads-up');
  if (!container) return;
  // Rebuild contents on every open — predicates may flip between opens
  // (e.g. a user toggles a feature flag in devtools).
  container.replaceChildren();
  if (items.length === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  if (items.length === 1) {
    // Inline prefix form: "Heads up — <text>". Reads as one sentence.
    const p = document.createElement('p');
    p.className = 'welcome-heads-up-single';
    const strong = document.createElement('strong');
    strong.textContent = 'Heads up —';
    p.append(strong, ' ', items[0].text);
    container.appendChild(p);
    return;
  }
  // Multi-notice form: shared "Heads up:" header + bulleted list.
  const intro = document.createElement('p');
  intro.className = 'welcome-heads-up-intro';
  const strong = document.createElement('strong');
  strong.textContent = 'Heads up:';
  intro.appendChild(strong);
  container.appendChild(intro);
  const ul = document.createElement('ul');
  ul.className = 'welcome-heads-up-items';
  for (const it of items) {
    const li = document.createElement('li');
    li.textContent = it.text;
    ul.appendChild(li);
  }
  container.appendChild(ul);
}

function openDialog() {
  const dialog = document.getElementById('welcome-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;

  const env = computeEnv();

  // Fill in shortcut keys for this platform.
  const keys = shortcutMap();
  dialog.querySelectorAll('[data-key]').forEach((el) => {
    const k = el.getAttribute('data-key');
    if (keys[k]) el.textContent = keys[k];
  });

  // Cmd/Ctrl+N is reserved by every browser for "new window" and cannot be
  // intercepted from JS. Tauri's native menu DOES intercept it, so the hint
  // stays only on desktop. The "New" button itself is always clickable; the
  // matching heads-up notice (id: 'no-cmd-n') explains why the row's hint
  // disappeared.
  if (!env.onTauri) {
    const newKeyEl = dialog.querySelector('[data-key="new"]');
    if (newKeyEl) newKeyEl.hidden = true;
  }

  // Stamp the version. No highlight state any more — show-once means we
  // never re-trigger the dialog to draw attention to an upgrade.
  const versionEl = document.getElementById('welcome-version');
  if (versionEl) versionEl.textContent = `v${VERSION}`;

  // Heads-up box: data-driven from the headsUpNotices() registry above.
  renderHeadsUp(dialog, headsUpNotices(env));

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
