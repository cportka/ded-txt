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

// --- Update-availability state -------------------------------------------
// The most recent "an update is available" result — from the service-worker
// lifecycle on web or the native update check on desktop. Fed into the welcome
// env so the notice shows the next time the dialog opens, and applied live (if
// the dialog is already open) via refreshHeadsUp when an async check resolves.
let currentUpdate = null;
// Maps an actionable notice's onClick token (e.g. 'applyUpdate') to a handler;
// set by the renderer via setHeadsUpHandlers.
let headsUpHandlers = {};
// The env used for the current open, retained so a late update result can
// re-render the heads-up box in place.
let lastEnv = null;

export function setHeadsUpHandlers(handlers) {
  headsUpHandlers = handlers || {};
}

export function setUpdateResult(update) {
  currentUpdate = update || null;
}

// Apply an update result. Stores it and, if the welcome dialog is open right
// now, re-renders the heads-up box so a check that resolves while the dialog
// is showing surfaces immediately (otherwise it appears on the next open).
export function refreshHeadsUp(update) {
  if (update !== undefined) currentUpdate = update || null;
  const dialog = document.getElementById('welcome-dialog');
  if (!dialog || !dialog.open || !lastEnv) return;
  lastEnv = { ...lastEnv, update: currentUpdate };
  renderHeadsUp(dialog, headsUpNotices(lastEnv), headsUpHandlers);
}

// While a desktop update downloads, replace the heads-up notice with a
// determinate progress bar. The dialog is already open (the user clicked the
// notice); a successful update ends in a full reload, which clears this.
export function showUpdateProgress(done, total) {
  const dialog = document.getElementById('welcome-dialog');
  if (!dialog) return;
  const container = dialog.querySelector('.welcome-heads-up');
  if (!container) return;
  container.hidden = false;
  let fill = container.querySelector('.welcome-update-fill');
  if (!fill) {
    container.replaceChildren();
    const p = document.createElement('p');
    p.className = 'welcome-heads-up-single';
    const strong = document.createElement('strong');
    strong.textContent = 'Updating…';
    p.appendChild(strong);
    const track = document.createElement('div');
    track.className = 'welcome-update-track';
    fill = document.createElement('div');
    fill.className = 'welcome-update-fill';
    track.appendChild(fill);
    container.append(p, track);
  }
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  fill.style.width = `${pct}%`;
}

// Honour the OS "reduce motion" setting. Shared by the open "boot" glitch
// and the close glitch-out so both degrade to an instant show/hide.
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
      text: "Your browser can't silently save changes — each save downloads a fresh copy. For native-like save, use Chrome or Edge."
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
    },
    {
      // A newer web layer is available and the runtime can hot-swap it (web:
      // reload to the freshly-cached SW assets; desktop: fetch + reload).
      id: 'update-web',
      active: (e) => !!(e.update && e.update.kind === 'web'),
      text: 'A new version is ready.',
      action: { label: 'Click here to update', onClick: 'applyUpdate' }
    },
    {
      // A newer release needs a newer native shell than is installed, so the
      // web layer can't be swapped in place — send the user to a full build.
      id: 'update-native',
      active: (e) => !!(e.update && e.update.kind === 'native'),
      text: 'A new desktop build is available.',
      action: (e) => ({
        label: 'Get the new desktop build →',
        href: (e.update && e.update.url) || 'https://github.com/cportka/dedtxt/releases/latest'
      })
    }
  ];
  return all
    .filter((n) => {
      try { return !!n.active(env); } catch (_e) { return false; }
    })
    .map((n) => {
      const out = { id: n.id, text: n.text };
      if (n.action) out.action = typeof n.action === 'function' ? n.action(env) : n.action;
      return out;
    });
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

// Pure description of a notice's action control, so tests can assert the
// rendered shape without a DOM. Returns null when the notice has no action.
export function actionNodeSpec(item) {
  const a = item && item.action;
  if (!a) return null;
  if (a.href) return { tag: 'a', label: a.label, href: a.href };
  if (a.onClick) return { tag: 'button', label: a.label, onClick: a.onClick };
  return null;
}

// Build the DOM node for a notice's action (external link or in-app button),
// or null. `handlers` maps an action's onClick token to a callback.
function actionNode(item, handlers) {
  const spec = actionNodeSpec(item);
  if (!spec) return null;
  if (spec.tag === 'a') {
    const a = document.createElement('a');
    a.href = spec.href;
    a.textContent = spec.label;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'welcome-heads-up-action';
  btn.textContent = spec.label;
  btn.addEventListener('click', () => {
    const fn = handlers && handlers[spec.onClick];
    if (typeof fn === 'function') fn();
  });
  return btn;
}

function renderHeadsUp(dialog, items, handlers) {
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
    const node = actionNode(items[0], handlers);
    if (node) p.append(' ', node);
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
    const node = actionNode(it, handlers);
    if (node) li.append(' ', node);
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

  const env = { ...computeEnv(), update: currentUpdate };
  lastEnv = env;

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
  renderHeadsUp(dialog, headsUpNotices(env), headsUpHandlers);

  // Wire up close + backdrop-click listeners once; subsequent opens
  // reuse them. Escape (the built-in <dialog> behavior), backdrop click,
  // the ✕ close button, and any shortcut row all close it.
  if (!listenersAttached) {
    // Click outside the card (i.e. on the backdrop, which is the dialog
    // element itself with showModal()) dismisses the dialog. Clicks inside
    // the card bubble up with event.target as the inner element, so we
    // only act when the click target is the dialog itself.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeWelcome();
    });

    // Visible close affordance — Escape and backdrop clicks are invisible
    // dismiss paths to touch and screen-reader users; the ✕ is explicit.
    const closeBtn = dialog.querySelector('#welcome-close');
    if (closeBtn) closeBtn.addEventListener('click', () => closeWelcome());

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

  // One-shot whole-card glitch-in on every open, paired with the icon boot
  // below so the main window snaps in glitchy (not just the icon). Same
  // remove → reflow → re-add restart trick + name-filtered animationend
  // cleanup so rapid re-opens re-fire cleanly. The version stamp's own
  // shudder is CSS-scoped to .glitching-in, so it rides along and stops when
  // this class is cleared.
  const card = dialog.querySelector('.welcome-card');
  if (card && !prefersReducedMotion()) {
    card.classList.remove('glitching-in');
    void card.offsetWidth;
    card.classList.add('glitching-in');
    const onCardGlitchEnd = (e) => {
      if (e.animationName !== 'welcome-card-glitch-in') return;
      card.classList.remove('glitching-in');
      card.removeEventListener('animationend', onCardGlitchEnd);
    };
    card.addEventListener('animationend', onCardGlitchEnd);
  }

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
