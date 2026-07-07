// Toast-style notices for save/open failures and draft recovery.
//
// Renders small glitch-styled cards into the static #notice-region container
// (index.html). The region carries role="alert" + aria-live="assertive", so
// appending a notice announces it to screen readers — the container must
// exist in the DOM at page load for that to work reliably, which is why it
// lives in index.html rather than being created here.
//
// Motion follows the project contract: the glitch in/out animations are
// CSS-only and gated behind prefers-reduced-motion (styles.css), so this
// module just toggles classes and lets the stylesheet decide.
//
// `formatResultError` is a pure helper (exported for unit testing) that maps
// a platform {ok, canceled, error} result to a user-facing message — or null
// when there is nothing to report (success, or the user canceled a picker).

import { prefersReducedMotion } from './welcome.js';

const AUTO_HIDE_MS = 6000;
// Safety net if animationend never lands (mirrors closeWelcome's timer).
const GLITCH_OUT_FALLBACK_MS = 270;

export function formatResultError(result, verb) {
  if (!result || result.ok) return null;
  // A canceled picker is a user decision, not a failure — stay quiet.
  if (result.canceled) return null;
  return result.error ? `${verb} failed — ${result.error}` : `${verb} failed`;
}

// Show a notice. Options:
//   kind:      'error' adds the magenta error treatment.
//   sticky:    true disables the auto-hide (used by the draft-restore offer,
//              which must wait for an explicit user decision).
//   actions:   [{ label, onClick }] rendered as inline buttons. onClick runs
//              FIRST; returning false keeps the notice up (so a handler can
//              show a confirm() and leave the offer standing on cancel).
//              Any other return dismisses the notice.
//   onDismiss: called exactly once when the notice leaves for ANY reason —
//              action, ✕ button, or auto-hide. Lets the caller release
//              state tied to the notice's lifetime (the draft stash's
//              suspend flag) without caring which path closed it.
// Returns { el, dismiss } or null when the region is missing (tests, or a
// stripped-down host page).
export function showNotice(message, opts = {}) {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return null;
  const region = document.getElementById('notice-region');
  if (!region) return null;

  const el = document.createElement('div');
  el.className = opts.kind === 'error' ? 'notice notice-error' : 'notice';

  const text = document.createElement('span');
  text.className = 'notice-text';
  text.textContent = message;
  el.appendChild(text);

  let hideTimer = 0;
  let outTimer = 0;
  let dismissed = false;

  const remove = () => {
    if (!el.isConnected) return;
    el.removeEventListener('animationend', onOutEnd);
    el.remove();
  };
  const onOutEnd = (e) => {
    if (e.animationName === 'notice-glitch-out') {
      clearTimeout(outTimer);
      remove();
    }
  };
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(hideTimer);
    if (typeof opts.onDismiss === 'function') opts.onDismiss();
    if (prefersReducedMotion()) {
      remove();
      return;
    }
    el.classList.remove('notice-glitch-in');
    el.classList.add('notice-glitch-out');
    el.addEventListener('animationend', onOutEnd);
    outTimer = setTimeout(remove, GLITCH_OUT_FALLBACK_MS);
  };

  for (const action of opts.actions || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notice-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      // Handler first: it may decline (confirm() canceled) by returning
      // false, in which case the notice must survive the click.
      if (typeof action.onClick === 'function' && action.onClick() === false) return;
      dismiss();
    });
    el.appendChild(btn);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'notice-dismiss';
  close.setAttribute('aria-label', 'Dismiss notice');
  close.textContent = '✕';
  close.addEventListener('click', dismiss);
  el.appendChild(close);

  region.appendChild(el);
  if (!prefersReducedMotion()) el.classList.add('notice-glitch-in');
  if (!opts.sticky) hideTimer = setTimeout(dismiss, opts.duration || AUTO_HIDE_MS);

  return { el, dismiss };
}
