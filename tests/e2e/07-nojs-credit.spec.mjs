// 3g + 3h. JavaScript disabled (ADR 0001 app-shell compensation) and the maker credit on every screen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './support/harness.mjs';

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

const visibleControls = (page) =>
  page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden]') && cs.clipPath === 'none';
    };
    return [...document.querySelectorAll('button, input, select, textarea, form, summary')].filter(vis).map((e) => `${e.tagName.toLowerCase()}${e.dataset.action ? '[' + e.dataset.action + ']' : ''}`);
  });

for (const motion of ['no-preference', 'reduce']) {
  for (const scheme of ['dark', 'light']) {
    test(`JS off (${motion}, ${scheme}): rules + credit visible, one h1, no dead forms, zero console errors`, async () => {
      const d = await H.openDevice(br, { baseUrl: srv.url, backend: null, js: false, media: { motion, scheme }, viewport: { width: 390, height: 844 }, mobile: true });
      const { page } = d;
      await page.goto(srv.url, { waitUntil: 'load' });
      await page.waitForTimeout(3500); // past the 3 s boot fail-safe: nothing may change under the visitor
      await H.pinMedia(page, { motion, scheme });
      const info = await page.evaluate(() => {
        const vis = (e) => {
          const r = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
        };
        const h1s = [...document.querySelectorAll('h1')].filter(vis);
        const ns = document.querySelector('main noscript');
        const text = (document.querySelector('main') || {}).innerText || '';
        return {
          h1: h1s.map((h) => h.textContent.trim()),
          scripting: matchMedia('(scripting: none)').matches,
          noscriptSectionVisible: !!ns && vis(ns.querySelector('section')),
          h2: [...document.querySelectorAll('main noscript h2')].filter(vis).map((h) => h.textContent.trim()),
          dl: [...document.querySelectorAll('main noscript dt')].filter(vis).length,
          example: /184/.test(text),
          credit: [...document.querySelectorAll('a[href="https://github.com/op-h"]')].filter(vis).map((a) => ({ rel: a.rel, text: a.textContent.trim(), inNoscript: !!a.closest('noscript') })),
          overflow: document.documentElement.scrollWidth > innerWidth,
          authVisible: [...document.querySelectorAll('[data-screen]')].filter(vis).map((s) => s.dataset.screen),
          bg: getComputedStyle(document.body).backgroundColor,
          fg: getComputedStyle(document.querySelector('main noscript h1')).color,
          title: document.title,
        };
      });
      assert.equal(info.scripting, true, 'emulation really has scripting disabled');
      assert.deepEqual(info.h1, ['This game needs JavaScript to play'], 'exactly one visible h1');
      assert.equal(info.noscriptSectionVisible, true);
      assert.deepEqual(info.h2, ['The Goal', 'Reading the Clues', 'Worked Example', 'Scoring', 'Blood Mode']);
      assert.equal(info.dl, 5, 'five clue kinds explained');
      assert.equal(info.example, true, 'worked example (answer 184) readable');
      assert.deepEqual(info.authVisible, [], 'no app screen (dead form) is visible');
      assert.equal(info.overflow, false);
      // F-02 fix: with JS off the footer is hidden too, so exactly ONE credit (the <noscript> one) is visible
      assert.equal(info.credit.length, 1, `exactly one visible credit, got ${JSON.stringify(info.credit)}`);
      assert.equal(info.credit[0].text, 'OPH');
      assert.match(info.credit[0].rel, /noopener/);
      assert.equal(info.credit[0].inNoscript, true, 'the visible credit is the <noscript> one');
      assert.match(info.title, /Lock Puzzle/);
      await page.screenshot({ path: new URL(`./shots/nojs-${motion}-${scheme}.png`, import.meta.url).pathname, fullPage: true }).catch(() => {});
      d.assertClean();
      await d.close();
    });
  }
}

// F-02 (fixed): JS off hides the header buttons, the status chip, the account menu and the footer; nothing dead is shown.
test('JS off: no dead buttons or forms are visible anywhere (header included)', async () => {
  for (const motion of ['no-preference', 'reduce']) {
    const d = await H.openDevice(br, { baseUrl: srv.url, backend: null, js: false, media: { motion, scheme: 'dark' } });
    await d.page.goto(srv.url, { waitUntil: 'load' });
    const controls = await visibleControls(d.page);
    assert.deepEqual(controls, [], `${motion}: dead controls visible with JS off: ${controls.join(', ')}`);
    const chip = await d.page.evaluate(() => { const c = document.querySelector('header .lp-chip'); const r = c.getBoundingClientRect(); const cs = getComputedStyle(c); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 1; });
    assert.equal(chip, false, 'the empty status chip is hidden too');
    await d.close();
  }
});

test('JS on but the app module fails to load: the fail-safe reveals the page after ~3 s (documented degrade)', async () => {
  for (const motion of ['no-preference', 'reduce']) {
    const d = await H.openDevice(br, { baseUrl: srv.url, backend: null, media: { motion, scheme: 'dark' }, allow: [/main\.js|ERR_FAILED|net::ERR|Failed to load resource/] });
    await d.context.route('**/js/main.js', (r) => r.abort('failed'));
    await d.page.goto(srv.url, { waitUntil: 'load' });
    const hiddenAt0 = await d.page.evaluate(() => getComputedStyle(document.querySelector('[data-screen="auth"]')).visibility);
    await d.page.waitForTimeout(3600);
    const after = await d.page.evaluate(() => ({ vis: getComputedStyle(document.querySelector('[data-screen="auth"]')).visibility, display: getComputedStyle(document.querySelector('[data-screen="auth"]')).display }));
    assert.equal(hiddenAt0, 'hidden', `${motion}: screens are held back while booting`);
    assert.equal(after.vis, 'visible', `${motion}: fail-safe reveals the page even with prefers-reduced-motion`);
    assert.notEqual(after.display, 'none', `${motion}: the auth form is shown (dead: there is no error message)`);
    await d.close();
  }
});

test('credit "Made by OPH" links to github.com/op-h with rel=noopener on every screen, reachable by keyboard', async () => {
  const backend = H.createBackend();
  const d = await H.openDevice(br, { baseUrl: srv.url, backend, viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = d;
  const credit = () =>
    page.evaluate(() => {
      const a = document.querySelector('footer [data-credit] a');
      const r = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      const footer = document.querySelector('footer');
      return {
        href: a.getAttribute('href'),
        rel: a.rel,
        text: a.textContent.trim(),
        before: footer.querySelector('[data-credit]').textContent.replace(/\s+/g, ' ').trim(),
        translate: a.getAttribute('translate'),
        w: r.width,
        h: r.height,
        display: cs.display,
        visible: r.width > 0 && r.height > 0 && cs.visibility === 'visible' && !footer.closest('[hidden]'),
        target: a.getAttribute('target'),
      };
    });
  const check = async (screen) => {
    const c = await credit();
    assert.equal(c.href, 'https://github.com/op-h', screen);
    assert.match(c.rel, /\bnoopener\b/, screen);
    assert.equal(c.text, 'OPH');
    assert.equal(c.before, 'Made by OPH', screen);
    assert.equal(c.visible, true, screen);
    assert.ok(c.h >= 44 && c.w >= 44, `${screen}: credit target ${c.w}x${c.h} >= 44`);
    assert.equal(c.target, null, 'opens in the same tab (rel=noopener is belt and braces)');
  };
  await d.goto('');
  await check('auth');
  await page.click('[data-screen="auth"] [data-action="show-help"]');
  await d.waitScreen('help');
  await check('help (signed out)');
  await H.signUp(d, 'Credit Cat');
  await check('home');
  await H.startClassic(page, 'rookie');
  await check('play');
  await H.solveClassic(page);
  await check('result');
  await page.click('[data-screen="result"] [data-action="go-home"]');
  await page.click('[data-screen="home"] [data-action="show-board"]');
  await d.waitScreen('board');
  await check('board');
  await page.click('[data-screen="board"] [data-action="back"]');
  await page.click('[data-screen="home"] [data-action="show-help"]');
  await d.waitScreen('help');
  await check('help');
  // in Arabic the word OPH stays Latin and un-translated
  await page.click('header [data-action="lang"]');
  await page.waitForFunction(() => document.documentElement.lang === 'ar');
  const ar = await credit();
  assert.equal(ar.text, 'OPH');
  assert.equal(ar.translate, 'no');
  assert.notEqual(ar.before, 'Made by OPH', 'the sentence is translated, the name is not');
  // keyboard: the link is a tab stop and can be activated with Enter (open-in-new-page is blocked: assert the request)
  await page.focus('footer [data-credit] a');
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'A');
  d.assertClean();
  await d.close();
});
