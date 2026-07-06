# Changelog

All notable changes to dedtxt. This is the single source of project history —
older planning notes have been folded in here. dedtxt is in a pre-1.0
release-candidate series; the version is kept in lockstep across
`src/version.js`, `package.json`, `src-tauri/tauri.conf.json`, and
`src-tauri/Cargo.toml`.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0]

**First stable release.** dedtxt is a dead-simple, dependency-free plain-text
editor: a single textarea and your file, installable as an offline PWA, with no
accounts and no tracking. This 1.0.0 is the culmination of the `1.0.0-rc.*`
series (see the entries below for the full path here) — the release-candidate
cycle hardened save/open feedback, crash/draft recovery, the PWA install and
update flows, accessibility, the test guards, and the site/security furniture
to a launch-ready state (independent review: A/97).

From 1.0.0 onward the repo follows the Portka standard's enforced
[SemVer](https://semver.org) with **no rc exception**: PATCH for
backward-compatible fixes, MINOR for backward-compatible features (the
light/dark toggle is slated for 1.1.0), MAJOR for breaking changes. The web
PWA is continuously deployed from `main`; each user-visible change ships under
its own SemVer bump, and the build SHA (`version.json` `buildId`) remains the
precise per-deploy identifier.

### Fixed
- **Escape while the Find bar is open now just closes Find** and no longer also
  pops the welcome dialog open behind it. Works whether focus is in a Find text
  field or on one of its buttons.

## [1.0.0-rc.63]

Launch-review cleanup (Portka `app-website-evaluator`, A/97): the punch-list
items that were low-effort/high-value, plus a brand-name standardization.

### Changed
- **Name is now stylized lowercase `dedtxt` everywhere it's displayed** — the
  window/tab title, PWA manifest (`name`/`short_name`), Apple web-app title,
  Open Graph/Twitter/JSON-LD, meta description, in-app labels, and the docs.
  The domain (`dedtxt.app`), the repo slug (`ded-txt`), and the author are
  unchanged.
- **Clean window title.** The tab/window title is now just `dedtxt` (was
  `DedTxt — a dead simple plain-text editor`); with a file open it's
  `<name> — dedtxt` / `• <name> • — dedtxt`. The descriptive text still lives
  in the meta description, OG/Twitter titles, and the visually-hidden `<h1>`
  for SEO.

### Added
- **SVG favicon** (`icons/icon.svg`, the master art) linked ahead of the PNG
  fallback and precached in the service-worker shell — crisp on hi-DPI tabs.
- **`featureList` in the `WebApplication` JSON-LD** (offline, find/replace,
  real file save, draft recovery, zero-dependency) for richer AI/AEO parsing.

### Security
- **Tightened the deployed CSP.** The web build now ships
  `connect-src 'self'` — the Tauri-only `ipc:` / `http://ipc.localhost` tokens
  are stripped from the PWA output (the shared source keeps them for the paused
  desktop webview). Pairs with the custom domain's now-enforced HTTPS (HSTS via
  GitHub Pages).

## [1.0.0-rc.62]

Release-runway polish: a one-click install path, update-flow hardening for a
continuously-deployed PWA, the repo rename, and a refreshed social card.

### Added
- **One-click install from the menu.** When the browser offers a PWA install
  (Chromium, https, not already installed), the welcome dialog's Heads-up box
  shows an "install" line whose action replays the native install prompt in a
  single click — the same shape as the update notice. It appears on its own if
  `beforeinstallprompt` fires after the dialog is already open, and clears
  itself once installed. The old standalone "Install as web app" button was
  removed so there's exactly one install affordance. `pwa-install.js` is now a
  testable install controller (`canInstall` / `prompt` / `onChange`).
- **Updates surface on their own.** An always-open installed PWA now re-checks
  for a new deploy when its tab regains focus (throttled to every 30 min), so
  the one-click "update" notice appears without the user manually reloading —
  the browser's built-in ~24h service-worker check is far too slow for a
  continuously-deployed app. New `sw-update.js` holds the (unit-tested) "when
  to surface" + "when to re-check" decisions; a real v1→v2 update cycle is now
  covered end-to-end in a headless browser.
- **GitHub social preview** (`.github/social-preview.png`, 1280×640) generated
  by `build-icons.js` in the brand's glitch language — upload it via the repo's
  Settings → Social preview.

### Changed
- **Repository renamed `dedtxt` → `ded-txt`.** All `github.com/cportka/dedtxt`
  references updated across the app, docs, manifest, security.txt, and Rust
  crate. The product name (**DedTxt**), the domain (**dedtxt.app**), and the
  npm package name (`dedtxt`) are unchanged.
- **Sponsor options** expanded to match the portka-tools marketplace: GitHub
  Sponsors, Buy Me a Coffee, Venmo, plus BTC/ETH block-explorer links.
- The service-worker update contract is now documented in `sw.js` and guarded
  by `sw-update` + `sw-shell` tests, so a future refactor can't silently break
  the one-click update or reintroduce the rc.59 offline regression.

## [1.0.0-rc.61]

The 1.0.0-prep batch: the old FUTURE.md "Later / nice-to-have" list was
promoted into the pre-1.0 scope and most of it shipped here (everything except
the light theme). Also onboards the repo to the Portka standard.

### Added
- **Save/open failures are finally visible.** A new glitch-styled toast
  (`notice.js` + the `#notice-region` aria-live region) surfaces
  `Save failed — …` / `Open failed — …` with the platform's error detail;
  canceled pickers stay silent. Previously a failed FSA write was swallowed —
  the top 1.0 trust gap.
- **Crash / draft recovery** (`drafts.js`): while the buffer is dirty it's
  stashed to localStorage (debounced 1.5 s, flushed on page hide, capped at
  2 M chars); the next boot offers *Restore / Discard*. Cleared on confirmed
  save, New, or Discard — deliberately kept after the unverifiable
  download-fallback save and after Open.
- **PWA `file_handlers` actually work now.** A `window.launchQueue` consumer
  routes OS-launched files through the normal open path and keeps the file
  handle, so re-saves stay silent. Launches that arrive before the renderer
  subscribes are buffered, not dropped. (The manifest advertised this for
  releases; an installed PWA set as the handler opened blank.)
- **PWA install polish:** manifest `screenshots` (wide 1280×800 + narrow
  750×1334, generated from the real app) for the richer install card, and the
  `black-translucent` iOS status-bar style (safe-area padding already
  compensates).
- **`/.well-known/security.txt`** (RFC 9116) emitted by the web build, with
  Expires re-stamped one year out on every deploy.
- **Test hardening — the three untested load-bearing invariants now have
  guards:** a SHELL-completeness test (crawls renderer.js's static import
  graph vs `sw.js`'s precache — would have caught the rc.59 offline
  regression), a `build-web.js` smoke test over the real dist-web output, and
  a find/gutter CSS-parity test pinning `#text-editor` /
  `#editor-highlights-inner` / `#editor-mirror` text-layout equality incl. the
  16 px touch bump.
- **Portka standard onboarding:** committed `.claude/settings.json` (plugin
  marketplace + permissions allowlist), the workflow block in
  `.claude/CLAUDE.md`, and `tests/run-tests.sh` + `tests/version-sync.test.mjs`
  enforcing version/CHANGELOG sync (wired into CI). Pre-1.0 exception: the
  version stays `1.0.0-rc.N` (valid SemVer prerelease) until the 1.0.0 cut.

### Fixed
- **Draft-recovery hardening** (from the pre-merge adversarial review of this
  very batch): Restore drops any file handle picked up while the offer was
  pending, so a later Ctrl+S can't silently overwrite an unrelated opened
  file with draft content; closing the offer with ✕ resumes stashing instead
  of silently disabling crash recovery for the session; declining Restore's
  confirm keeps the offer (and the stored draft) alive; a confirmed save or
  New while the offer is undecided no longer deletes the previous session's
  draft; undoing back to the saved text clears this session's now-stale
  draft; Tab-inserts and the welcome dialog's forwarded first keystroke now
  schedule stashes; OS-launched (`launchQueue`) open failures surface an
  error notice instead of a silently blank editor; `PRIVACY.md` documents
  the `dedtxt-draft` key.
- **The download-fallback save no longer lies about being saved.** On
  Firefox/Safari (no FSA) a save triggers a download the browser can't
  confirm; the result is now `{ok, unconfirmed}` and the buffer keeps its
  dirty marker + recovery draft until a verifiable save. (Chromium FSA saves
  behave as before.)
- **Find in multi-MB documents no longer rescans on every keystroke** —
  queries against buffers ≥ 500 k chars debounce 150 ms; navigation/replace
  flush the pending search first so they never act on stale matches. Small
  documents keep instant-as-you-type search.

### Accessibility
- `--muted` lifted `#666` → `#8a8a8a` (~3.3:1 → ~5.5:1 on the editor
  background) — the find counter, heads-up notices, and placeholder now pass
  WCAG AA.
- The info/donation popup is keyboard-reachable: opening it moves focus to its
  first link, Tab walks its controls, Enter/Space activate them, Escape closes
  and returns focus to the icon (it used to close on *any* keydown, trapping
  keyboard users out); the icon button now carries `aria-expanded` +
  `aria-controls`.
- The welcome dialog has a visible ✕ close button (Escape / backdrop-click
  were invisible dismiss paths on touch and to screen readers).
- The find counter (`3 / 17`) is an `aria-live` status region.

## [1.0.0-rc.60]

A cleanup + hardening pass seeded by a full multi-lens repo audit, plus the
session-handoff docs.

### Fixed
- **Offline regression from rc.59:** `pwa-install.js` is imported at startup but
  was missing from the service worker's precache `SHELL`, so an offline reload
  right after an update could boot to a blank app. Now precached.
- **Replace All is undoable again:** it replaced the buffer via `editor.value =`,
  wiping the textarea's native undo stack; it now uses `setRangeText` (like
  Replace), so Ctrl+Z restores the pre-replace text.
- **Desktop File→Open was dead:** Rust emitted `dt://menu-open` but nothing
  listened, so the menu item (and Cmd/Ctrl+O) did nothing. Added the symmetric
  `onMenuOpen` wiring (web no-op, tauri listener → renderer `doOpen`). Desktop is
  paused, but the fix keeps it revival-ready.

### Accessibility & security
- Labelled the core controls: `aria-label` on the editor textarea + find/replace
  inputs, `role="search"` on the find bar, `aria-haspopup` on the menu button.
- Gated the last two ungated animations (the menu/icon spin and the shortcut
  flash) behind `prefers-reduced-motion`, per the project's motion contract.
- Tightened the CSP: dropped the unused `img-src data:`, added `base-uri 'none'`
  + `form-action 'none'`, and removed a dead inline `onsubmit` that tripped a CSP
  violation on every load.

### Changed
- `manifest.webmanifest`: added `lang` + `dir`.
- Docs: expanded `CLAUDE.md` (architecture map, platform contract, invariants),
  rewrote `FUTURE.md` as the 1.0 roadmap, added a Find shortcut row + an Updates
  qualifier to the README, and refreshed `package.json` keywords (pwa / offline).
- Fixed two stale comments (`welcome.js` referenced the removed rc.58 "Save as"
  prompt; `update.js` is the paused desktop path, not the web update flow).

## [1.0.0-rc.59]

### Changed
- **Native desktop builds paused.** Installers (macOS / Windows / Linux via
  Tauri) are deprecated for now — the installable PWA at <https://dedtxt.app/>
  is the shipping target. The Tauri code, Rust unit tests, and CI are
  preserved: the desktop bundling + release jobs are gated off, and Rust tests
  now run on every push so the desktop code stays green and ready to revive
  (see [FUTURE.md](./FUTURE.md)).
- **Welcome dialog:** replaced the "Get desktop builds" link with an **"Install
  as web app"** button that fires the browser's PWA install prompt. It hides
  itself when install isn't possible (iOS Safari, Firefox, already installed).
- The web build now stamps the real version into the welcome dialog's version
  span, so view-source / crawlers / pre-hydration HTML show the shipped version
  instead of the `v0.0.0` placeholder.

### Added
- **Bitcoin donation** address alongside Ethereum in the about popup
  (click to copy, same glitch confirmation).
- A small **link back to the GitHub project** in the welcome dialog.
- **`llms.txt`** for LLM / agent discoverability.
- GitHub **issue templates**, a **pull-request template**, **`CONTRIBUTING.md`**,
  and **`FUNDING.yml`** (Sponsor button).
- This **`CHANGELOG.md`** and a sparse **[`FUTURE.md`](./FUTURE.md)** roadmap.

## [1.0.0-rc.58]

### Changed
- One native Save dialog on the web: removed the in-app "Save as" modal.
  Chrome / Edge use the File System Access picker; Firefox / Safari download
  directly. Default filename is `untitled.txt`; a typed extension is honored.

### Added
- SEO + social: meta description, canonical, Open Graph + Twitter cards, a
  `WebApplication` JSON-LD block, a generated 1200×630 `og-image.png`,
  `robots.txt`, and `sitemap.xml`.

## [1.0.0-rc.57] and earlier — the polish series

The bulk of the rc series refined a deliberately tiny editor. Highlights:

- **Find & replace** (rc.33): a visible match overlay (vivid `::selection` +
  highlight layer), replace navigation, and a mobile-friendly find bar that
  overlays the editor instead of reflowing it (rc.39–rc.48).
- **Auto-update without re-downloads** (rc.49–rc.52): the service worker swaps
  in fresh web assets and the welcome dialog surfaces "A new version is ready";
  the desktop shell can OTA-swap the web layer with `sha256`-verified files via
  a `version.json` manifest.
- **Universal raw-file viewer** (rc.29–rc.31): open any file — valid UTF-8 is
  text, anything else shows as Latin-1 binary and round-trips byte-exact.
- **Glitch UI vocabulary** (rc.34, rc.39, rc.57): RGB-split accents, `steps()`
  keyframes, the welcome-icon "boot" and whole-card glitch, all gated behind
  `prefers-reduced-motion`.
- **Welcome dialog** (rc.1–rc.27): a first-visit, once-only menu with clickable
  shortcuts, an info popup, data-driven "Heads up" notices, and a version stamp.
- **Save behavior & tab title** (rc.20–rc.25): silent re-save through a real
  file handle on Chromium; accurate `<name> — DedTxt` / `• <name> •` titles.
- **Security & perf** passes (rc.32, rc.36): tightened CSP (dropped
  `unsafe-inline`), plus assorted fixes.
- macOS universal binary (rc.35); a long tail of mobile / iOS Safari fixes.

## [0.x] — foundations

- Rewrote the desktop shell from Electron to **Tauri 2** (a Rust main process).
- Dropped the Android / iOS / Capacitor scaffolding to focus on web + desktop.
- Established the platform-agnostic renderer with a `platform/{web,tauri}.js`
  split, the PWA (service worker + manifest), and `dedtxt.app` via GitHub Pages.

[1.0.0]: https://github.com/cportka/ded-txt/releases/tag/v1.0.0
[1.0.0-rc.60]: https://github.com/cportka/ded-txt/commits/main
[1.0.0-rc.59]: https://github.com/cportka/ded-txt/commits/main
[1.0.0-rc.58]: https://github.com/cportka/ded-txt/commits/main
[1.0.0-rc.57]: https://github.com/cportka/ded-txt/commits/main
