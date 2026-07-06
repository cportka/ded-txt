# Privacy

dedtxt collects nothing. There are no analytics, no third-party scripts,
no servers, no accounts.

**Your text** lives only where you put it: in your browser, on your disk,
or in a download you triggered. dedtxt never transmits it.

**Local storage** holds two purely functional values:
- `dedtxt-welcomed` — set when you dismiss the welcome dialog so it
  doesn't auto-open on every visit. You can re-open it any time by
  clicking the icon in the top-right corner or pressing Escape.
- `dedtxt-draft` — crash recovery. While you have unsaved changes, the
  buffer is stashed here (in your browser only, never transmitted) so a
  crash or accidental close can offer to restore it on the next visit.
  It's removed when you save, start a new file, or choose Discard on the
  restore offer — or by clearing your site data.

Nothing else is read or written. Clear your site data at any time to reset
it. The desktop builds (Tauri) behave identically — no preferences are
stored on disk.

**Hosting**: the web app at <https://dedtxt.app/> is a static site served
from GitHub Pages. Standard GitHub server logs (IP, user-agent) apply to
the page load itself; see GitHub's
[general privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
for what they retain. dedtxt itself does not augment those logs in any way.

This document is the privacy policy. Last updated 2026-07.
