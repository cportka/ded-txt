// PWA install controller.
//
// The browser fires `beforeinstallprompt` only when the app is genuinely
// installable: a supporting engine (Chromium), served over https, not already
// installed, and meeting the PWA install criteria. We capture that event and
// expose "can install / prompt to install / tell me when this changes" so the
// welcome dialog can offer a one-click install line in its Heads-up box
// (mirroring the update notice). On iOS Safari / Firefox / an already-installed
// instance / the Tauri shell the event never fires, so `canInstall()` stays
// false and no install affordance is shown — which is exactly right, since
// there's no programmatic one-click install to offer there.
//
// The controller takes injectable window so it can be unit-tested without a
// real browser.

export function isStandalone(win) {
  if (!win) return false;
  try {
    if (typeof win.matchMedia === 'function'
      && win.matchMedia('(display-mode: standalone)').matches) return true;
  } catch (_e) { /* matchMedia can throw on malformed queries — ignore */ }
  // iOS Safari home-screen apps expose this legacy flag instead.
  return !!(win.navigator && win.navigator.standalone);
}

export function createInstallController(opts = {}) {
  const win = opts.window || (typeof window !== 'undefined' ? window : null);
  let deferred = null;
  let installed = false;
  const listeners = [];

  const notify = () => {
    for (const fn of listeners) {
      try { fn(); } catch (_e) { /* a listener throwing must not break the rest */ }
    }
  };

  const controller = {
    // True only when a captured prompt is available and we haven't installed.
    canInstall() { return !!deferred && !installed; },

    // Replay the browser's native install prompt. Returns true if a prompt was
    // shown, false if none was available (so callers can no-op cleanly). A
    // captured prompt is single-use, so it's cleared regardless of outcome.
    async prompt() {
      if (!deferred) return false;
      const d = deferred;
      deferred = null;
      try {
        d.prompt();
        if (d.userChoice) await d.userChoice;
      } catch (_e) { /* user dismissed or the prompt failed — ignore */ }
      notify();
      return true;
    },

    // Register a callback fired whenever installability changes (prompt
    // captured, install completed, or a prompt consumed). Used by the welcome
    // dialog to re-render its Heads-up box in place.
    onChange(cb) { if (typeof cb === 'function') listeners.push(cb); }
  };

  if (!win || typeof win.addEventListener !== 'function') return controller;
  // Already running as an installed app → nothing to offer, and no listeners
  // needed (the events won't fire in standalone anyway).
  if (isStandalone(win)) return controller;

  win.addEventListener('beforeinstallprompt', (e) => {
    // Suppress the browser's own mini-infobar; we surface our own affordance.
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    deferred = e;
    notify();
  });

  // Installed via our prompt or the browser's own UI → drop the affordance.
  win.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });

  return controller;
}
