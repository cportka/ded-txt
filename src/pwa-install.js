// "Install as web app" button wiring.
//
// The browser fires `beforeinstallprompt` only when the app is genuinely
// installable: a supporting engine (Chromium), served over https, not already
// installed, and meeting the PWA install criteria. We stash that event and
// reveal the button; clicking it replays the browser's native install prompt.
//
// If the event never fires — iOS Safari, Firefox, an already-installed
// instance, or the Tauri desktop shell — the button stays hidden, which is
// exactly "hide it when installing isn't possible". The exported helpers are
// pure-ish so the behaviour can be unit-tested without a real browser.

export function isStandalone(win) {
  if (!win) return false;
  try {
    if (typeof win.matchMedia === 'function'
      && win.matchMedia('(display-mode: standalone)').matches) return true;
  } catch (_e) { /* matchMedia can throw on malformed queries — ignore */ }
  // iOS Safari home-screen apps expose this legacy flag instead.
  return !!(win.navigator && win.navigator.standalone);
}

export function initInstallPrompt(opts = {}) {
  const win = opts.window || (typeof window !== 'undefined' ? window : null);
  const doc = opts.document || (typeof document !== 'undefined' ? document : null);
  if (!win || !doc || typeof win.addEventListener !== 'function') return;
  const btn = doc.getElementById('install-pwa');
  if (!btn) return;

  // Already running as an installed app → there's nothing to offer.
  if (isStandalone(win)) { btn.hidden = true; return; }

  let deferred = null;

  win.addEventListener('beforeinstallprompt', (e) => {
    // Suppress the browser's own mini-infobar; we surface our own button.
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });

  btn.addEventListener('click', async () => {
    if (!deferred) return;
    btn.disabled = true;
    try {
      deferred.prompt();
      if (deferred.userChoice) await deferred.userChoice;
    } catch (_e) { /* user dismissed or the prompt failed — ignore */ }
    // A captured prompt can only be used once.
    deferred = null;
    btn.hidden = true;
    btn.disabled = false;
  });

  // Installed via our button or the browser's own UI → drop the affordance.
  win.addEventListener('appinstalled', () => {
    deferred = null;
    btn.hidden = true;
  });
}
