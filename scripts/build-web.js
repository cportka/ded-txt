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

// 1b. Stamp the real version into the welcome dialog's version span. renderer.js
// also sets it at runtime, but injecting it here means view-source, crawlers,
// and pre-hydration HTML show the shipped version instead of the v0.0.0
// placeholder (which reads as "unfinished" to exactly the people who peek).
const stampVersion = require('../package.json').version;
const indexPath = path.join(out, 'index.html');
fs.writeFileSync(
  indexPath,
  fs.readFileSync(indexPath, 'utf8').replace(
    /(<span id="welcome-version">)[^<]*(<\/span>)/,
    `$1v${stampVersion}$2`
  )
);

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

// 6b. SEO: robots.txt + a minimal sitemap so crawlers index the canonical URL.
fs.writeFileSync(
  path.join(out, 'robots.txt'),
  'User-agent: *\nAllow: /\n\nSitemap: https://dedtxt.app/sitemap.xml\n'
);
const lastmod = new Date().toISOString().slice(0, 10);
fs.writeFileSync(
  path.join(out, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  '  <url>\n' +
  '    <loc>https://dedtxt.app/</loc>\n' +
  `    <lastmod>${lastmod}</lastmod>\n` +
  '    <changefreq>monthly</changefreq>\n' +
  '    <priority>1.0</priority>\n' +
  '  </url>\n' +
  '</urlset>\n'
);

// 6c. RFC 9116 security contact at the standard /.well-known/security.txt
// path. GitHub Pages can't set response headers, but it serves static files
// fine. Expires is re-stamped one year out on every deploy, so the contact
// can never quietly go stale (an expired security.txt is worse than none).
const wellKnownDir = path.join(out, '.well-known');
fs.mkdirSync(wellKnownDir, { recursive: true });
const securityExpires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
fs.writeFileSync(
  path.join(wellKnownDir, 'security.txt'),
  'Contact: https://github.com/cportka/dedtxt/security/advisories/new\n' +
  'Contact: https://github.com/cportka/dedtxt/issues\n' +
  `Expires: ${securityExpires}\n` +
  'Preferred-Languages: en\n' +
  'Canonical: https://dedtxt.app/.well-known/security.txt\n'
);

// 7. Emit version.json — the update/OTA manifest. The desktop app fetches this
// to learn the latest web-layer version (the webview CSP blocks cross-origin
// fetches, so the native side does it); both desktop and web compare against it
// to decide whether to surface an "update available" notice. `files` is the
// superset of runtime assets (sw.js's SHELL is only the offline precache), each
// carrying a sha256 so an OTA download can be integrity-checked.
const pkg = require('../package.json');
// nativeMin: the lowest desktop *native shell* version that can run this web
// layer. Bump ONLY when the web layer starts depending on a new native (Rust)
// command — most releases leave it untouched so web updates hot-swap in place.
const NATIVE_MIN = '1.0.0-rc.49';
// Web-deploy-only artifacts the running app never loads — kept out of the manifest.
const MANIFEST_EXCLUDE = new Set(['404.html', 'CNAME', '.nojekyll', 'version.json', 'app/index.html', 'robots.txt', 'sitemap.xml', 'llms.txt', '.well-known/security.txt']);

function listFiles(dir, base = '') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...listFiles(path.join(dir, entry.name), rel));
    } else if (entry.isFile() && !MANIFEST_EXCLUDE.has(rel)) {
      found.push(rel);
    }
  }
  return found;
}

const manifest = {
  version: pkg.version,
  nativeMin: NATIVE_MIN,
  buildId,
  files: listFiles(out).sort().map((rel) => ({
    path: rel,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(out, rel))).digest('hex')
  }))
};
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`Built dist-web/  (editor at root, build ${buildId})`);
