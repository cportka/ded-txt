#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const out = path.join(root, 'dist-web');

const buildId = process.env.GITHUB_SHA
  ? process.env.GITHUB_SHA.slice(0, 12)
  : crypto.randomBytes(6).toString('hex');

function rmRf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(a, b);
    } else if (entry.isFile()) {
      fs.copyFileSync(a, b);
    }
  }
}

rmRf(out);

// 1. Editor lives at root — dedtxt.app/ IS the app.
copyTree(src, out);

// 2. CNAME owns the custom domain on every gh-pages deploy.
const cnameSrc = path.join(root, 'CNAME');
if (fs.existsSync(cnameSrc)) {
  fs.copyFileSync(cnameSrc, path.join(out, 'CNAME'));
}

// 3. Stamp the service worker with the build ID for cache busting.
const swPath = path.join(out, 'sw.js');
if (fs.existsSync(swPath)) {
  const sw = fs.readFileSync(swPath, 'utf8').replace(/__BUILD_ID__/g, buildId);
  fs.writeFileSync(swPath, sw);
}

// 4. Legacy bookmark redirect: dedtxt.app/app/ → dedtxt.app/
const legacyAppDir = path.join(out, 'app');
fs.mkdirSync(legacyAppDir, { recursive: true });
fs.writeFileSync(
  path.join(legacyAppDir, 'index.html'),
  '<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/"><title>DedTxt</title><a href="/">DedTxt</a>\n'
);

// 5. GitHub Pages fallback for unknown routes — serve the editor.
fs.copyFileSync(path.join(out, 'index.html'), path.join(out, '404.html'));

// 6. Disable Jekyll so files starting with _ are served verbatim.
fs.writeFileSync(path.join(out, '.nojekyll'), '');

console.log(`Built dist-web/  (editor at root, build ${buildId})`);
