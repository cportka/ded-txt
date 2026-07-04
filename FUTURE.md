# Roadmap & future ideas

DedTxt stays *dead simple* — most "more of an editor" ideas are non-goals. This
is the roadmap toward a confident 1.0 and beyond, seeded by a full multi-lens
repo audit. Shipped work lives in [CHANGELOG.md](./CHANGELOG.md).

*(rc.61 promoted the old "Later / nice-to-have" list into the pre-1.0 scope and
shipped most of it: save/open error notices, `launchQueue` file handling, crash
/ draft recovery, the SHELL / build / CSS-parity test guards, the a11y pass,
find debouncing, the honest download-fallback dirty state, and manifest install
screenshots. What's below is what's left.)*

## Before 1.0.0

- **Cut the 1.0.0 release.** You can't be a confident 1.0 while every version
  file still reads `1.0.0-rc.N`. Decide a post-rc version policy for a
  continuously-deployed PWA (semver bumps on user-visible change? treat the build
  SHA as the real deploy id?), set all four version files to `1.0.0`, tag
  `v1.0.0`, and cut a source GitHub Release so the changelog can use real tags.
  From then on the repo follows the Portka standard's enforced SemVer
  (`tests/run-tests.sh`) with no rc exception. *(A product decision — yours to
  make.)*
- **Light/dark toggle.** Locked dark today. Deliberately deferred out of the
  rc.61 batch — needs a real design pass so the glitch palette (`--gx-*`) reads
  on a light ground, not just a variable swap.
- **Save-encoding choice.** UTF-8-only today (binary buffers round-trip
  Latin-1). A minimal encoding picker on save is the last "real editor" gap for
  files that must stay in a legacy encoding.
- **More sponsor options.** Venmo + ETH + BTC today; the GitHub Sponsor button
  is wired via `.github/FUNDING.yml`. Adding others needs account details only
  the owner can supply.

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

## Later / post-1.0 ideas

- **Draft recovery for huge buffers** — the localStorage stash caps at ~2 M
  chars (quota safety); an IndexedDB backend would cover the full 25 MB range.
- **Multi-tab draft isolation** — the stash is a single key; two dirty tabs
  overwrite each other's draft (last writer wins).
- **security.txt contact hardening** — points at GitHub advisories/issues
  today; a dedicated security contact address would be nicer.
