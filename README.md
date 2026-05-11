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

Same code, every platform: macOS, Windows, Linux desktop apps; a PWA you
can install from any browser; iOS and Android apps via Capacitor.

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
    capacitor.js          @capacitor/filesystem on iOS/Android
  sw.js                   Service worker for offline web
  manifest.webmanifest    PWA manifest
landing/                  Marketing/download page served at the root
android/                  Capacitor project (committed)
ios/                      Capacitor project (generated on demand — needs macOS)
build/                    Icon source + electron-builder resources
scripts/                  Build scripts (web, mobile, icons)
```

The renderer is platform-agnostic: it imports `platform/index.js`, which
returns one of three modules with the same interface. Adding a new
platform means writing a new module and teaching `platform/index.js` how
to detect it.

## Build desktop installers

```sh
npm run build:mac         # .dmg + .zip (x64 + arm64)
npm run build:win         # NSIS installer + portable .exe
npm run build:linux       # AppImage + .deb + .rpm
```

Outputs go to `dist/`. Each OS must build its own installers locally,
except Linux, which can also be built from macOS. For full cross-platform
builds, push to `main` or open a PR — the GitHub Actions workflow handles
all three.

## Build the web app

```sh
npm run build:web         # produces dist-web/
npm run serve:web         # serve dist-web/ at http://127.0.0.1:5173
```

`dist-web/` is a static site — drop it on any web host. Layout:

- `dist-web/`       — the landing page with auto-detected download buttons
- `dist-web/app/`   — the PWA editor itself

Pushes to `main` redeploy the site to the `gh-pages` branch automatically
via GitHub Actions; the site lives at `https://cportka.github.io/dedtxt/`.

## Build the mobile apps

iOS and Android use [Capacitor](https://capacitorjs.com) to wrap the web
build. The `android/` project is committed. The `ios/` project is
generated on demand because scaffolding it requires macOS.

```sh
# one-time per checkout, macOS only
npm run cap:add:ios

# then, per build
npm run build:android     # produces dist-mobile/DedTxt-debug.apk
npm run build:ios         # macOS only — produces dist-mobile/ios/App.app for the simulator
```

For local development, open the native projects in their IDEs:

```sh
npm run cap:open:ios      # opens Xcode
npm run cap:open:android  # opens Android Studio
```

CI builds an unsigned `app-debug.apk` and a simulator-only iOS `.app` on
every push so you can sideload to test.

## Icon

The app icon lives at `build/icon.svg`. Edit it, then run:

```sh
npm run gen:icons
```

That regenerates the `.icns`, `.ico`, `.png`, and PWA icon set from the
SVG. The desktop and web build scripts run this automatically; you only
need to invoke it manually if you want to inspect the output without a
full build.

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
