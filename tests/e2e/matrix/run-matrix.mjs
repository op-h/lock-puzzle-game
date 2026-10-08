// DoD viewport matrix (dev-only, not part of `npm test`: ~1000 measurements, several minutes).
//   node tests/e2e/matrix/run-matrix.mjs [--widths=320,390] [--zoom] [--quick] [--out=DIR]
//
// For each width: states (auth, auth-signin, home, help, board, play classic 3/4/5, play blood, result classic,
// result blood) x language (EN/AR) x scheme (dark/light, Blood palette on the Blood screens) x motion
// (reduce/no-preference, pinned with CDP Emulation.setEmulatedMedia and read back). Per measurement it records
// horizontal scroll, off-viewport elements, clipped text, target sizes (24 floor / 44 target), pixel-look rules,
// dock/header budget, and rendered text/UI contrast. Writes matrix.json and screenshots under tests/e2e/shots/.
//
// Zoom (--zoom): 200% = a 640x400 CSS-px viewport at DPR 2 (what a 1280x800 window shows at 200% browser zoom:
// media queries, vw and rem all respond exactly as under real zoom), 400% = 320x200 at DPR 4 (WCAG 1.4.10 reflow),
// plus text-only 200% (html font-size 200%) at 390 and 1280. A defensible stand-in, not a literal browser zoom.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../support/harness.mjs';
import { layoutAudit, contrastAudit, focusRingAudit } from '../support/measure.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) || path.join(HERE, '..', 'shots');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const WIDTHS = arg('widths', '320,360,390,768,1280,1920,2560').split(',').map(Number);
const HEIGHTS = { 320: 568, 360: 740, 390: 844, 768: 1024, 1280: 800, 1920: 1080, 2560: 1440 };
const QUICK = process.argv.includes('--quick');
const ZOOM = process.argv.includes('--zoom');
fs.mkdirSync(OUT, { recursive: true });

const hex = (n) => n.toString(16).padStart(64, '0');
const int = (n) => ({ integerValue: String(n) });

function seed(backend) {
  [['Zed', 9000, 4000, 30, 1800], ['سارة', 7000, 0, 20, 0], ['Longname-without-spaces', 5000, 3500, 15, 1500], ['A name with several words', 3000, 1000, 9, 900]].forEach(([name, total, blood, solved, bestRun], i) =>
    backend.put(`board/${hex(i + 1)}`, { name: { stringValue: name }, total: int(total), blood: int(blood), solved: int(solved), bestRun: int(bestRun), updatedAt: int(1760000000000 + i) }));
}

const results = [];
const issues = new Map(); // message -> {count, where:Set}
const note = (kind, msg, where) => {
  const k = `${kind}: ${msg}`;
  const e = issues.get(k) || { count: 0, where: new Set() };
  e.count++;
  e.where.add(where);
  issues.set(k, e);
};

async function settle(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(40);
}

async function ensureLang(d, lang) {
  const cur = await d.page.evaluate(() => document.documentElement.lang);
  if (cur === lang) return;
  await d.page.click('header [data-action="lang"]');
  await d.page.waitForFunction((l) => document.documentElement.lang === l, lang);
  await settle(d.page);
}

async function sweep(d, ctx, state, { full = true, textZoom = false } = {}) {
  const { page } = d;
  const langs = full ? ['en', 'ar'] : ['en'];
  const schemes = full ? ['dark', 'light'] : ['dark'];
  const motions = full ? ['no-preference', 'reduce'] : ['no-preference'];
  for (const lang of langs) {
    await ensureLang(d, lang);
    for (const scheme of schemes) {
      for (const motion of motions) {
        await d.pin({ motion, scheme });
        if (textZoom) await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
        await settle(page);
        const m = await page.evaluate(layoutAudit);
        const where = `${ctx.label} ${state} ${lang} ${scheme} ${motion}`;
        const rec = { ctx: ctx.label, w: ctx.w, h: ctx.h, state, lang, scheme, motion, m };
        if (m.hscroll) note('HSCROLL', `scrollWidth ${m.scrollW} > viewport ${m.vw}`, where);
        for (const x of m.overflowEls) note('OFFSCREEN', x, where);
        for (const x of m.clipped) note('CLIPPED', x, where);
        for (const x of m.under24) note('TARGET<24', x, where);
        for (const x of m.under44) note('target<44', x, where);
        for (const x of m.radius) note('RADIUS', x, where);
        if (m.transitionAll) note('TRANSITION-ALL', `${m.transitionAll} elements`, where);
        if (!m.fonts.pixelify) note('FONT', 'Pixelify Sans not loaded', where);
        if (m.header.rows > 1 && ctx.w <= 480 && !textZoom) note('HEADER-ROWS', `${m.header.rows} rows, ${m.header.h}px`, where);
        if (m.dock && (m.dock.primaryNotInView || m.dock.primaryOutsideDock)) note('DOCK', `primary controls out of view: ${m.dock.primaryNotInView}/${m.dock.primaryOutsideDock}`, where);
        if (m.dock && m.dock.dialsFitRow && m.dock.dialsFitRow.wrapped) note('DIALS-WRAP', JSON.stringify(m.dock.dialsFitRow), where);
        const need = ctx.w === 320 && ctx.h === 568 ? 170 : ctx.w === 390 && ctx.h === 844 ? 330 : 120; // ATLAS targets for the two reference phones
        if (m.dock && m.dock.sticky && m.dock.freeViewportH < need) note('DOCK-BUDGET', `only ${m.dock.freeViewportH}px of ${m.vh}px left for content, need ${need} (header ${m.dock.headerH}, dock ${m.dock.h})`, where);
        if (motion === 'no-preference') {
          rec.contrast = await page.evaluate(contrastAudit);
          for (const f of rec.contrast.fails) note('CONTRAST', f, where);
          for (const f of rec.contrast.uiFail) note('UI-CONTRAST', f, where);
        }
        results.push(rec);
        if (motion === 'no-preference' && !textZoom && ((lang === 'en' && scheme === 'dark') || (ctx.w === 390 && !QUICK) || (ctx.w === 320 && lang === 'ar'))) {
          const dir = path.join(OUT, ctx.label);
          fs.mkdirSync(dir, { recursive: true });
          await page.screenshot({ path: path.join(dir, `${state}-${lang}-${scheme}.png`), fullPage: false });
          if (['home', 'board', 'help', 'result-classic', 'result-blood'].includes(state) && lang === 'en' && scheme === 'dark') await page.screenshot({ path: path.join(dir, `${state}-${lang}-${scheme}-full.png`), fullPage: true });
        }
      }
    }
  }
  await ensureLang(d, 'en');
  await d.pin({ motion: 'no-preference', scheme: 'dark' });
  if (textZoom) await page.evaluate(() => (document.documentElement.style.fontSize = ''));
}

async function focusRings(d, ctx, state) {
  const { page } = d;
  for (const scheme of ['dark', 'light']) {
    await d.pin({ scheme, motion: 'no-preference' });
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(focusRingAudit);
      if (!r) continue;
      const where = `${ctx.label} ${state} ${scheme}`;
      if (r.bestVsBg < 3) note('FOCUS-RING', `${r.el} best band vs bg ${r.bestVsBg.toFixed(2)}:3`, where);
      if (r.outlineStyle === 'none' || parseFloat(r.outlineWidth) < 2) note('FOCUS-RING', `${r.el} outline ${r.outlineStyle} ${r.outlineWidth}`, where);
      results.push({ ctx: ctx.label, state, scheme, ring: r });
    }
  }
  await d.pin({ scheme: 'dark', motion: 'no-preference' });
}

async function runContext(ctx) {
  const backend = H.createBackend();
  seed(backend);
  const d = await H.openDevice(ctx.browser, { baseUrl: ctx.url, backend, viewport: { width: ctx.w, height: ctx.h }, mobile: ctx.mobile, dpr: ctx.dpr, allow: [/./] });
  const { page } = d;
  const full = ctx.full;
  const S = (state, opts) => sweep(d, ctx, state, { full, ...opts });
  console.log(`[${ctx.label}] ${ctx.w}x${ctx.h} dpr${ctx.dpr || (ctx.mobile ? 2 : 1)}`);
  await d.goto('');
  await S('auth');
  await page.click('[data-action="show-signin"]');
  await S('auth-signin');
  await page.click('[data-action="show-signup"]');
  await H.signUp(d, 'Matrix Max');
  await S('home');
  if (ctx.rings) await focusRings(d, ctx, 'home');
  await page.click('[data-screen="home"] [data-action="show-help"]');
  await d.waitScreen('help');
  await S('help');
  await page.click('[data-screen="help"] [data-action="back"]');
  await d.waitScreen('home');
  await page.click('[data-screen="home"] [data-action="show-board"]');
  await d.waitScreen('board');
  await page.waitForSelector('[data-slot="board-rows"] tr');
  await S('board');
  await page.click('[data-screen="board"] [data-action="back"]');
  await d.waitScreen('home');
  for (const [diff, n] of [['rookie', 3], ['hacker', 4], ['master', 5]]) {
    await H.startClassic(page, diff);
    await S(`play-classic-${n}`);
    if (ctx.rings && diff === 'master') await focusRings(d, ctx, 'play-classic-5');
    if (diff === 'master') {
      // a wrong guess + hint populate attempts row, locked dial and the message strip: the tallest the dock gets
      const p = await H.currentPuzzle(page);
      await H.typeWithKeypad(page, H.wrongGuess(p.answer, 0));
      await H.pressCheck(page);
      await page.click('[data-screen="play"] [data-action="hint"]');
      await page.waitForTimeout(150);
      await S('play-classic-5-wrong+hint');
    }
    await H.quitRound(page);
    await d.waitScreen('home');
  }
  await H.startBlood(page);
  await S('play-blood');
  if (ctx.rings) await focusRings(d, ctx, 'play-blood');
  // solve one so the run has a result, then quit: result-blood
  const bp = await H.currentPuzzle(page);
  await H.typeWithKeypad(page, bp.answer);
  await H.pressCheck(page);
  await page.waitForTimeout(300);
  await H.quitRound(page);
  await d.waitScreen('result');
  await page.waitForTimeout(400);
  await S('result-blood');
  if (ctx.rings) await focusRings(d, ctx, 'result-blood');
  await page.click('[data-screen="result"] [data-action="go-home"]');
  await d.waitScreen('home');
  await H.startClassic(page, 'rookie');
  await H.solveClassic(page);
  await page.waitForTimeout(400);
  await S('result-classic');
  if (ctx.textZoomToo) {
    await S('result-classic', { textZoom: true, full: false });
    await page.click('[data-screen="result"] [data-action="go-home"]');
    await d.waitScreen('home');
    await S('home', { textZoom: true, full: false });
    await H.startClassic(page, 'master');
    await S('play-classic-5', { textZoom: true, full: false });
  }
  // modal dialogs are part of every screen's fit: code dialog (AR, long) and logout
  await page.goto(ctx.url);
  await d.booted().catch(() => {});
  const bad = d.problems.filter((p) => !/ERR_INTERNET|net::ERR/.test(p.text));
  for (const p of bad) note('CONSOLE/NET', `${p.kind} ${p.text.slice(0, 160)}`, ctx.label);
  await d.close();
}

async function spritesResolve(browser, url) {
  const d = await H.openDevice(browser, { baseUrl: url, backend: H.createBackend(), allow: [/./] });
  await d.goto('');
  const r = await d.page.evaluate(async () => {
    const uses = [...document.querySelectorAll('use')];
    const bad = [];
    const cache = new Map();
    for (const u of uses) {
      const href = u.getAttribute('href');
      const [file, id] = href.split('#');
      const abs = new URL(file, document.baseURI).href;
      if (!cache.has(abs)) cache.set(abs, fetch(abs).then((r) => (r.ok ? r.text() : null)));
      const text = await cache.get(abs);
      if (!text || !text.includes(`id="${id}"`)) bad.push(href);
    }
    const sample = [...document.querySelectorAll('[data-screen="auth"] .lp-vault-door svg, header .lp-brand svg')].map((s) => { const r = s.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; });
    return { uses: uses.length, bad, sample };
  });
  await d.close();
  return r;
}

const browser = await H.launchBrowser();
const srv = await H.startServer();
const t0 = Date.now();
try {
  console.log('sprites:', JSON.stringify(await spritesResolve(browser, srv.url)));
  for (const w of WIDTHS) {
    await runContext({ browser, url: srv.url, label: `w${w}`, w, h: HEIGHTS[w] || 800, mobile: w <= 768, full: true, rings: w === 390 || w === 1280 || w === 320, textZoomToo: w === 390 || w === 1280 });
  }
  if (ZOOM) {
    await runContext({ browser, url: srv.url, label: 'zoom200', w: 640, h: 400, dpr: 2, mobile: false, full: false, rings: false });
    await runContext({ browser, url: srv.url, label: 'zoom400', w: 320, h: 200, dpr: 4, mobile: false, full: false, rings: false });
  }
} finally {
  await browser.close();
  await srv.close();
}

const summary = [...issues.entries()].map(([k, v]) => ({ issue: k, count: v.count, where: [...v.where].slice(0, 4) })).sort((a, b) => a.issue.localeCompare(b.issue));
fs.writeFileSync(path.join(OUT, 'matrix.json'), JSON.stringify({ when: new Date().toISOString(), measurements: results.length, summary, results }, null, 1));
console.log(`\n${results.length} measurements in ${Math.round((Date.now() - t0) / 1000)} s; ${summary.length} distinct findings`);
const grouped = {};
for (const s of summary) (grouped[s.issue.split(':')[0]] ||= []).push(s);
for (const [k, list] of Object.entries(grouped)) {
  console.log(`\n== ${k} (${list.length} distinct, ${list.reduce((a, b) => a + b.count, 0)} hits)`);
  for (const s of list.slice(0, 14)) console.log(`  x${s.count} ${s.issue.slice(k.length + 2, 200)}  @ ${s.where[0]}`);
}
