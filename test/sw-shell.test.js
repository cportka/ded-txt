'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// SHELL-completeness guard for the service worker's offline precache.
//
// sw.js's SHELL list is hand-maintained: every module the app STATICALLY
// imports must be listed, or an offline reload right after an update boots
// to a blank app (this shipped in rc.59 when pwa-install.js was added but
// not precached — the exact regression this test exists to prevent).
//
// The import graph is crawled from renderer.js (the single entry module in
// index.html). Dynamic imports — `import('./tauri.js')` in platform/index.js
// — are deliberately excluded: they only run in the Tauri shell, which never
// uses the service worker.

const SRC = path.join(__dirname, '..', 'src');

function readSrc(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

// Extract the SHELL array entries from sw.js (a worker script — it can't be
// imported into Node, so parse the source text).
function shellEntries() {
  const sw = readSrc('sw.js');
  const m = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(m, 'sw.js must declare a `const SHELL = [...]` precache list');
  const entries = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(entries.length > 0, 'SHELL must not be empty');
  return entries;
}

// Static imports only: `import X from '...'` / `import { a } from '...'` /
// `import '...'` (side-effect) — including multi-line binding lists.
// Dynamic `import('...')` has no whitespace after the keyword, so the \s+
// in the pattern excludes it by construction. The binding part is matched
// with [^;'"] (never crossing a quote or statement end): a greedy
// [\s\S]*?from would swallow a side-effect import whole by hunting for the
// NEXT statement's `from`, silently dropping it from the crawl.
function staticImports(source) {
  const out = [];
  const re = /(?:^|\n)\s*import\s+(?:[^;'"]+?from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  return out;
}

// Crawl the static import graph from an entry module. Returns src-relative
// POSIX paths ('renderer.js', 'platform/web.js', ...).
function crawl(entryRel) {
  const seen = new Set();
  const queue = [entryRel];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const dir = path.posix.dirname(rel);
    for (const spec of staticImports(readSrc(rel))) {
      const resolved = path.posix.normalize(path.posix.join(dir, spec));
      queue.push(resolved);
    }
  }
  return [...seen];
}

describe('staticImports() self-test (the crawler must see every import form)', () => {
  test('named, default, side-effect and multi-line imports are all captured', () => {
    const src = [
      "import './side-effect.js';",
      "import def from './default.js';",
      "import { a, b } from './named.js';",
      "import {\n  c,\n  d,\n} from './multiline.js';",
      "const lazy = await import('./dynamic.js');"
    ].join('\n');
    assert.deepEqual(staticImports(src), [
      './side-effect.js', './default.js', './named.js', './multiline.js'
    ]);
  });
});

describe('sw.js SHELL completeness', () => {
  test('every statically-imported module is precached', () => {
    const shell = new Set(shellEntries());
    for (const rel of crawl('renderer.js')) {
      assert.ok(
        shell.has(`./${rel}`),
        `sw.js SHELL is missing './${rel}' — a module statically imported from renderer.js. ` +
        'Without it, an offline reload after an update boots to a blank app (see rc.59).'
      );
    }
  });

  test('the core shell assets are precached', () => {
    const shell = new Set(shellEntries());
    for (const asset of ['./', './index.html', './styles.css', './manifest.webmanifest']) {
      assert.ok(shell.has(asset), `SHELL is missing core asset '${asset}'`);
    }
  });

  test('every SHELL file exists in src/ (a typo breaks the whole install)', () => {
    // cache.addAll is atomic: one 404 rejects the install and the app never
    // gets offline support — so a renamed/deleted file must fail loudly here.
    for (const entry of shellEntries()) {
      if (entry === './') continue;
      const rel = entry.replace(/^\.\//, '');
      assert.ok(
        fs.existsSync(path.join(SRC, rel)),
        `SHELL entry '${entry}' does not exist in src/`
      );
    }
  });

  test('dynamic-only modules stay OUT of the precache', () => {
    // tauri.js is desktop-only (dynamic import); precaching it would waste
    // every web user's storage on a module the web build can never run.
    const shell = new Set(shellEntries());
    assert.ok(!shell.has('./platform/tauri.js'),
      'platform/tauri.js is dynamically imported for the desktop shell only — do not precache it');
  });
});
