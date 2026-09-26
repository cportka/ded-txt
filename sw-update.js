// Pure decision helpers for the WEB service-worker update lifecycle.
//
// The web/PWA build detects updates via the SW lifecycle (not version.json,
// which is the desktop OTA path — see update.js). The DOM/SW wiring lives in
// renderer.js; the two decisions it makes live here so they can be unit-tested
// away from the browser's ServiceWorker APIs, and so the "when do we nag the
// user?" and "how often do we re-check?" rules are pinned by tests.
//
// Update model (intentional, migration-safe): sw.js calls skipWaiting() in its
// install handler, so a freshly-installed worker activates promptly and a
// later reload always serves the new assets. The user still drives the reload
// via the one-click "update" notice — we never reload out from under them.

// Surface the "an update is ready" notice exactly when a newly-installed
// worker sits behind an existing controller — i.e. this is an UPDATE, not the
// first-ever install (no controller yet), which must not nag.
export function shouldSurfaceWebUpdate(swState, hasController) {
  return swState === 'installed' && !!hasController;
}

// Throttle background update re-checks (reg.update() when the tab regains
// focus) so an always-open installed PWA notices a new deploy on its own
// without hammering the network. Returns true once at least minGapMs has
// elapsed since the last check. The caller seeds lastMs with the registration
// time, so the first eligible re-check is one full gap after load (no point
// re-checking the instant we just registered). A non-finite clock is treated
// as "don't check" so a bad Date never spams the network.
export function shouldRecheckUpdate(lastMs, nowMs, minGapMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastMs)) return false;
  return nowMs - lastMs >= minGapMs;
}

// Minutes between background re-checks. 30 min balances "surfaces a deploy
// soon after the user comes back to the tab" against network chatter for a
// PWA that's left open for days.
export const RECHECK_GAP_MS = 30 * 60 * 1000;
