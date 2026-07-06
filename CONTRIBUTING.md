# Contributing to dedtxt

Thanks for your interest! dedtxt is a dependency-free plain-text editor that
ships as a web PWA (<https://dedtxt.app/>) and — paused for now — a Tauri
desktop app. The guiding principle is **dead simple**: small, fast, no runtime
dependencies, no tracking. Features that add weight or complexity are usually
non-goals (see [FUTURE.md](./FUTURE.md)).

## Ways to help

- **Bugs:** open an issue with the *Bug report* template.
- **Ideas / features:** open an issue with the *Feature request* template.
- **Questions / show-and-tell:** GitHub Discussions (if enabled).
- **Code:** pull requests are welcome — see below.

## Dev setup

```sh
npm install
npm run serve:web    # http://127.0.0.1:5173
npm test             # node:test, zero deps
npm run lint         # pinned ESLint 8
```

The desktop (Tauri / Rust) target is optional and currently paused. If you do
work on it:

```sh
npm start                                          # Tauri dev window (needs Rust)
cargo test --manifest-path src-tauri/Cargo.toml    # Rust unit tests
```

## Before you open a PR

- `npm test` and `npm run lint` (`npx eslint@8.57.1 src/ test/ scripts/`) pass.
- **Bump the version** ([SemVer](https://semver.org): PATCH for fixes, MINOR
  for backward-compatible features, MAJOR for breaking changes) in lockstep
  across `src/version.js`, `package.json`, `src-tauri/tauri.conf.json`, and
  `src-tauri/Cargo.toml`. Releases are tagged `vX.Y.Z`.
- Add a short entry to [CHANGELOG.md](./CHANGELOG.md).
- Match the surrounding code: vanilla HTML / CSS / ES modules, no build step
  for the app itself, and the "glitch" UI vocabulary (RGB-split accents,
  `steps()` keyframes, all gated behind `prefers-reduced-motion`).
- Keep diffs focused, and **add no new runtime dependencies**.

## Code of conduct

Be kind and constructive. Harassment or abuse isn't welcome here.
