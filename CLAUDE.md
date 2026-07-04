# dedtxt — working agreements & handoff

Dead-simple, **dependency-free** plain-text editor: vanilla HTML/CSS/ES modules,
no framework, no build step for the app itself. The shipping target is the
installable **web PWA** at <https://dedtxt.app/> (GitHub Pages). A **Tauri 2
desktop** app shares the same `src/`, but its installer builds are **paused**
since rc.59 — the Rust code + tests are kept green in CI (`desktop-check`) so it
can be revived (see [FUTURE.md](./FUTURE.md)). Tests run on Node's built-in test
runner (zero deps).

## Architecture (read this first)
- `src/renderer.js` — the one DOM/editor controller. Platform-agnostic: it
  imports `platform/index.js` and talks only to what that returns.
- `src/platform/index.js` — runtime detection; returns `web.js` in a browser,
  `tauri.js` in the desktop shell (detects `window.__TAURI_INTERNALS__`).
- `src/platform/web.js` — File System Access API + download fallback. Holds
  module-scoped state (currentHandle / currentName / dirty). **Thoroughly
  tested** in `test/web-platform.test.js` (byte round-trips incl. emoji / ZWJ /
  NUL / RTL).
- `src/platform/tauri.js` — thin bridge to Rust `invoke()` commands + `dt://`
  events via `window.__TAURI__`.
- `src/welcome.js` — first-visit dialog + data-driven "Heads up" notices (tested).
- `src/notice.js` — glitch-styled toast notices (save/open failures, draft
  restore offer) rendered into the static `#notice-region` aria-live region.
- `src/drafts.js` — crash/draft recovery: debounced localStorage stash of the
  dirty buffer + boot-time Restore/Discard offer (pure helpers tested).
- `src/find.js` — find/replace; pure helpers exported + well tested, DOM wiring
  lightly tested.
- `src/line-numbers.js`, `src/scroll-arrows.js` — gutter + floating arrows (pure
  helpers tested).
- `src/pwa-install.js` — "Install as web app" button (tested).
- `src/sw.js` — service worker (offline precache). `src/update.js` — version
  classifier for the **desktop** OTA only (web updates use the SW lifecycle).
- `src-tauri/` — Rust crate: native menus, dialogs, file I/O, custom OTA.
- `scripts/build-web.js` — web bundle + `version.json` manifest + stamps the real
  version into the welcome dialog. `scripts/build-icons.js` — icons + og-image.

### The platform contract
`renderer.js` calls exactly these on the platform object, so **both `web.js` and
`tauri.js` must implement every one** — keep them in lockstep:
`setDirty`, `saveFile(content, isBinary)`, `openFile`, `newFile`, `onLoad`,
`onMenuNew`, `onMenuOpen`, `onMenuSave`, `onSaveAndClose`, `confirmClose`,
`openDroppedFile`, `name`, `checkUpdate`, `applyUpdate` (plus `setName`, defined
on both but currently unused).

## Invariants & gotchas (things that bite)
- **The service-worker `SHELL` (`sw.js`) must list every module statically
  imported from `renderer.js` / `index.html`.** A missing entry = blank app on
  an offline reload after an update (this shipped in rc.59 for
  `pwa-install.js`, fixed in rc.60). Add new modules here —
  `test/sw-shell.test.js` (rc.61) crawls the import graph and fails if you
  forget.
- **`web.js` module-scoped state must stay resettable** — `web-platform.test.js`
  cache-busts each import to reset it. Don't add un-resettable shared state.
- **Find highlights + line numbers depend on THREE elements sharing identical
  text-layout CSS**: `#text-editor`, `#editor-highlights-inner`, `#editor-mirror`
  (plus the 16px touch-viewport bump). Change font-size / line-height / padding /
  wrap on one → change all three, or marks and gutter numbers silently drift.
  Guarded by `test/css-parity.test.js` (rc.61).
- **All motion is gated behind `prefers-reduced-motion`** (project contract).
  New animated UI needs a matching reduced-motion rule.
- **Native-only save** (rc.58): no in-app filename prompt. Chromium = FSA silent
  re-save; Firefox/Safari = a download each save (it returns `{ok:true}` it can't
  actually verify — see FUTURE.md). Default name `untitled.txt`; a typed
  extension is honored.
- **Binary round-trip**: invalid-UTF-8 or NUL-containing files load as Latin-1
  one-char-per-byte (`isBinary`), and save re-encodes via `charCodeAt(i) & 0xff`.
- **Save/open errors are currently swallowed** by the renderer (no error UI) —
  the top FUTURE.md 1.0 item.

## Release / PR workflow (standing rules)
This repo follows the **Portka standard** (`.claude/CLAUDE.md`): update `main`
first, branch for everything, tests + CI then a PR, merge on green, hand back
the PR link. Repo-specific rules on top of it:
- **Bump the version on every PR**: `rc.N → rc.N+1` in lockstep across
  `src/version.js`, `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`.
- **Pre-1.0 SemVer exception**: the Portka standard's enforced SemVer applies,
  but until the 1.0.0 cut the version stays a `1.0.0-rc.N` prerelease (valid
  SemVer) — don't bump MAJOR/MINOR/PATCH before 1.0.0.
  `tests/run-tests.sh` + `tests/version-sync.test.mjs` enforce that
  `package.json` and `CHANGELOG.md` agree (CI runs both).
- **Add a `CHANGELOG.md` entry.**
- Before a PR: `npm test` (Node `--test`) and lint with the **pinned ESLint 8**:
  `npx --yes eslint@8.57.1 src/ test/ scripts/` (the repo `.eslintrc` can't be
  read by a globally-installed ESLint 9/10).
- Develop on the session's feature branch, not `main`.
- When approved/done: **merge to `main`** (pushing to `main` auto-deploys the PWA
  via GitHub Actions), delete the feature branch, and tell the user a deploy is on
  its way. If the branch delete is blocked (HTTP 403), say so and let them delete
  it from the PR.

## Desktop (paused)
CI `desktop-check` compiles the Rust crate + runs `cargo test` on every push, so
the target stays revivable. It does **not** build installers or run the
macOS/Windows release compiles. Reviving = code signing + un-gating the
`desktop`/`release` jobs (`if: ${{ false }}`) + restoring the `tags: ['v*']`
trigger. Full checklist in [FUTURE.md](./FUTURE.md).

## Aesthetic
"Glitch" vocabulary: RGB-split via `--gx-magenta` / `--gx-cyan` / `--gx-bone`,
`steps()`-timed keyframes, all gated behind `prefers-reduced-motion`. New animated
UI should match (see `find-bar-glitch-in/out`, `welcome-card-glitch-out`,
`arrow-glitch-in/out`, and the `menu-spin` reduced-motion gate in `styles.css`).

## Docs map
`README.md` (overview / build / keys), `CHANGELOG.md` (history — single source of
truth), `FUTURE.md` (1.0 roadmap), `CONTRIBUTING.md`, `PRIVACY.md`, `src/llms.txt`.
