# Future ideas

A deliberately short list. DedTxt is meant to stay *dead simple* — most things
that would make it "more of an editor" are non-goals. These are the few ideas
worth keeping on the radar. Shipped work lives in [CHANGELOG.md](./CHANGELOG.md).

- **Revive native desktop builds.** Signed / notarized installers for macOS,
  Windows, and Linux — and possibly more (ARM Linux, the *BSDs) — via Tauri.
  The code, Rust tests, and a gated-off CI job are already in place; reviving it
  is mostly signing, release plumbing, and distribution. Paused for now in
  favor of the PWA.
- **Crash / draft recovery.** Periodically stash the buffer to `localStorage`
  so an accidental close or reload can offer to restore unsaved text.
- **Light / dark toggle.** Currently locked to the dark glitch theme; an
  explicit toggle (still defaulting to the system preference) is a nicety.
- **Save-encoding choice.** Always UTF-8 (no BOM) today; an opt-in for other
  encodings / line-endings could help interop without cluttering the default.
- **More sponsor / donation options.** A tidy sponsor page beyond the current
  Venmo + ETH + BTC (the GitHub Sponsor button is wired via `.github/FUNDING.yml`).
