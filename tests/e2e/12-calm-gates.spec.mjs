// ADR 0005 section 5 gates and docs/design-v2.md section 11 checks, as strict tests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as H from './support/harness.mjs';
import { solutions } from '../../js/engine/solver.js';

let srv;
let br;
before(async () => {
  srv = await H.startServer();
  br = await H.launchBrowser();
});
after(async () => {
  await br.close();
  await srv.close();
});

const dev = (o = {}) => H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend(), ...o });
const ratio = (page) => page.evaluate(() => ({ r: document.documentElement.scrollHeight / innerHeight, sh: document.documentElement.scrollHeight, vh: innerHeight }));
const EPS = 1.004;
const T = 'main > [data-screen="play"]';

// ----------------------------------------------------------------------------------------------- one viewport (ADR 0005 s5)
for (const lang of ['en', 'ar']) {
  test(`one viewport @ 390x844 (${lang}): Auth, sign-in, code dialog, Home, Result (Classic and Blood) fit with no page scroll; Play Rookie/Agent too, Hacker/Master <= 1.2`, async () => {
    const d = await dev({ viewport: { width: 390, height: 844 }, mobile: true, locale: lang === 'ar' ? 'ar-SA' : 'en-US' });
    const { page } = d;
    const bad = [];
    const check = async (label, max) => {
      await page.waitForTimeout(350); // let the view transition settle
      const x = await ratio(page);
      if (x.r > max * EPS) bad.push(`${label}: ${x.r.toFixed(3)} (${x.sh}/${x.vh}) > ${max}`);
    };
    await d.goto('');
    await check('auth', 1);
    await page.click('[data-action="show-signin"]');
    await check('auth sign-in', 1);
    await page.click('[data-action="show-signup"]');
    await page.fill(H.q.signupName, 'Calm Cleo');
    await page.click(H.q.signupSubmit);
    await page.waitForSelector(`${H.q.codeDialog}[open]`);
    await check('code dialog (page)', 1);
    const dlg = await page.evaluate(() => { const r = document.querySelector('dialog[data-dialog="code"]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, scrollable: document.querySelector('dialog[data-dialog="code"]').scrollHeight > document.querySelector('dialog[data-dialog="code"]').clientHeight + 1 }; });
    if (dlg.top < -0.5 || dlg.bottom > dlg.vh + 0.5 || dlg.scrollable) bad.push(`code dialog does not fit: ${JSON.stringify(dlg)}`);
    await page.check('#code-ack');
    await page.click(`${H.q.codeDialog} [data-action="ack-code"]`);
    await d.waitScreen('home');
    await H.settleToast(page);
    await check('home', 1);
    for (const [diff, max] of [['rookie', 1], ['agent', 1], ['hacker', 1.2], ['master', 1.2]]) {
      await H.startClassic(page, diff);
      const n = await page.locator(`${T} [data-slot="clues"] > li`).count();
      const limit = diff === 'rookie' || diff === 'agent' ? (n <= 5 ? 1 : 1.2) : max;
      await check(`play ${diff} (${n} clues)`, limit);
      if (diff === 'rookie') {
        await H.solveClassic(page);
        await check('result classic', 1);
        await page.click('main > [data-screen="result"] [data-action="go-home"]');
        await d.waitScreen('home');
      } else {
        await H.quitRound(page);
        await d.waitScreen('home');
      }
    }
    await H.startBlood(page);
    const nb = await page.locator(`${T} [data-slot="clues"] > li`).count();
    await check(`play blood (${nb} clues)`, nb <= 5 ? 1 : 1.2);
    const bp = await H.currentPuzzle(page);
    await H.typeWithKeypad(page, bp.answer);
    await H.pressCheck(page);
    await page.waitForTimeout(500);
    await H.quitRound(page);
    await d.waitScreen('result');
    await check('result blood', 1);
    assert.deepEqual(bad, []);
    d.assertClean();
    await d.close();
  });

  test(`one viewport @ 320x568 (${lang}): Home and Result <= 1.25; Play shows the dials, both keypad rows and at least 2 clues`, async () => {
    const d = await dev({ viewport: { width: 320, height: 568 }, mobile: true, locale: lang === 'ar' ? 'ar-SA' : 'en-US' });
    const { page } = d;
    const bad = [];
    await H.signUp(d, 'Small Sam');
    await H.settleToast(page);
    await page.waitForTimeout(350);
    let x = await ratio(page);
    if (x.r > 1.25) bad.push(`home ${x.r.toFixed(3)}`);
    for (const [label, start] of [['classic master', () => H.startClassic(page, 'master')], ['classic rookie', () => H.startClassic(page, 'rookie')], ['blood', () => H.startBlood(page)]]) {
      await start();
      await page.waitForTimeout(450);
      const g = await page.evaluate(() => {
        const r = (e) => e.getBoundingClientRect();
        const play = document.querySelector('main > [data-screen="play"]');
        const dials = [...play.querySelectorAll('[data-slot="dials"] > button')].map(r);
        const keys = [...play.querySelectorAll('[data-slot="keypad"] > button')].map(r);
        const tops = [...new Set(keys.map((k) => Math.round(k.top)))];
        const clues = [...play.querySelectorAll('[data-slot="clues"] > li')].map(r);
        const bar = r(play.querySelector('.lp-topbar'));
        const dockTop = Math.min(...dials.map((d2) => d2.top));
        const vis = clues.filter((c) => c.top >= bar.bottom - 2 && c.bottom <= dockTop + 2).length;
        return { vh: innerHeight, dialsIn: dials.every((d2) => d2.bottom <= innerHeight + 0.5 && d2.top >= 0), keysIn: keys.every((k) => k.bottom <= innerHeight + 0.5), keyRows: tops.length, cluesVisible: vis, clueCount: clues.length };
      });
      if (!g.dialsIn) bad.push(`${label}: dials not inside the viewport`);
      if (!g.keysIn || g.keyRows < 2) bad.push(`${label}: keypad rows ${g.keyRows}, inside=${g.keysIn}`);
      if (g.cluesVisible < 2) bad.push(`${label}: only ${g.cluesVisible} of ${g.clueCount} clues visible`);
      await H.quitRound(page);
      await d.waitScreen('home');
    }
    await H.startClassic(page, 'rookie');
    await H.solveClassic(page);
    await page.waitForTimeout(450);
    x = await ratio(page);
    if (x.r > 1.25) bad.push(`result ${x.r.toFixed(3)}`);
    assert.deepEqual(bad, []);
    d.assertClean();
    await d.close();
  });
}

// ----------------------------------------------------------------------------------------------- copy budget
test('copy budget: no visible paragraph and no sentence over 8 words on Auth, Home, Play and Result (390x844, EN; clue sentences excepted)', async () => {
  const d = await dev({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = d;
  const scan = () =>
    page.evaluate(() => {
      const out = [];
      const root = document.querySelector('main > [data-screen]:not([hidden])');
      const open = document.querySelector('dialog[open]');
      for (const scope of [root, open].filter(Boolean)) {
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const el = n.parentElement;
          const text = n.textContent.replace(/\s+/g, ' ').trim();
          // clue sentences are puzzle content (the owner asked for them back), not interface copy
          if (!text || el.closest('[hidden], .visually-hidden, [aria-hidden="true"], [data-out="name"], [data-out="code"], output, button, label, legend, h1, h2, [data-slot="clues"]')) continue;
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (cs.display === 'none' || cs.visibility === 'hidden' || r.width <= 2 || (cs.position === 'absolute' && r.width <= 2)) continue;
          for (const sentence of text.split(/(?<=[.!?])\s+/)) {
            const words = sentence.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
            if (words.length > 8) out.push(`${words.length} words: "${sentence}"`);
          }
          if (el.tagName === 'P' && text.split(/\s+/).length > 8) out.push(`paragraph of ${text.split(/\s+/).length} words: "${text}"`);
        }
      }
      return out;
    });
  const bad = [];
  await d.goto('');
  for (const x of await scan()) bad.push('auth: ' + x);
  await page.click('[data-action="show-signin"]');
  for (const x of await scan()) bad.push('signin: ' + x);
  await page.click('[data-action="show-signup"]');
  await page.fill(H.q.signupName, 'Copy Cat');
  await page.click(H.q.signupSubmit);
  await page.waitForSelector(`${H.q.codeDialog}[open]`);
  for (const x of await scan()) bad.push('code dialog: ' + x);
  await page.check('#code-ack');
  await page.click(`${H.q.codeDialog} [data-action="ack-code"]`);
  await d.waitScreen('home');
  await page.waitForTimeout(350);
  for (const x of await scan()) bad.push('home: ' + x);
  await H.startClassic(page, 'master');
  await page.waitForTimeout(350);
  const p = await H.currentPuzzle(page);
  await H.typeWithKeypad(page, H.wrongGuess(p.answer, 0));
  await H.pressCheck(page);
  await page.click(`${T} [data-action="hint"]`);
  for (const x of await scan()) bad.push('play: ' + x);
  await H.quitRound(page);
  await H.startBlood(page);
  for (const x of await scan()) bad.push('blood: ' + x);
  await H.quitRound(page);
  await H.startClassic(page, 'rookie');
  await H.solveClassic(page);
  await page.waitForTimeout(500);
  for (const x of await scan()) bad.push('result: ' + x);
  assert.deepEqual(bad, []);
  await d.close();
});

// ----------------------------------------------------------------------------------------------- texture, fonts, targets
test('no page-wide dither or dashed rules; Jersey 10 is the loaded face and Pixelify is gone', async () => {
  const d = await dev({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = d;
  await H.signUp(d, 'Plain Pat');
  await H.settleToast(page);
  const r = await page.evaluate(async () => {
    const out = { bg: [], rules: [], fonts: null };
    for (const sel of ['html', 'body', 'main', 'body > header', 'footer', 'main > [data-screen]:not([hidden])']) {
      const e = document.querySelector(sel);
      if (e && getComputedStyle(e).backgroundImage !== 'none') out.bg.push(`${sel}: ${getComputedStyle(e).backgroundImage.slice(0, 60)}`);
    }
    for (const e of document.querySelectorAll('h1, h2, header, footer, li, dt, dd, th, td, section')) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none') continue;
      for (const side of ['Top', 'Bottom']) if (cs[`border${side}Style`] === 'dashed' || cs[`border${side}Style`] === 'dotted') out.rules.push(`${e.tagName}${e.className ? '.' + e.className : ''} border-${side}`);
      if (/repeating|linear-gradient\(to right/.test(cs.backgroundImage) && !e.matches('button, [role=tab], [data-timer-bar]')) out.rules.push(`${e.tagName} bg ${cs.backgroundImage.slice(0, 50)}`);
    }
    await document.fonts.ready;
    out.fonts = {
      jersey: document.fonts.check('16px "Jersey 10"'),
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')),
      bodyFamily: getComputedStyle(document.body).fontFamily,
      pixelifyAnywhere: [...document.fonts].some((f) => /Pixelify/i.test(f.family)) || /Pixelify/i.test(getComputedStyle(document.body).fontFamily),
    };
    return out;
  });
  assert.deepEqual(r.bg, [], 'ADR 0005: flat page background (no dither)');
  assert.deepEqual(r.rules, [], 'no dashed rule under headings or between rows');
  assert.equal(r.fonts.jersey, true);
  assert.ok(r.fonts.loaded.includes('Jersey 10'), `Jersey 10 loaded (${r.fonts.loaded})`);
  assert.match(r.fonts.bodyFamily, /^"?Jersey 10"?/);
  assert.equal(r.fonts.pixelifyAnywhere, false, 'Pixelify Sans is no longer referenced');
  d.assertClean();
  await d.close();
});

test('header icon buttons are at least 44x44; the CLOSED account menu paints and intercepts nothing; the open one stays inside the viewport (EN/AR, 320/390)', async () => {
  for (const [w, h] of [[320, 568], [390, 844]]) {
    for (const lang of ['en', 'ar']) {
      const d = await dev({ viewport: { width: w, height: h }, mobile: true, locale: lang === 'ar' ? 'ar-SA' : 'en-US' });
      const { page } = d;
      await H.signUp(d, 'Menu Mo');
      await H.settleToast(page);
      const closed = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('body > header .lp-iconbtn')].filter((b) => !b.closest('[hidden]') && b.getBoundingClientRect().width > 0);
        const small = btns.map((b) => b.getBoundingClientRect()).filter((r) => r.width < 43.5 || r.height < 43.5).map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`);
        const det = document.querySelector('body > header details[data-account]');
        const dr = det.getBoundingClientRect();
        const hdr = document.querySelector('body > header').getBoundingClientRect();
        // sample a grid under the header where an open menu would be: nothing from the menu may be hit
        const hits = [];
        for (let x = 2; x < innerWidth; x += 24) for (const y of [hdr.bottom + 6, hdr.bottom + 30, hdr.bottom + 60]) {
          const t = document.elementFromPoint(x, y);
          if (t && t.closest('details[data-account]')) hits.push(`${Math.round(x)},${Math.round(y)}`);
        }
        const lo = document.querySelector('body > header [data-action="logout"]').getBoundingClientRect();
        return { n: btns.length, small, detW: Math.round(dr.width), detH: Math.round(dr.height), hits, logoutArea: Math.round(lo.width * lo.height), headerH: Math.round(hdr.height) };
      });
      assert.ok(closed.n >= 4, `icon buttons present (${closed.n})`);
      assert.deepEqual(closed.small, [], `${w} ${lang}: icon buttons under 44x44`);
      assert.ok(closed.detW >= 44 && closed.detH >= 44 && closed.detW <= 60 && closed.detH <= 60, `closed details is the 44x44 button, not a bar (${closed.detW}x${closed.detH})`);
      assert.deepEqual(closed.hits, [], 'closed account menu intercepts nothing under the header');
      assert.equal(closed.logoutArea, 0, 'closed menu has no box');
      await page.click('body > header details[data-account] > summary');
      const open = await page.evaluate(() => { const r = document.querySelector('body > header [data-action="logout"]').getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), vw: innerWidth }; });
      assert.ok(open.l >= 0 && open.r <= open.vw, `${w} ${lang}: open menu ${open.l}..${open.r} of ${open.vw}`);
      d.assertClean();
      await d.close();
    }
  }
});

// ----------------------------------------------------------------------------------------------- Help
test('Help: worked example sits in a CLOSED <details> by default, opens by keyboard, and its answer 184 is the unique solution of its four clues', async () => {
  // the four clues of the example, solved by brute force with the project's own engine
  const clues = [
    { kind: 'feedback', guess: [7, 2, 9], bulls: 0, cows: 0 },
    { kind: 'feedback', guess: [6, 8, 2], bulls: 1, cows: 0 },
    { kind: 'feedback', guess: [1, 5, 9], bulls: 1, cows: 0 },
    { kind: 'feedback', guess: [4, 2, 1], bulls: 0, cows: 2 },
  ];
  assert.deepEqual(solutions({ length: 3, repeats: false }, clues, 5), [[1, 8, 4]], 'the Help example has exactly one solution: 184');
  const d = await dev({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = d;
  await d.goto('');
  await page.click('body > header [data-action="show-help"]');
  await d.waitScreen('help');
  const h = await page.evaluate(() => {
    const det = [...document.querySelectorAll('main > [data-screen="help"] details')];
    const ex = det.find((x) => /184/.test(x.textContent));
    return { count: det.length, found: !!ex, open: ex && ex.open, summary: ex && ex.querySelector('summary').textContent.trim(), has184: !!ex && /184/.test(ex.textContent), visibleWhenClosed: ex ? [...ex.querySelectorAll('li, p')].some((e) => e.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) : null, closedH: ex ? Math.round(ex.getBoundingClientRect().height) : null };
  });
  assert.equal(h.found, true, 'the example is inside a <details>');
  assert.equal(h.open, false, 'closed by default');
  assert.equal(h.has184, true);
  assert.equal(h.visibleWhenClosed, false, 'its content is not rendered while closed');
  assert.ok(h.closedH < 100, `closed <details> is one summary row (${h.closedH}px)`);
  await page.focus('main > [data-screen="help"] details > summary');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('main > [data-screen="help"] details')].find((x) => /184/.test(x.textContent)).open), true, 'Enter opens it');
  d.assertClean();
  await d.close();
});

// ----------------------------------------------------------------------------------------------- motion
async function spyDevice(media, stub) {
  const d = await dev({ viewport: { width: 390, height: 844 }, mobile: true, media });
  await d.context.addInitScript((mode) => {
    window.__vt = 0;
    const real = document.startViewTransition ? document.startViewTransition.bind(document) : null;
    document.startViewTransition = function (cb) {
      window.__vt++;
      if (mode === 'reject') {
        // a transition that never runs the update and rejects every promise: the app must still land on the screen
        const e = () => Promise.reject(new Error('stubbed view transition failure'));
        return { ready: e(), finished: e(), updateCallbackDone: e(), skipTransition() {} };
      }
      return real ? real(cb) : (cb(), { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve(), skipTransition() {} });
    };
  }, stub || 'real');
  return d;
}

test('view transitions: with reduced motion pinned NONE start; without it screens still land with focus on the heading, even if startViewTransition rejects', async () => {
  const hops = async (d) => {
    const { page } = d;
    await H.signUp(d, 'Move Mia');
    await H.settleToast(page);
    await page.click('body > header [data-action="show-board"]');
    await d.waitScreen('board');
    const f1 = await page.evaluate(() => document.activeElement.id);
    await page.click('main > [data-screen="board"] [data-action="back"]');
    await d.waitScreen('home');
    await page.click('body > header [data-action="show-help"]');
    await d.waitScreen('help');
    const f2 = await page.evaluate(() => document.activeElement.id);
    await page.click('main > [data-screen="help"] [data-action="back"]');
    await d.waitScreen('home');
    await H.startClassic(page, 'rookie');
    return { f1, f2, vt: await page.evaluate(() => window.__vt) };
  };
  const reduced = await spyDevice({ motion: 'reduce', scheme: 'dark' });
  const r1 = await hops(reduced);
  assert.equal(r1.vt, 0, 'reduced motion: document.startViewTransition was never called');
  assert.deepEqual([r1.f1, r1.f2], ['board-title', 'help-title']);
  reduced.assertClean();
  await reduced.close();

  const normal = await spyDevice({ motion: 'no-preference', scheme: 'dark' });
  const r2 = await hops(normal);
  assert.ok(r2.vt >= 4, `no-preference: screen changes use view transitions (${r2.vt} calls)`);
  assert.deepEqual([r2.f1, r2.f2], ['board-title', 'help-title'], 'focus lands on the heading after a transition');
  normal.assertClean();
  await normal.close();

  const broken = await spyDevice({ motion: 'no-preference', scheme: 'dark' }, 'reject');
  const r3 = await hops(broken);
  assert.ok(r3.vt >= 4);
  assert.deepEqual([r3.f1, r3.f2], ['board-title', 'help-title'], 'a rejecting/never-calling transition still lands on the right screen with focus on the h1');
  broken.assertClean(); // no unhandled rejection, no console error
  await broken.close();
});

// ----------------------------------------------------------------------------------------------- toast, top bar, chip
test('Play message toast fades out and empties; Blood top bar shows the solved COUNT as visible text; the sync chip appears only offline/device-only', async () => {
  const backend = H.createBackend();
  const d = await dev({ backend, viewport: { width: 390, height: 844 }, mobile: true, allow: [/ERR_INTERNET_DISCONNECTED|net::ERR/] });
  const { page } = d;
  await H.signUp(d, 'Chip Chi');
  await H.waitSynced(page);
  await H.settleToast(page);
  const chip = () => page.evaluate(() => { const c = document.querySelector('body > header .lp-chip'); const r = c.getBoundingClientRect(); return { hidden: c.hidden, w: Math.round(r.width), status: c.dataset.status, text: c.querySelector('output').textContent }; });
  let c = await chip();
  assert.equal(c.hidden, true, 'synced: the chip is not shown');
  assert.equal(c.w, 0);
  // Classic: duplicate guess message appears, then fades out and empties
  await H.startClassic(page, 'rookie');
  const p = await H.currentPuzzle(page);
  const g = H.wrongGuess(p.answer, 0);
  await H.typeWithKeypad(page, g);
  await H.pressCheck(page);
  await H.typeWithKeypad(page, g);
  await H.pressCheck(page);
  await page.waitForFunction(() => /Already tried/.test(document.querySelector('main > [data-screen="play"] [data-out="msg"]').textContent));
  const seen = await page.evaluate(() => getComputedStyle(document.querySelector('main > [data-screen="play"] p[data-live="status"]')).opacity);
  assert.ok(Number(seen) > 0, 'toast is visible while it has text');
  await page.waitForFunction(() => document.querySelector('main > [data-screen="play"] [data-out="msg"]').textContent === '', null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('main > [data-screen="play"] p[data-live="status"]')).opacity), '0', 'and it is gone (opacity 0) once emptied');
  await H.quitRound(page);
  // Blood: solved count in the top bar
  await H.startBlood(page);
  const bar = () => page.evaluate(() => { const g = document.querySelector('[data-topbar="solved"]'); const r = g.getBoundingClientRect(); return { hidden: g.hidden, w: Math.round(r.width), n: g.querySelector('[data-out="solved-count"]').textContent.trim(), icon: g.querySelector('use').getAttribute('href'), wrongHidden: document.querySelector('[data-topbar="wrong"]').hidden }; });
  let b = await bar();
  assert.deepEqual([b.hidden, b.n, b.wrongHidden], [false, '0', true]);
  assert.ok(b.w > 0 && /lp-check$/.test(b.icon), 'visible with the check icon');
  const bp = await H.currentPuzzle(page);
  await H.typeWithKeypad(page, bp.answer);
  await H.pressCheck(page);
  await page.waitForFunction(() => document.querySelector('[data-topbar="solved"] [data-out="solved-count"]').textContent.trim() === '1');
  b = await bar();
  assert.equal(b.n, '1');
  await H.quitRound(page);
  await d.waitScreen('result');
  await page.click('main > [data-screen="result"] [data-action="go-home"]');
  await d.waitScreen('home');
  // offline: the chip appears with its label, then disappears when synced again
  d.net.block = true;
  await H.startClassic(page, 'rookie');
  await H.solveClassic(page);
  await page.waitForFunction(() => { const c = document.querySelector('body > header .lp-chip'); return c && !c.hidden; }, null, { timeout: 20000 });
  c = await chip();
  assert.ok(['offline', 'local'].includes(c.status), `chip status ${c.status}`);
  assert.ok(c.w >= 24, 'visible');
  d.net.block = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => document.querySelector('body > header .lp-chip').hidden, null, { timeout: 25000 });
  d.assertClean();
  await d.close();
});

// ----------------------------------------------------------------------------------------------- token contrast pairs
const parseTokens = (css, selectorStart) => {
  const i = css.indexOf(selectorStart);
  const block = css.slice(i, css.indexOf('}', i));
  const out = {};
  for (const m of block.matchAll(/(--lp-[\w-]+):\s*light-dark\(\s*(#[0-9a-fA-F]{6})\s*,\s*(#[0-9a-fA-F]{6})\s*\)/g)) out[m[1]] = { light: m[2], dark: m[3] };
  return out;
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const cr = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('token contrast pairs from css/main.css, all four schemes: text pairs >= 4.5, UI frames >= 3 (incl. the pairs PRISM flagged)', async () => {
  const css = fs.readFileSync(path.join(H.REPO, 'css/main.css'), 'utf8');
  const classic = parseTokens(css, ':root, [data-mode="classic"]');
  const blood = parseTokens(css, '[data-mode="blood"] {');
  assert.ok(Object.keys(classic).length > 15 && Object.keys(blood).length > 15, 'tokens parsed');
  const fails = [];
  const rows = [];
  for (const [mode, t] of [['classic', classic], ['blood', blood]]) {
    for (const scheme of ['dark', 'light']) {
      const v = (k) => (t[k] || classic[k])[scheme];
      const textPairs = [['text', 'bg-0'], ['text', 'bg-1'], ['text', 'bg-2'], ['text-dim', 'bg-0'], ['text-dim', 'bg-1'], ['text-dim', 'bg-2'], ['on-accent', 'accent'], ['accent-text', 'bg-0'], ['accent-text', 'bg-1'], ['ok', 'bg-1'], ['bad', 'bg-1'], ['info', 'bg-1'], ['on-danger', 'danger'], ['inv-text', 'inv-bg']];
      for (const [fg, bg] of textPairs) {
        if (!(`--lp-${fg}` in t || `--lp-${fg}` in classic) || !(`--lp-${bg}` in t || `--lp-${bg}` in classic)) continue;
        const r = cr(v(`--lp-${fg}`), v(`--lp-${bg}`));
        rows.push(`${mode}/${scheme} ${fg} on ${bg}: ${r.toFixed(2)}`);
        if (r < 4.5) fails.push(`${mode}/${scheme} ${fg} on ${bg} = ${r.toFixed(2)} < 4.5`);
      }
      // (filled amber/red buttons are bounded by fill and carry a 4.5:1 label; their rendered frames are measured by the matrix)
      for (const [fg, bg] of [['line', 'bg-0'], ['line', 'bg-1']]) {
        if (!(`--lp-${fg}` in t || `--lp-${fg}` in classic)) continue;
        const r = cr(v(`--lp-${fg}`), v(`--lp-${bg}`));
        rows.push(`${mode}/${scheme} ${fg} frame on ${bg}: ${r.toFixed(2)}`);
        if (r < 3) fails.push(`${mode}/${scheme} frame ${fg} on ${bg} = ${r.toFixed(2)} < 3`);
      }
    }
  }
  fs.mkdirSync(path.join(H.REPO, 'tests/e2e/shots'), { recursive: true });
  fs.writeFileSync(path.join(H.REPO, 'tests/e2e/shots/token-contrast.txt'), rows.join('\n'));
  assert.deepEqual(fails, []);
  // the specific pairs ATLAS asked about, pinned to the PRISM-reported values
  const pin = (label, a, b, min) => assert.ok(cr(a, b) >= min, `${label}: ${cr(a, b).toFixed(2)} >= ${min}`);
  pin('Blood light on-accent on accent', blood['--lp-on-accent'].light, blood['--lp-accent'].light, 5.3);
  pin('Blood dark accent-text on bg-1', blood['--lp-accent-text'].dark, blood['--lp-bg-1'].dark, 5.9);
  pin('Classic light text-dim on bg-0', classic['--lp-text-dim'].light, classic['--lp-bg-0'].light, 4.5);
  assert.equal(classic['--lp-text-dim'].light.toLowerCase(), '#374a40', 'the Classic-light dim text token is the ADR 0006 sage-palette value');
});

// ----------------------------------------------------------------------------------------------- zoom (DoD 4)
// 200% browser zoom on a 1280x800 window is a 640x400 CSS-px viewport at DPR 2; 400% is 320x200 at DPR 4 (WCAG 1.4.10).
// Content and function must survive: no control may be covered by another one, every control must be reachable.
for (const [w, h, dpr, label] of [[640, 400, 2, '200%'], [320, 200, 4, '400%']]) {
  test(`zoom ${label} (${w}x${h} @${dpr}x): on Play no control overlaps another and the page scrolls instead of clipping (DoD 4)`, async () => {
    const d = await dev({ viewport: { width: w, height: h }, dpr });
    const { page } = d;
    await H.signUp(d, 'Zoom Zed');
    await H.settleToast(page);
    await page.evaluate(() => { document.querySelector('#diff-master').click(); document.querySelector('main > [data-screen="home"] [data-action="play-classic"]').click(); });
    await page.waitForSelector(`${T} [data-slot="dials"] > button`, { state: 'attached' });
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => {
      const rr = (e) => e.getBoundingClientRect();
      const play = document.querySelector('main > [data-screen="play"]');
      const ctl = [...play.querySelectorAll('button')].filter((b) => rr(b).width > 0 && !b.closest('[hidden]'));
      const overlaps = [];
      for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
        const a = rr(ctl[i]); const b = rr(ctl[j]);
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 2 && iy > 2) overlaps.push(`${ctl[i].dataset.action || ctl[i].dataset.digit || ctl[i].dataset.dial} x ${ctl[j].dataset.action || ctl[j].dataset.digit || ctl[j].dataset.dial}`);
      }
      const clues = [...play.querySelectorAll('[data-slot="clues"] > li')].map(rr);
      const dock = [...play.querySelectorAll('[data-slot="dials"], [data-slot="keypad"], menu')].map(rr);
      const clueOverDock = clues.some((c) => dock.some((k) => Math.min(c.right, k.right) - Math.max(c.left, k.left) > 2 && Math.min(c.bottom, k.bottom) - Math.max(c.top, k.top) > 2));
      const clear = play.querySelector('[data-action="clear"]');
      clear.scrollIntoView({ block: 'center' });
      const q = rr(clear);
      const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, q.left + q.width / 2)), Math.min(innerHeight - 1, Math.max(0, q.top + q.height / 2)));
      return { overlaps, clueOverDock, clearHit: !!hit && (hit === clear || clear.contains(hit)), hscroll: document.documentElement.scrollWidth > innerWidth };
    });
    assert.deepEqual(r.overlaps, [], 'no two controls overlap');
    assert.equal(r.clueOverDock, false, 'clue rows do not sit on top of the dials/keypad/actions');
    assert.equal(r.clearHit, true, 'Clear can be hit once scrolled into view');
    assert.equal(r.hscroll, false, 'no horizontal scroll');
    await d.close();
  });
}
