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

// True while the welcome card's glitch-out is mid-flight, so the dismiss
// paths (backdrop, ESC/cancel, shortcut buttons) don't stack a second
// animation or fire their action twice.
let closingWithGlitch = false;

// Set to a canceller while a glitch-out is animating. An immediate close
// (Open/Save shortcuts) calls it to abort the pending glitch WITHOUT running
// its afterClose, so tapping a second shortcut mid-animation can't double-fire.
let glitchCleanup = null;

// Honour the OS "reduce motion" setting. Shared by the open "boot" glitch
// and the close glitch-out so both degrade to an instant show/hide; also
// reused by the renderer's "Save as" prompt animation.
export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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
      id: 'esc-hint',
      // Re-homes the binding the dropped "This" shortcut row used to show.
      // Touch devices have no ESC (and shortcut hints are CSS-hidden there),
      // so suppress it on touch-only.
      active: (e) => !e.isTouchOnly,
      text: 'Press ESC to return here'
    },
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

// Dismiss the welcome dialog with a one-shot glitch-out on the card, then
// run an optional callback once it's truly closed. All dismiss paths
// (backdrop, ESC/cancel, shortcut buttons) route through here so the
// animation is consistent. The real dialog.close() runs after the card
// animation (which fires the 'close' listener + its localStorage stamp
// once); reduced motion and an already-closed dialog close immediately,
// and re-entrant calls while a close is animating are ignored so the
// action fires exactly once.
export function closeWelcome(afterClose, opts) {
  const dialog = document.getElementById('welcome-dialog');
  const run = () => { if (typeof afterClose === 'function') afterClose(); };
  if (!dialog || !dialog.open) {
    run();
    return;
  }

  const card = dialog.querySelector('.welcome-card');
  // `immediate` skips the glitch-out and closes synchronously. The Open/Save
  // shortcuts need this: their native file picker / download only fires inside
  // the originating tap, and the ~300ms glitch defer drops the user-activation
  // gesture on iOS Safari (which silently broke Open on mobile). Reduced motion
  // and a card-less dialog also take this synchronous path.
  if ((opts && opts.immediate) || !card || prefersReducedMotion()) {
    if (glitchCleanup) glitchCleanup();
    closingWithGlitch = false;
    dialog.close();
    run();
    return;
  }
  if (closingWithGlitch) return;

  closingWithGlitch = true;
  let done = false;
  let timer = 0;
  const teardown = () => {
    card.removeEventListener('animationend', onEnd);
    card.classList.remove('glitching-out');
    clearTimeout(timer);
    glitchCleanup = null;
  };
  const finalize = () => {
    if (done) return;
    done = true;
    closingWithGlitch = false;
    teardown();
    dialog.close();
    run();
  };
  const onEnd = (e) => {
    if (e.animationName === 'welcome-card-glitch-out') finalize();
  };
  // Abort hook for an immediate close that interrupts this glitch: tears down
  // the animation but does NOT close/run, so the interrupting action owns it.
  glitchCleanup = () => {
    if (done) return;
    done = true;
    closingWithGlitch = false;
    teardown();
  };
  card.classList.remove('glitching-out');
  void card.offsetWidth;
  card.classList.add('glitching-out');
  card.addEventListener('animationend', onEnd);
  // Safety net if animationend never lands (interrupted / unsupported):
  // force the close just past the animation's nominal 180ms duration.
  timer = setTimeout(finalize, 270);
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

  // Wire up close + backdrop-click listeners once; subsequent opens
  // reuse them. The dialog has no explicit dismiss button — Escape (the
  // built-in <dialog> behavior), backdrop click, and any shortcut row
  // all close it.
  if (!listenersAttached) {
    // Click outside the card (i.e. on the backdrop, which is the dialog
    // element itself with showModal()) dismisses the dialog. Clicks inside
    // the card bubble up with event.target as the inner element, so we
    // only act when the click target is the dialog itself.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeWelcome();
    });

    // Native Escape fires 'cancel' before 'close'. Intercept it so ESC plays
    // the glitch-out too: preventDefault stops the immediate native close,
    // then closeWelcome animates and closes for real. Our own dialog.close()
    // emits only 'close' (never 'cancel'), so there's no loop. Under reduced
    // motion we let the native close proceed untouched.
    dialog.addEventListener('cancel', (e) => {
      if (prefersReducedMotion()) return;
      e.preventDefault();
      closeWelcome();
    });

    // Any close — auto, manual, Escape, backdrop, button — marks the user
    // as having been welcomed. Future visits skip the auto-open.
    dialog.addEventListener('close', () => {
      closingWithGlitch = false;
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

  // Stamp a one-shot glitch "boot" on the icon every time we open. CSS
  // does the animation (.welcome-icon-btn.booting → keyframes
  // welcome-icon-boot); we just (re)apply the class and clean up via a
  // name-filtered animationend so a subsequent open re-fires cleanly.
  // The reflow read forces the class removal to commit before re-add,
  // otherwise rapid re-opens would coalesce into no animation at all.
  const iconBtn = document.getElementById('welcome-icon-btn');
  if (iconBtn && !prefersReducedMotion()) {
    iconBtn.classList.remove('booting');
    void iconBtn.offsetWidth;
    iconBtn.classList.add('booting');
    const onBootEnd = (e) => {
      // Same element also runs `menu-spin` on click — don't strip .booting
      // in response to an unrelated animation finishing.
      if (e.animationName !== 'welcome-icon-boot') return;
      iconBtn.classList.remove('booting');
      iconBtn.removeEventListener('animationend', onBootEnd);
    };
    iconBtn.addEventListener('animationend', onBootEnd);
  }

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
