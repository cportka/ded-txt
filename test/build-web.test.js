'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Smoke test for scripts/build-web.js — the script that assembles the actual
// dedtxt.app deploy. It had no guard at all (a FUTURE.md hardening item):
// a silent regression here ships a broken PWA even with every unit test
// green. Runs the real build into dist-web/ (gitignored) and asserts the
// deploy-critical invariants of the output.

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist-web');
const pkg = require('../package.json');

function read(rel) {
  return fs.readFileSync(path.join(out, rel), 'utf8');
}

describe('scripts/build-web.js output (smoke)', () => {
  before(() => {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'build-web.js')], {
      cwd: root,
      stdio: 'pipe'
    });
  });

  test('app shell files land at the root', () => {
    for (const f of ['index.html', 'styles.css', 'renderer.js', 'sw.js',
      'manifest.webmanifest', 'platform/web.js', 'notice.js', 'drafts.js']) {
      assert.ok(fs.existsSync(path.join(out, f)), `dist-web/${f} missing`);
    }
  });

  test('service worker got a real build id (cache busting)', () => {
    const sw = read('sw.js');
    assert.ok(!sw.includes('__BUILD_ID__'), 'BUILD_ID placeholder was not replaced');
    assert.match(sw, /const VERSION = '[0-9a-f]{12}'/);
  });

  test('the welcome dialog version span is stamped with the real version', () => {
    assert.ok(
      read('index.html').includes(`<span id="welcome-version">v${pkg.version}</span>`),
      'index.html still shows the v0.0.0 placeholder'
    );
  });

  test('SEO/crawl files: robots.txt points at the sitemap; both exist', () => {
    const robots = read('robots.txt');
    assert.match(robots, /Sitemap: https:\/\/dedtxt\.app\/sitemap\.xml/);
    assert.match(read('sitemap.xml'), /<loc>https:\/\/dedtxt\.app\/<\/loc>/);
  });

  test('security.txt exists with a future Expires (RFC 9116)', () => {
    const sec = read('.well-known/security.txt');
    assert.match(sec, /^Contact: /m);
    const expires = sec.match(/^Expires: (.+)$/m);
    assert.ok(expires, 'security.txt must carry an Expires line');
    assert.ok(new Date(expires[1]).getTime() > Date.now(), 'Expires must be in the future');
  });

  test('GitHub Pages plumbing: 404 fallback, CNAME, .nojekyll, legacy /app redirect', () => {
    assert.equal(read('404.html'), read('index.html'), '404.html must serve the editor');
    assert.ok(fs.existsSync(path.join(out, '.nojekyll')));
    assert.equal(read('CNAME').trim(), 'dedtxt.app');
    assert.match(read('app/index.html'), /url=\//);
  });

  test('version.json manifest matches package.json and hashes every runtime file', () => {
    const manifest = JSON.parse(read('version.json'));
    assert.equal(manifest.version, pkg.version);
    assert.match(manifest.buildId, /^[0-9a-f]{12}$/);
    assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
    for (const f of manifest.files) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/, `${f.path} needs a sha256`);
    }
    const listed = new Set(manifest.files.map((f) => f.path));
    assert.ok(listed.has('renderer.js'), 'runtime files must be listed');
    // Deploy-only artifacts stay out of the OTA manifest.
    for (const excluded of ['404.html', 'CNAME', 'version.json', 'robots.txt', '.well-known/security.txt']) {
      assert.ok(!listed.has(excluded), `${excluded} must not be in the OTA manifest`);
    }
  });

  test('every sw.js SHELL entry exists in the built output', () => {
    // The install-time cache.addAll is atomic — one 404 kills offline support.
    const m = read('sw.js').match(/const SHELL = \[([\s\S]*?)\];/);
    assert.ok(m);
    for (const [, entry] of m[1].matchAll(/'([^']+)'/g)) {
      if (entry === './') continue;
      assert.ok(
        fs.existsSync(path.join(out, entry.replace(/^\.\//, ''))),
        `SHELL entry ${entry} missing from dist-web/`
      );
    }
  });
});
