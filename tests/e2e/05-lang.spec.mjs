// 3e. Language toggle EN <-> AR.
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

const html = (page) => page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title, btn: document.querySelector('header [data-action="lang"]').textContent.trim(), btnLang: document.querySelector('header [data-action="lang"]').lang }));
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const arabicIndic = (page) => page.evaluate(() => /[٠-٩۰-۹]/.test(document.body.innerText));

test('toggle flips lang/dir/title/label, keeps Latin digits, persists across reload, logout and a second device', async () => {
  const backend = H.createBackend();
  const d = await H.openDevice(br, { baseUrl: srv.url, backend, viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = d;
  await d.goto('');
  let h = await html(page);
  assert.deepEqual([h.lang, h.dir, h.btn, h.btnLang], ['en', 'ltr', 'العربية', 'ar']);
  assert.match(h.title, /^Welcome \| Lock Puzzle$/);
  const enH1 = await page.textContent('[data-screen="auth"] h1');

  await page.click('header [data-action="lang"]');
  await page.waitForFunction(() => document.documentElement.lang === 'ar');
  h = await html(page);
  assert.deepEqual([h.lang, h.dir, h.btn, h.btnLang], ['ar', 'rtl', 'English', 'en'], 'toggle names the language you will GET and carries that lang');
  assert.notEqual(await page.textContent('[data-screen="auth"] h1'), enH1, 'visible text really changed');
  assert.match(h.title, /[؀-ۿ]/, 'document title is translated');
  assert.equal(await noOverflow(page), true, 'no horizontal scroll in Arabic at 390');
  assert.equal(await page.evaluate(() => localStorage.getItem('lp1.lang')), 'ar');

  // sign up in Arabic, then check each screen for layout + digits
  const code = await H.signUp(d, 'Lang Lena').catch(async (e) => {
    throw e;
  });
  assert.equal((await html(page)).lang, 'ar', 'sign-up flow keeps the chosen language');
  assert.equal(await arabicIndic(page), false, 'Latin digits on home');
  await H.startClassic(page, 'hacker');
  assert.equal(await arabicIndic(page), false, 'Latin digits on play');
  const ltr = await page.evaluate(() => {
    const dir = (s) => getComputedStyle(document.querySelector(s)).direction;
    const xs = (s) => [...document.querySelectorAll(s)].map((b) => b.getBoundingClientRect().left);
    return {
      dials: dir('[data-slot="dials"]'),
      keypad: dir('[data-slot="keypad"]'),
      timer: dir('[data-out="timer"]'),
      dialX: xs('[data-slot="dials"] > button'),
      keyX: xs('[data-slot="keypad"] > button').slice(0, 3),
    };
  });
  assert.equal(ltr.dials, 'ltr', 'dial row stays LTR');
  assert.equal(ltr.keypad, 'ltr', 'keypad stays LTR');
  assert.equal(ltr.timer, 'ltr', 'timer stays LTR');
  assert.deepEqual(ltr.dialX, [...ltr.dialX].sort((a, b) => a - b), 'dial 1 is leftmost');
  assert.deepEqual(ltr.keyX, [...ltr.keyX].sort((a, b) => a - b), 'keypad 1,2,3 run left to right');
  assert.equal(await page.evaluate(() => document.querySelector('[data-slot="clues"]').closest('section') !== null && getComputedStyle(document.querySelector('[data-screen="play"] h1')).direction), 'rtl', 'prose is RTL');
  assert.equal(await noOverflow(page), true, 'no horizontal scroll on play in Arabic');

  // toggling mid-round keeps the typed digits and the round
  const p = await H.currentPuzzle(page);
  await page.click('[data-screen="play"] [data-action="clear"]');
  await page.click('[data-screen="play"] [data-digit="7"]');
  await page.click('[data-screen="play"] [data-digit="2"]');
  await page.click('header [data-action="lang"]');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  assert.deepEqual((await H.dialValues(page)).slice(0, 2), ['7', '2'], 'typed digits survive a language switch');
  assert.equal((await H.currentPuzzle(page)).id, p.id, 'same puzzle after switching language');
  assert.equal(await page.evaluate(() => document.activeElement.closest('[data-slot="dials"]') !== null || document.activeElement.dataset.action === 'lang'), true);
  await page.click('header [data-action="lang"]'); // back to ar
  await page.waitForFunction(() => document.documentElement.lang === 'ar');
  await H.solveClassic(page);
  assert.equal(await arabicIndic(page), false, 'Latin digits on result');
  await page.click('[data-screen="result"] [data-action="go-home"]');
  await d.waitScreen('home');
  await H.waitSynced(page);

  // persists across reload
  await page.reload();
  await d.booted();
  assert.equal((await html(page)).lang, 'ar');
  assert.equal((await html(page)).dir, 'rtl');
  // persists across logout (auth screen stays Arabic) and login
  await H.logout(d);
  assert.deepEqual([(await html(page)).lang, (await html(page)).dir], ['ar', 'rtl'], 'language is a device preference, not account data: it survives logout');
  assert.ok((await page.textContent('[data-screen="auth"] h1')) !== enH1);
  await H.signIn(d, 'Lang Lena', code);
  assert.equal((await html(page)).lang, 'ar', 'still Arabic after logout/login');
  // second device with an English browser picks the account's saved language up on sign-in
  await H.waitSynced(page);
  const b = await H.openDevice(br, { baseUrl: srv.url, backend, locale: 'en-US' });
  await b.goto('');
  assert.equal((await html(b.page)).lang, 'en');
  await H.signIn(b, 'Lang Lena', code);
  await b.page.waitForFunction(() => document.documentElement.lang === 'ar', null, { timeout: 8000 });
  assert.equal((await html(b.page)).dir, 'rtl', 'account language follows the player to a new device');
  d.assertClean();
  b.assertClean();
  await b.close();
  await d.close();
});

test('first paint: lang/dir are set by the inline script before main.js runs (stored choice, then navigator.language)', async () => {
  for (const [label, locale, stored, expected] of [['stored ar', 'en-US', 'ar', 'ar'], ['stored en beats ar browser', 'ar-SA', 'en', 'en'], ['ar browser, nothing stored', 'ar-SA', null, 'ar'], ['en browser', 'en-GB', null, 'en']]) {
    const d = await H.openDevice(br, { baseUrl: srv.url, backend: null, locale });
    if (stored) await d.context.addInitScript((v) => localStorage.setItem('lp1.lang', v), stored);
    // Hold the app module back: whatever <html> says now was decided by the inline script alone.
    let release;
    const gate = new Promise((r) => (release = r));
    await d.context.route('**/js/main.js', async (route) => {
      await gate;
      await route.continue();
    });
    // 'commit' + a parsed <main>: DOMContentLoaded itself waits for module scripts, which we are holding.
    await d.page.goto(srv.url, { waitUntil: 'commit' });
    await d.page.waitForSelector('main', { state: 'attached' });
    const seen = await d.page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
    assert.deepEqual(seen, { lang: expected, dir: expected === 'ar' ? 'rtl' : 'ltr' }, label);
    release();
    await d.booted();
    assert.equal((await html(d.page)).lang, expected, label + ' (after boot)');
    d.assertClean(label);
    await d.close();
  }
});

test('every screen in Arabic at 320px has no horizontal overflow and no Arabic-Indic digits', async () => {
  const backend = H.createBackend();
  const d = await H.openDevice(br, { baseUrl: srv.url, backend, viewport: { width: 320, height: 568 }, mobile: true, locale: 'ar-SA' });
  const { page } = d;
  await d.goto('');
  assert.equal((await html(page)).lang, 'ar');
  assert.equal(await noOverflow(page), true, 'auth');
  await H.signUp(d, 'عمر');
  assert.equal(await noOverflow(page), true, 'home');
  await page.click('[data-screen="home"] [data-action="show-help"]');
  await d.waitScreen('help');
  assert.equal(await noOverflow(page), true, 'help');
  await page.click('[data-screen="help"] [data-action="back"]');
  await d.waitScreen('home');
  await page.click('[data-screen="home"] [data-action="show-board"]');
  await d.waitScreen('board');
  assert.equal(await noOverflow(page), true, 'board');
  await page.click('[data-screen="board"] [data-action="back"]');
  await H.startClassic(page, 'master');
  assert.equal(await noOverflow(page), true, 'play 5 dials');
  assert.equal(await arabicIndic(page), false);
  d.assertClean();
  await d.close();
});
