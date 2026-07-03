# Roadmap & future ideas

DedTxt stays *dead simple* — most "more of an editor" ideas are non-goals. This
is the roadmap toward a confident 1.0 and beyond, seeded by a full multi-lens
repo audit. Shipped work lives in [CHANGELOG.md](./CHANGELOG.md).

## Before 1.0.0

- **Cut the 1.0.0 release.** You can't be a confident 1.0 while every version
  file still reads `1.0.0-rc.N`. Decide a post-rc version policy for a
  continuously-deployed PWA (semver bumps on user-visible change? treat the build
  SHA as the real deploy id?), set all four version files to `1.0.0`, tag
  `v1.0.0`, and cut a source GitHub Release so the changelog can use real tags.
  *(A product decision — yours to make.)*
- **Surface save/open failures.** The renderer discards `result.error`, and there
  is no toast / status / `aria-live` surface anywhere. A failed FSA write (disk
  full, revoked permission) or a failed open leaves the user with no feedback but
  the dirty bullet — "I pressed Save and nothing told me it failed" is a
  trust-critical gap for a 1.0 editor. `web.js` already returns `{ok:false,
  error}`; add a small notice (reuse the heads-up / glitch vocabulary).
- **Resolve the PWA `file_handlers` promise.** `manifest.webmanifest` advertises
  "open .txt / .md / .json / … with DedTxt", but no `window.launchQueue`
  consumer exists, so an installed PWA set as the file handler opens **blank** and
  drops the file. Either wire `launchQueue` into the open path (route the handle
  through `web.js` so re-saves stay silent) or drop the `file_handlers`
  declaration. rc.59's install button made this more reachable.

## Desktop (revive when ready)

Native installers are paused; the code + Rust tests are kept green by the CI
`desktop-check` job. The renderer↔platform contract is fully in sync. To revive:

- **Code signing.** macOS Developer-ID signing + notarization and Windows
  Authenticode — none is configured today, so un-gating as-is would ship unsigned
  `.dmg` / `.msi` that Gatekeeper and SmartScreen flag as broken. (Largest lift.)
- **Un-gate CI together.** Flip the `desktop` + `release` jobs' `if: ${{ false }}`
  back and re-add the `tags: ['v*']` push trigger — all three, or it's a silent
  no-op.
- **Commit `src-tauri/Cargo.lock`** and pin the Tauri / ureq deps. They float on
  `2.x` today, so `desktop-check` (and any future build) can break on an upstream
  release with zero source changes.
- **Harden `desktop-check`.** It only runs debug `cargo test`, so release-only and
  macOS-only code paths never compile in CI; add `cargo build --release` (and
  ideally a macOS leg).
- **Coordinate `nativeMin`** (`scripts/build-web.js`) with the last-shipped shell
  version so OTA "web" hot-swaps keep working for installed users.

*(The dead desktop File→Open menu — `dt://menu-open` was emitted but never
listened for — was fixed in rc.60.)*

## Later / nice-to-have

- **Crash / draft recovery** — periodically stash the buffer to `localStorage` so
  an accidental close or reload can offer to restore unsaved text.
- **Test hardening** — a `SHELL`-completeness test (would have caught the rc.59
  offline regression), a `build-web.js` smoke test, and a find/gutter CSS-parity
  test. These are the load-bearing invariants with no current guard.
- **A11y polish** — raise `--muted` text contrast to WCAG AA; make the info /
  donation popup keyboard-reachable (it closes on any keydown today, trapping its
  github/privacy/donation links); add `aria-live` to the find counter; give the
  welcome dialog a visible close affordance for touch/SR users.
- **PWA install polish** — add manifest `screenshots` (wide + narrow) for the
  richer install card; consider the `black-translucent` iOS status-bar style.
- **Debounce find** for multi-MB documents (today every keystroke reruns a
  whole-document regex scan + repaints the entire highlight overlay).
- **Don't mark the buffer clean** on the unconfirmable Firefox/Safari
  download-fallback save (the download API can't report success).
- **Small stuff** — a light/dark toggle (locked dark today), a save-encoding
  choice (UTF-8-only today), and more sponsor options (Venmo + ETH + BTC today;
  the GitHub Sponsor button is wired via `.github/FUNDING.yml`).
