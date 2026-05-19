<p align="center">
  <img src="build/icon.svg" alt="DedTxt icon" width="160" />
</p>

# DedTxt

A dead simple plain-text editor.

> "because everything fucking sucked for this sort of thing" — cportka

A bit like TextEdit or Notepad, but even simpler and with fewer features.
No hidden text. No formatting. No settings to fiddle with. Just a textarea
and your file. Raw bytes in, raw bytes out — UTF-8 by default, no BOM, no
line-ending munging.

Two targets, same code:

- **Desktop** — macOS / Windows / Linux native via [Tauri 2](https://v2.tauri.app/) (~5–15 MB installers).
- **Web** at <https://dedtxt.app/> — the editor itself, installable as a PWA
  from any modern browser (including iOS and Android via "Add to Home Screen").

## Requirements

- **Node 20+** (see `.nvmrc`)
- **Rust** stable (`rustup install stable`) for desktop builds. Web-only
  development doesn't need Rust.

## Run from source

```sh
npm install
npm start                 # Tauri dev window (Rust toolchain required)
npm run serve:web         # Web build at http://127.0.0.1:5173
npm test                  # JS unit tests (node:test, zero deps)
```

Rust unit tests:

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

## Project structure

```
src/                      The app itself — shared by every platform
  index.html              Single textarea + first-visit welcome dialog
  renderer.js             Editor logic; talks only to platform/
  welcome.js              First-visit dialog (mobile detection, shortcut labels)
  platform/
    index.js              Detects runtime, picks an implementation
    tauri.js              Bridges to Rust via window.__TAURI__ globals
    web.js                File System Access API + download fallback
  sw.js                   Service worker for offline web
  manifest.webmanifest    PWA manifest
src-tauri/                Rust crate — the desktop "main process"
  Cargo.toml              Crate manifest
  tauri.conf.json         Window + bundle config
  src/lib.rs              Menus, dialogs, file I/O, OS events (+ unit tests)
  icons/                  Generated platform icons (32x32.png, icon.icns, etc.)
build/                    Icon source (icon.svg) + master icon outputs
scripts/                  Build scripts (web, icons)
test/                     JS unit tests (node:test)
CNAME                     dedtxt.app custom-domain claim for gh-pages
```

The renderer is platform-agnostic: it imports `platform/index.js`, which
returns one of two modules with the same interface (`tauri.js` for the
desktop app, `web.js` for the PWA). Adding a new platform means writing a
new module and teaching `platform/index.js` how to detect it.

## Build desktop installers

Each OS builds its own installers locally (Tauri uses the host platform's
build tooling — codesign, nsis, dpkg, etc.):

```sh
npm run build:mac         # .dmg + .app.tar.gz (host arch)
npm run build:win         # .msi + NSIS .exe
npm run build:linux       # AppImage + .deb + .rpm
```

Outputs go to `src-tauri/target/release/bundle/`. For full cross-platform
builds, push a `v*` tag (or trigger the workflow manually) — the GitHub
Actions workflow builds all three on the matching runner OS and attaches
them to a Release.

## Build the web app

```sh
npm run build:web         # produces dist-web/
npm run serve:web         # serve dist-web/ at http://127.0.0.1:5173
```

`dist-web/` is a static site — drop it on any web host. The editor lives at
the root; `dist-web/app/` is a single-page redirect kept around for the
legacy `dedtxt.app/app/` bookmark.

Pushes to `main` redeploy the site to the `gh-pages` branch automatically
via GitHub Actions; the site lives at <https://dedtxt.app/>.

## Icon

The app icon lives at `build/icon.svg`. Edit it, then run:

```sh
npm run gen:icons         # regenerates Tauri, PWA, and macOS/Windows icon sets
```

## Keys

| Action     | macOS              | Win/Linux         |
| ---------- | ------------------ | ----------------- |
| New        | `Cmd + N`          | `Ctrl + N`        |
| Open       | `Cmd + O`          | `Ctrl + O`        |
| Save       | `Cmd + S`          | `Ctrl + S`        |
| Save As    | `Cmd + Shift + S`  | `Ctrl + Shift + S`|
| Close      | `Cmd + W`          | `Ctrl + W`        |
| Quit       | `Cmd + Q`          | `Alt + F4`        |

Drop a file onto the window to open it. The OS "Open with…" menu lists
DedTxt for txt/md/log/json/csv/ini/yml/yaml/xml.

## License

ISC. See [LICENSE](./LICENSE).
