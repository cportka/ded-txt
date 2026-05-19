// First-visit welcome dialog. Shown once on desktop only — mobile users
// don't have keyboard shortcuts and get straight to the editor. The
// "Don't show this again" checkbox is pre-checked, so dismissing without
// touching it (the expected path) suppresses the dialog for future visits.

const STORAGE_KEY = 'dedtxt-welcome-shown';

function isMobile() {
  // No hover-capable pointer = touch-primary device.
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return !window.matchMedia('(any-hover: hover)').matches;
}

function isMac() {
  const plat = (navigator.platform || '').toLowerCase();
  if (plat.includes('mac') || plat.includes('iphone') || plat.includes('ipad') || plat.includes('ipod')) return true;
  return /Mac/i.test(navigator.userAgent || '');
}

function shortcutMap() {
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

  try {
    if (localStorage.getItem(STORAGE_KEY) === '1') return;
  } catch (e) {
    // Private mode: still show the dialog, just don't persist the dismissal.
  }

  const dialog = document.getElementById('welcome-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;

  // Fill in shortcut keys for this platform.
  const keys = shortcutMap();
  dialog.querySelectorAll('[data-key]').forEach((el) => {
    const k = el.getAttribute('data-key');
    if (keys[k]) el.textContent = keys[k];
  });

  const dontShow = document.getElementById('welcome-dont-show');
  const dismiss = document.getElementById('welcome-dismiss');

  dismiss.addEventListener('click', () => dialog.close());

  dialog.addEventListener('close', () => {
    if (dontShow && dontShow.checked) {
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) { /* ignore */ }
    }
  }, { once: true });

  dialog.showModal();
}
