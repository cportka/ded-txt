# Roadmap & future ideas

dedtxt stays *dead simple* — most "more of an editor" ideas are non-goals.
**1.0.0 shipped** (a launch-ready A/97 in independent review); this is the
roadmap beyond it. Shipped work lives in [CHANGELOG.md](./CHANGELOG.md).

Versioning follows SemVer with no exception now (see `CLAUDE.md`): PATCH for
fixes, MINOR for backward-compatible features, MAJOR for breaking changes, each
tagged `vX.Y.Z` with a GitHub Release.

## 1.1.0 — light/dark toggle (next)

The headline post-1.0 feature, deliberately held back from 1.0.0 so it gets a
real design pass rather than a naive variable swap:

- A light theme that the **glitch palette** (`--gx-magenta` / `--gx-cyan` /
  `--gx-bone` and the RGB-split accents) actually reads well on — the chromatic
  aberration and magenta bands are tuned for a near-black ground, so a light
  ground needs re-tuned accent values, not just flipped `--bg` / `--fg`.
- A toggle control (welcome dialog or a corner affordance) plus a
  `prefers-color-scheme` default and a persisted `localStorage` choice
  (document the new key in `PRIVACY.md`, alongside `dedtxt-welcomed` /
  `dedtxt-draft`).
- Keep every existing invariant: all motion stays `prefers-reduced-motion`
  gated; the three text-layout layers stay in parity; contrast stays WCAG AA in
  both themes (the `test/css-parity.test.js` guard already helps here).

## Later / nice-to-have

- **Save-encoding choice.** UTF-8-only today (binary buffers round-trip
  Latin-1). A minimal encoding picker on save is the last "real editor" gap for
  files that must stay in a legacy encoding. (Candidate for a 1.x MINOR.)
- **A dedicated `security.txt` contact address** (a real inbox, not the GitHub
  advisories/issues links) — needs an address only the owner can provide.
- **Richer JSON-LD** (`FAQPage` / `HowTo`) for AEO — marginal for a single-page
  utility; the `WebApplication` + `featureList` block already covers the basics.

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
