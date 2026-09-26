'use strict';
// Behavioural end-to-end checks on the real bundle: the user-facing flows
// whose regressions unit tests can't see (they span DOM, timers, storage and
// the service worker). Each test gets a fresh browser context, so storage
// and SW state never leak between them.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DIST, assertBuilt, serve, launch, phoneContext } = require('./harness');

let srv;
let browser;
let root = DIST;
before(async () => {
  assertBuilt();
  srv = await serve(() => root);
  browser = await launch();
});
after(async () => {
  if (browser) await browser.close();
  if (srv) srv.close();
});

// Desktop page with optional localStorage seed + init script.
async function open({ storage = {}, init, viewport = { width: 1280, height: 800 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, storage);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.goto(srv.base, { waitUntil: 'networkidle' });
  return { ctx, page };
}

const WELCOMED = { 'dedtxt-welcomed': 'true' };
const draft = (content, extra = {}) => JSON.stringify({ content, savedAt: Date.now() - 5 * 60000, ...extra });
const storedDraft = (page) => page.evaluate(() => {
  const raw = localStorage.getItem('dedtxt-draft');
  return raw ? JSON.parse(raw).content : null;
});

describe('first run + title', () => {
  test('clean "dedtxt" title; welcome auto-opens once; ✕ closes it', async () => {
    const { ctx, page } = await open();
    try {
      assert.equal(await page.title(), 'dedtxt');
      await page.waitForFunction(() => document.getElementById('welcome-dialog').open);
      await page.locator('#welcome-close').click();
      await page.waitForFunction(() => !document.getElementById('welcome-dialog').open);
    } finally { await ctx.close(); }
  });
});

describe('save / open error notices', () => {
  test('a failing Ctrl+S surfaces an error notice and keeps the buffer dirty', async () => {
    const { ctx, page } = await open({
      storage: WELCOMED,
      init: () => {
        window.showOpenFilePicker = async () => { throw new Error('unused'); };
        window.showSaveFilePicker = async () => { throw new Error('Disk full'); };
      }
    });
    try {
      await page.locator('#text-editor').click();
      await page.keyboard.type('unsaved text');
      await page.keyboard.press('Control+s');
      const notice = page.locator('#notice-region .notice-error');
      await notice.waitFor();
      assert.match(await notice.textContent(), /Save failed — Disk full/);
      assert.ok(await page.evaluate(() => window.onbeforeunload !== null), 'still guarded as dirty');
      await page.locator('.notice-dismiss').click();
      await page.waitForFunction(() => !document.querySelector('#notice-region .notice'));
    } finally { await ctx.close(); }
  });

  test('a download-fallback save is "unconfirmed": no error, still dirty', async () => {
    const { ctx, page } = await open({
      storage: WELCOMED,
      init: () => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; }
    });
    try {
      await page.locator('#text-editor').click();
      await page.keyboard.type('saved via download');
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.notice-error').count(), 0);
      assert.ok(await page.evaluate(() => window.onbeforeunload !== null));
    } finally { await ctx.close(); }
  });
});

describe('draft recovery', () => {
  test('Restore fills the editor, marks it dirty, and re-stashes new edits', async () => {
    const { ctx, page } = await open({
      storage: { ...WELCOMED, 'dedtxt-draft': draft('draft one\ndraft two', { name: 'notes.txt' }) }
    });
    try {
      const offer = page.locator('#notice-region .notice');
      await offer.waitFor();
      assert.match(await offer.textContent(), /Recovered “notes\.txt” from 5 minutes ago/);
      await page.locator('.notice-action', { hasText: 'Restore' }).click();
      assert.equal(await page.locator('#text-editor').inputValue(), 'draft one\ndraft two');
      assert.equal(await page.title(), '• notes.txt • — dedtxt');
      await page.locator('#text-editor').press('End');
      await page.keyboard.type(' +more');
      await page.waitForFunction(() => /\+more/.test(localStorage.getItem('dedtxt-draft') || ''), null, { timeout: 4000 });
    } finally { await ctx.close(); }
  });

  test('declining Restore\'s confirm keeps the offer AND the stored draft', async () => {
    const { ctx, page } = await open({ storage: { ...WELCOMED, 'dedtxt-draft': draft('precious draft') } });
    try {
      page.on('dialog', (d) => d.dismiss());
      await page.locator('#notice-region .notice').waitFor();
      await page.locator('#text-editor').click();
      await page.keyboard.type('interim notes');
      await page.locator('.notice-action', { hasText: 'Restore' }).click();
      assert.equal(await page.locator('#notice-region .notice').count(), 1, 'offer still up');
      await page.keyboard.type(' more');
      await page.waitForTimeout(2000); // past the 1.5s stash debounce
      assert.equal(await storedDraft(page), 'precious draft');
    } finally { await ctx.close(); }
  });

  test('✕ on the offer resumes stashing so new work is protected', async () => {
    const { ctx, page } = await open({ storage: { ...WELCOMED, 'dedtxt-draft': draft('old draft') } });
    try {
      await page.locator('#notice-region .notice').waitFor();
      await page.locator('.notice-dismiss').click();
      await page.locator('#text-editor').click();
      await page.keyboard.type('fresh work');
      await page.waitForFunction(() => /fresh work/.test(localStorage.getItem('dedtxt-draft') || ''), null, { timeout: 4000 });
    } finally { await ctx.close(); }
  });

  test('Discard clears the stored draft', async () => {
    const { ctx, page } = await open({ storage: { ...WELCOMED, 'dedtxt-draft': draft('throw away') } });
    try {
      await page.locator('#notice-region .notice').waitFor();
      await page.locator('.notice-action', { hasText: 'Discard' }).click();
      assert.equal(await storedDraft(page), null);
    } finally { await ctx.close(); }
  });
});

describe('keyboard: Escape, Find and the info popup', () => {
  test('Esc closes Find (field or button focus) without opening Welcome; else toggles Welcome', async () => {
    const { ctx, page } = await open({ storage: WELCOMED });
    const isHidden = () => page.locator('#find-bar').evaluate((b) => b.hidden);
    const welcomeOpen = () => page.locator('#welcome-dialog').evaluate((d) => d.open);
    try {
      await page.locator('#text-editor').click();
      await page.keyboard.press('Control+f');
      await page.waitForFunction(() => !document.getElementById('find-bar').hidden);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('find-bar').hidden);
      assert.equal(await welcomeOpen(), false, 'input focus: no welcome');

      await page.keyboard.press('Control+f');
      await page.waitForFunction(() => !document.getElementById('find-bar').hidden);
      await page.locator('#find-next').focus();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('find-bar').hidden);
      assert.equal(await isHidden(), true);
      assert.equal(await welcomeOpen(), false, 'button focus: no welcome');

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('welcome-dialog').open);
    } finally { await ctx.close(); }
  });

  test('info popup: focus moves in, Tab/Shift stay inside, Esc returns focus to the icon', async () => {
    const { ctx, page } = await open();
    const inside = () => page.evaluate(() => document.getElementById('info-popup').contains(document.activeElement));
    try {
      await page.locator('#welcome-icon-btn').click();
      assert.equal(await page.locator('#welcome-icon-btn').getAttribute('aria-expanded'), 'true');
      assert.ok(await inside(), 'focus moved into the popup');
      await page.keyboard.press('Shift');
      await page.keyboard.press('Tab');
      assert.ok(await inside() && await page.locator('#info-popup').isVisible());
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#info-popup').isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'welcome-icon-btn');
      assert.ok(await page.locator('#welcome-dialog').evaluate((d) => d.open), 'dialog survives the Esc');
    } finally { await ctx.close(); }
  });
});

describe('heads-up notices', () => {
  test('one-click install line appears when installable, replays the prompt, then clears', async () => {
    const { ctx, page } = await open();
    try {
      await page.waitForFunction(() => document.getElementById('welcome-dialog').open);
      await page.evaluate(() => {
        const e = new Event('beforeinstallprompt');
        e.prompt = () => { window.__prompted = true; return Promise.resolve(); };
        e.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(e);
      });
      const box = page.locator('.welcome-heads-up');
      await page.waitForFunction(() => /Install dedtxt/.test(document.querySelector('.welcome-heads-up').textContent));
      await box.locator('button', { hasText: /install/i }).click();
      assert.equal(await page.evaluate(() => window.__prompted), true);
      await page.waitForFunction(() => !/Install dedtxt/.test(document.querySelector('.welcome-heads-up').textContent));
    } finally { await ctx.close(); }
  });

  test('"use Chrome or Edge" save hint: shown on desktop without FSA, never on a phone', async () => {
    const noFsa = () => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; };
    const desk = await open({ init: noFsa });
    try {
      await desk.page.waitForFunction(() => document.getElementById('welcome-dialog').open);
      assert.match(await desk.page.locator('.welcome-heads-up').textContent(), /Chrome or Edge/);
    } finally { await desk.ctx.close(); }

    const ctx = await phoneContext(browser);
    try {
      const page = await ctx.newPage();
      await page.goto(srv.base, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.getElementById('welcome-dialog').open);
      const text = (await page.locator('.welcome-heads-up').textContent()) || '';
      assert.doesNotMatch(text, /silently save|Chrome or Edge/i);
    } finally { await ctx.close(); }
  });
});

describe('service-worker updates', () => {
  // A real deploy cycle: SW caches v1 → the served tree changes (new sw.js
  // cache version + a marker in index.html) → the one-click notice appears →
  // clicking it reloads into v2.
  test('a new deploy surfaces the update notice; one click reloads into it', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dedtxt-sw-'));
    fs.cpSync(DIST, work, { recursive: true });
    root = work;
    const { ctx, page } = await open({ storage: WELCOMED });
    try {
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });

      const sw = path.join(work, 'sw.js');
      const idx = path.join(work, 'index.html');
      fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/const VERSION = '([^']*)'/, "const VERSION = '$1-v2'"));
      fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('</head>', '<meta name="build-marker" content="v2"></head>'));

      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await page.evaluate(() => document.getElementById('menu-toggle').click());
      await page.waitForFunction(() => /new version is ready/i.test(document.querySelector('.welcome-heads-up').textContent || ''),
        null, { timeout: 15000 });
      await Promise.all([
        page.waitForNavigation({ timeout: 15000 }),
        page.locator('.welcome-heads-up button', { hasText: /update/i }).click()
      ]);
      await page.waitForFunction(() => document.querySelector('meta[name="build-marker"]')?.content === 'v2',
        null, { timeout: 15000 });
    } finally {
      await ctx.close();
      root = DIST;
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});
