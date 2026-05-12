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

Three targets, same code: macOS / Windows / Linux desktop via Electron, and
a PWA at <https://cportka.github.io/dedtxt/> that installs from any modern
browser (including iOS and Android via "Add to Home Screen").

## Run from source

Requires Node 20+.

```sh
npm install
npm start                 # Electron desktop
npm run serve:web         # Web build at http://127.0.0.1:5173
```

## Project structure

```
main.js, preload.js       Electron main + preload
src/                      The app itself — shared by every platform
  index.html              Single textarea, no chrome
  renderer.js             Editor logic; talks only to platform/
  platform/
    index.js              Detects runtime, picks an implementation
    electron.js           IPC to main.js via window.dt
    web.js                File System Access API + download fallback
  sw.js                   Service worker for offline web
  manifest.webmanifest    PWA manifest
landing/                  Marketing/download page served at the root
build/                    Icon source + electron-builder resources
scripts/                  Build scripts (web, icons, social preview)
```

The renderer is platform-agnostic: it imports `platform/index.js`, which
returns one of two modules with the same interface. Adding a new platform
means writing a new module and teaching `platform/index.js` how to detect
it.

## Build desktop installers

```sh
npm run build:mac         # .dmg + .zip (x64 + arm64)
npm run build:win         # NSIS installer + portable .exe
npm run build:linux       # AppImage + .deb + .rpm
```

Outputs go to `dist/`. Each OS must build its own installers locally,
except Linux, which can also be built from macOS. For full cross-platform
builds, push a `v*` tag (or trigger the workflow manually) — the GitHub
Actions workflow builds all three and attaches them to a Release.

## Build the web app

```sh
npm run build:web         # produces dist-web/
npm run serve:web         # serve dist-web/ at http://127.0.0.1:5173
```

`dist-web/` is a static site — drop it on any web host. Layout:

- `dist-web/`       — the landing page with auto-detected download buttons
- `dist-web/app/`   — the PWA editor itself

Pushes to `main` redeploy the site to the `gh-pages` branch automatically
via GitHub Actions; the site lives at <https://cportka.github.io/dedtxt/>.

## Icon

The app icon lives at `build/icon.svg`. Edit it, then run:

```sh
npm run gen:icons         # regenerates .png, .icns, .ico, and PWA icons
npm run gen:social        # regenerates build/social-preview.png
```

## Keys

| Action     | macOS              | Win/Linux         |
| ---------- | ------------------ | ----------------- |
| New        | `Cmd + N`          | `Ctrl + N`        |
| Open       | `Cmd + O`          | `Ctrl + O`        |
| Save       | `Cmd + S`          | `Ctrl + S`        |
| Save As    | `Cmd + Shift + S`  | `Ctrl + Shift + S`|
| Close      | `Cmd + W`          | `Ctrl + W`        |
| Quit       | `Cmd + Q`          | `Ctrl + Q`        |

Drop a file onto the window to open it. The OS "Open with…" menu lists
DedTxt for txt/md/log/json/csv/ini/yml/yaml/xml.

## License

ISC. See [LICENSE](./LICENSE).
