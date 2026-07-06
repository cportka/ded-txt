<!-- BEGIN portka-standard (managed by repo-bootstrap — edit between the markers, or re-run to refresh) -->
# Portka standard workflow

Standing conventions for how Claude Code works here. Follow them for every change, without being
asked, so our back-and-forth stays on the code — not on process.

For each change you make:

1. **Update `main` first.** Begin by switching to `main` and pulling the latest. A previous
   change's branch being gone is the user's confirmation that they saw it (see step 5).
2. **Branch for everything.** Every fix, update, or change goes on a new branch — never commit to
   `main` directly.
3. **Tests + CI, then a PR.** Update the relevant tests, keep CI running them, and open a pull
   request. If the repo has no CI yet, add a basic workflow that runs the test suite.
4. **Green, then merge.** Wait until every check passes, then merge the PR automatically. Never
   merge on red.
5. **Hand back a short PR link.** Give the user a short link to the merged PR as confirmation. They
   delete the branch when satisfied — which you pick up next time you update `main` (step 1).

## Versioning — SemVer (enforced)

Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH` — **MAJOR** for
breaking changes, **MINOR** for backward-compatible features, **PATCH** for backward-compatible
fixes. Keep one source of truth and the other places in agreement, and bump the right part:

- the **version source of truth** — your project manifest (`package.json` / `pyproject.toml` /
  `Cargo.toml`), or a bare `VERSION` file if the repo has no manifest.
- `CHANGELOG.md` — a section for each released version (Keep a Changelog).
- `README.md` — a `**Version:**` line, if you keep one, that matches.

`tests/run-tests.sh` checks the version is valid SemVer and that these agree; CI runs it on every
push/PR, so they can't drift.
<!-- END portka-standard -->

## dedtxt versioning (1.0.0 shipped — rc exception retired)

The pre-1.0 `1.0.0-rc.N` prerelease exception is **over**: 1.0.0 shipped, so the
Portka standard's SemVer now applies in full — PATCH for backward-compatible
fixes, MINOR for backward-compatible features (light/dark toggle → 1.1.0),
MAJOR for breaking changes, bumped in lockstep across `src/version.js`,
`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, with a
`vX.Y.Z` tag + GitHub Release per version. See `CLAUDE.md` (repo root) for the
full release rules.
