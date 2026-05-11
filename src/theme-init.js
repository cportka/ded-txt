// Synchronous theme bootstrap. Loaded in <head> before any styles or
// modules so the page never paints in the wrong palette. First-time
// visitors get dark; the user's choice (set via the corner toggle) is
// persisted in localStorage.
(function () {
  try {
    // MIGRATION: copy old key to new key once, then remove old.
    // Added during DeadText → DedTxt rename. Safe to remove after a few months.
    var old = localStorage.getItem('deadtext-theme');
    if (old && !localStorage.getItem('dedtxt-theme')) {
      localStorage.setItem('dedtxt-theme', old);
    }
    if (old) localStorage.removeItem('deadtext-theme');

    var t = localStorage.getItem('dedtxt-theme');
    if (t !== 'dark' && t !== 'light') t = 'dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
