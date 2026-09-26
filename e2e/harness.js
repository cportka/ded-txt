'use strict';
// Shared plumbing for the browser end-to-end suites (e2e/*.e2e.js).
//
// These drive the REAL built bundle (dist-web/) in headless Chromium via
// playwright-core — a zero-dependency devDependency that downloads no
// browsers. They live outside test/ on purpose: `npm test` stays a fast,
// browser-free unit run, and `npm run test:e2e` is its own CI step.
//
// Browser resolution: $CHROME_PATH, else the first known Chromium/Chrome on
// disk (the sandbox's /opt/pw-browsers build, or the Google Chrome that
// GitHub's ubuntu runners ship), else Playwright's installed-Chrome channel.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const DIST = path.join(__dirname, '..', 'dist-web');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.xml': 'application/xml'
};

function assertBuilt() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('dist-web/ is missing — run `npm run build:web` before `npm run test:e2e`.');
  }
}

// Static server over a directory. `getRoot` is read per request so a test can
// swap the served tree mid-session (simulating a deploy). no-store so every
// navigation genuinely re-fetches sw.js / index.html.
function serve(getRoot = () => DIST) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const root = getRoot();
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(root, p);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => {
      srv.base = `http://127.0.0.1:${srv.address().port}/`;
      resolve(srv);
    });
  });
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    '/opt/pw-browsers/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function launch() {
  const executablePath = chromePath();
  return executablePath
    ? chromium.launch({ executablePath })
    : chromium.launch({ channel: 'chrome' });
}

// An iPhone-ish context: touch-only media features (any-hover: none,
// pointer: coarse) + an iOS Safari UA. `noFsa` removes the File System Access
// API, since no iOS browser has it.
function phoneContext(browser, { width = 390, height = 844, noFsa = true, ...extra } = {}) {
  return browser.newContext({
    ...extra,
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
      + '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  }).then(async (ctx) => {
    if (noFsa) {
      await ctx.addInitScript(() => {
        delete window.showOpenFilePicker;
        delete window.showSaveFilePicker;
      });
    }
    return ctx;
  });
}

// Optional debugging aid: E2E_SHOTS=<dir> saves a screenshot per call.
async function shot(page, name) {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

module.exports = { DIST, assertBuilt, serve, launch, phoneContext, shot };
