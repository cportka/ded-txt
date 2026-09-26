'use strict';
// Responsive-layout guard: walks every overlay of the real bundle across a
// phone → desktop viewport matrix and asserts it stays on-screen and usable.
//
// Born from #75 — the draft-recovery notice collapsed to one character per
// line on phones (a 50vw shrink-to-fit region + flex-squeezed text) and no
// test noticed, because nothing measured layout at phone widths. Every check
// here is geometric, not textual, so that class of bug can't slip by again.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { assertBuilt, serve, launch, phoneContext, shot } = require('./harness');

const VIEWPORTS = [
  { name: 'small phone 320x568', w: 320, h: 568, touch: true },
  { name: 'iPhone SE 375x667', w: 375, h: 667, touch: true },
  { name: 'iPhone 15 390x844', w: 390, h: 844, touch: true },
  { name: 'iPhone Pro Max 430x932', w: 430, h: 932, touch: true },
  { name: 'phone landscape 844x390', w: 844, h: 390, touch: true },
  { name: 'iPad portrait 768x1024', w: 768, h: 1024, touch: true },
  { name: 'iPad landscape 1180x820', w: 1180, h: 820, touch: true },
  { name: 'laptop 1280x800', w: 1280, h: 800, touch: false },
  { name: 'desktop 1920x1080', w: 1920, h: 1080, touch: false }
];

// A worst-case error: one long unbroken token must wrap, not widen the card.
const LONG_ERROR = 'Save failed — ENOSPC: no space left on device, write '
  + '/Users/someone/Documents/projects/2026/really-long-folder-name/and-an-even-longer-file-name-with-no-spaces.txt';

const TOL = 1; // px of subpixel slack

let srv;
let browser;
before(async () => {
  assertBuilt();
  srv = await serve();
  browser = await launch();
});
after(async () => {
  if (browser) await browser.close();
  if (srv) srv.close();
});

async function newPage(vp, storage = {}) {
  // Reduced motion → no glitch transforms mid-measurement; layout is final.
  const ctx = vp.touch
    ? await phoneContext(browser, { width: vp.w, height: vp.h, reducedMotion: 'reduce' })
    : await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: 'reduce' });
  await ctx.addInitScript((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, storage);
  const page = await ctx.newPage();
  await page.goto(srv.base, { waitUntil: 'networkidle' });
  return { ctx, page };
}

function rect(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);
}

function viewport(page) {
  return page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
}

async function assertOnScreen(page, selector, label) {
  const r = await rect(page, selector);
  assert.ok(r, `${label}: ${selector} not found`);
  const vp = await viewport(page);
  assert.ok(r.width > 0 && r.height > 0, `${label}: ${selector} has no size`);
  assert.ok(r.left >= -TOL, `${label}: ${selector} spills off the left edge (left=${r.left})`);
  assert.ok(r.top >= -TOL, `${label}: ${selector} spills off the top edge (top=${r.top})`);
  assert.ok(r.right <= vp.w + TOL, `${label}: ${selector} spills off the right edge (${r.right} > ${vp.w})`);
  assert.ok(r.bottom <= vp.h + TOL, `${label}: ${selector} spills off the bottom edge (${r.bottom} > ${vp.h})`);
  return r;
}

async function assertNoHorizontalScroll(page, label) {
  const { scrollW, vw } = await page.evaluate(() => ({
    scrollW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    vw: window.innerWidth
  }));
  assert.ok(scrollW <= vw + TOL, `${label}: page scrolls sideways (scrollWidth ${scrollW} > ${vw})`);
}

function fontSize(page, selector) {
  return page.evaluate((sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize), selector);
}

for (const vp of VIEWPORTS) {
  describe(`responsive @ ${vp.name}`, () => {
    test('welcome card, info popup and find bar all fit on screen', async () => {
      const { ctx, page } = await newPage(vp);
      try {
        await assertNoHorizontalScroll(page, 'editor');
        await assertOnScreen(page, '#menu-toggle', 'menu button');
        await assertOnScreen(page, '#line-gutter', 'line gutter');

        // First visit: the welcome dialog auto-opens.
        await page.waitForFunction(() => document.getElementById('welcome-dialog').open);
        const card = await assertOnScreen(page, '.welcome-card', 'welcome');
        // Taller-than-viewport content must scroll inside the card, never
        // push its buttons out of reach.
        const cardScroll = await page.evaluate(() => {
          const c = document.querySelector('.welcome-card');
          return { over: c.scrollHeight > c.clientHeight + 1, oy: getComputedStyle(c).overflowY };
        });
        if (cardScroll.over) assert.equal(cardScroll.oy, 'auto', 'welcome: overflowing card must scroll');
        assert.ok(card.width >= Math.min(260, vp.w - 40), `welcome: card too narrow (${card.width}px)`);
        await shot(page, `${vp.w}x${vp.h}-welcome`);

        await page.locator('#welcome-icon-btn').click();
        await page.waitForFunction(() => !document.getElementById('info-popup').hidden);
        await assertOnScreen(page, '#info-popup', 'info popup');
        await shot(page, `${vp.w}x${vp.h}-info-popup`);
        await page.keyboard.press('Escape');

        await page.locator('#welcome-close').click();
        await page.waitForFunction(() => !document.getElementById('welcome-dialog').open);
        await page.locator('#text-editor').click();
        await page.keyboard.press('Control+f');
        await page.waitForFunction(() => !document.getElementById('find-bar').hidden);
        await page.locator('#find-replace-toggle').click();
        await page.waitForFunction(() => !document.getElementById('find-replace-row').hidden);
        await assertOnScreen(page, '#find-bar', 'find bar');
        for (const sel of ['#find-input', '#find-replace-input', '#find-next', '#find-close', '#find-replace-all']) {
          await assertOnScreen(page, sel, 'find bar');
        }
        const inputW = (await rect(page, '#find-input')).width;
        assert.ok(inputW >= 90, `find bar: search field too cramped to type in (${inputW}px)`);
        await assertNoHorizontalScroll(page, 'find bar');
        await shot(page, `${vp.w}x${vp.h}-find`);

        if (vp.touch) {
          // iOS Safari zooms the whole page when a focused field is < 16px.
          for (const sel of ['#text-editor', '#find-input', '#find-replace-input']) {
            assert.ok(await fontSize(page, sel) >= 16, `${sel} must be ≥16px on touch (iOS focus-zoom)`);
          }
          // Thumb-sized targets for the find controls.
          for (const sel of ['#find-next', '#find-prev', '#find-close']) {
            const r = await rect(page, sel);
            assert.ok(r.height >= 32 && r.width >= 32, `${sel} tap target too small (${r.width}x${r.height})`);
          }
        }
      } finally {
        await ctx.close();
      }
    });

    test('notices stay readable: draft offer + long error, on screen, sane shape', async () => {
      const { ctx, page } = await newPage(vp, {
        'dedtxt-welcomed': 'true',
        'dedtxt-draft': JSON.stringify({
          content: 'unsaved thoughts', name: 'meeting-notes-q3.txt', isBinary: false, savedAt: Date.now() - 7 * 60000
        })
      });
      try {
        await page.locator('#notice-region .notice').first().waitFor();
        // Same module URL as the app's import → same instance → same region.
        await page.evaluate(async (msg) => {
          const m = await import('/notice.js');
          m.showNotice(msg, { kind: 'error', sticky: true });
        }, LONG_ERROR);
        await page.waitForFunction(() => document.querySelectorAll('#notice-region .notice').length === 2);

        const vw = (await viewport(page)).w;
        const cards = await page.evaluate(() => [...document.querySelectorAll('#notice-region .notice')].map((n) => {
          const r = n.getBoundingClientRect();
          const t = n.querySelector('.notice-text').getBoundingClientRect();
          return { width: r.width, height: r.height, textW: t.width, top: r.top, bottom: r.bottom };
        }));
        const vh = (await viewport(page)).h;
        for (const [i, c] of cards.entries()) {
          const label = i === 0 ? 'draft offer' : 'long error';
          // The #75 failure mode: a card squeezed to a sliver of the screen
          // with its message in a one-glyph column.
          assert.ok(c.width >= Math.min(300, vw - 40), `${label}: card only ${Math.round(c.width)}px wide at ${vw}px`);
          assert.ok(c.textW >= c.width * 0.45, `${label}: message squeezed to ${Math.round(c.textW)}px of a ${Math.round(c.width)}px card`);
          assert.ok(c.height <= Math.max(140, vh * 0.35), `${label}: card ${Math.round(c.height)}px tall — text is wrapping pathologically`);
          assert.ok(c.top >= -TOL && c.bottom <= vh + TOL, `${label}: card off-screen vertically`);
        }
        await assertOnScreen(page, '#notice-region .notice:nth-child(1)', 'draft offer');
        await assertOnScreen(page, '#notice-region .notice:nth-child(2)', 'long error');
        await assertNoHorizontalScroll(page, 'notices');
        await shot(page, `${vp.w}x${vp.h}-notices`);

        if (vp.touch) {
          // The Restore button's invisible ::after extends its hit area:
          // a tap ~10px above the visible label must still land on it.
          const hit = await page.evaluate(() => {
            const b = document.querySelector('.notice-action');
            const r = b.getBoundingClientRect();
            const el = document.elementFromPoint(r.left + r.width / 2, r.top - 10);
            return el === b;
          });
          assert.ok(hit, 'Restore: touch hit area should extend beyond the text');
          const x = await rect(page, '.notice-dismiss');
          assert.ok(x.width >= 36 && x.height >= 36, `notice ✕ tap target too small (${x.width}x${x.height})`);
        }
      } finally {
        await ctx.close();
      }
    });

    test('long document: gutter, editor and scroll arrows stay in bounds', async () => {
      const { ctx, page } = await newPage(vp, { 'dedtxt-welcomed': 'true' });
      try {
        await page.evaluate(() => {
          const ed = document.getElementById('text-editor');
          ed.value = Array.from({ length: 400 }, (_, i) =>
            `line ${i + 1} — the quick brown fox jumps over the lazy dog, again and again and again`).join('\n');
          ed.dispatchEvent(new Event('input', { bubbles: true }));
          ed.scrollTop = ed.scrollHeight / 2;
          ed.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(250);
        await assertNoHorizontalScroll(page, 'long document');
        await assertOnScreen(page, '#text-editor', 'editor');
        await assertOnScreen(page, '#line-gutter', 'gutter');
        for (const sel of ['#scroll-top', '#scroll-bottom']) {
          const shown = await page.evaluate((s) => {
            const el = document.querySelector(s);
            return el && !el.hidden && getComputedStyle(el).display !== 'none';
          }, sel);
          if (shown) await assertOnScreen(page, sel, 'scroll arrow');
        }
        // Editor text must not start underneath the gutter.
        const gutter = await rect(page, '#line-gutter');
        const padLeft = await page.evaluate(() => {
          const ed = document.getElementById('text-editor');
          return ed.getBoundingClientRect().left + parseFloat(getComputedStyle(ed).paddingLeft);
        });
        assert.ok(padLeft >= gutter.right - TOL, `editor text (${padLeft}) starts under the gutter (${gutter.right})`);
        await shot(page, `${vp.w}x${vp.h}-long-doc`);
      } finally {
        await ctx.close();
      }
    });
  });
}
