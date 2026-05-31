# dedtxt — working agreements

Dependency-free plain-text editor (vanilla HTML/CSS/ES modules) shipped as a web PWA
(GitHub Pages) and a Tauri desktop app. Tests run on Node's built-in test runner.

## Release / PR workflow (standing rules)
- **Bump the version on every PR.** Increment `rc.N → rc.N+1` (e.g. `1.0.0-rc.45`) in all four
  places, kept in lockstep:
  - `src/version.js` (`VERSION` — shown in the welcome dialog)
  - `package.json` (`version`)
  - `src-tauri/tauri.conf.json` (`version`)
  - `src-tauri/Cargo.toml` (`version`)
- **When work is approved/done: merge to `main`, delete the feature branch, and tell the user a new
  deployment is on its way.** (Pushing to `main` triggers the Pages deploy.) If the environment
  blocks the branch delete (HTTP 403), say so and let the user delete it from the PR.

## Checks before a PR
- `npm test` (Node `--test`).
- Lint with the pinned ESLint 8: `npx --yes eslint@8.57.1 src/ test/` (the repo's `.eslintrc`
  can't be read by a globally-installed ESLint 9/10).

## Aesthetic
The UI uses a "glitch" vocabulary: RGB-split via `--gx-magenta` / `--gx-cyan` / `--gx-bone`,
`steps()`-timed keyframes, all gated behind `prefers-reduced-motion`. New animated UI should match
(see `find-bar-glitch-in/out`, `welcome-card-glitch-out`, `arrow-glitch-in/out` in `styles.css`).
