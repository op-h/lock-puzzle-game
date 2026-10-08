// 3i. Keyboard end to end: tab order == visual order, visible focus ring, focus never obscured (sticky header/dock),
// no traps, dialog Esc rules + focus return, hardware keys on Play, RTL arrows, skip link.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './support/harness.mjs';
import { tabWalk, readingOrderViolations, judgeWalk } from './support/audit.mjs';

let srv;
let br;
const obscuredAll = []; // WCAG 2.4.11 findings, asserted by the last test so one defect does not hide the rest
before(async () => {
  srv = await H.startServer();
  br = await H.launchBrowser();
});
after(async () => {
  await br.close();
  await srv.close();
});

const VIEWPORTS = [
  { name: '320x568', viewport: { width: 320, height: 568 }, mobile: true },
  { name: '390x844', viewport: { width: 390, height: 844 }, mobile: true },
  { name: '1280x800', viewport: { width: 1280, height: 800 }, mobile: false },
];
const active = (page) => page.evaluate(() => document.activeElement.dataset.action || document.activeElement.id || document.activeElement.tagName);

for (const vp of VIEWPORTS) {
  for (const lang of ['en', 'ar']) {
    test(`tab order, focus ring and focus visibility on every screen @ ${vp.name} ${lang}`, async () => {
      const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend(), viewport: vp.viewport, mobile: vp.mobile, locale: lang === 'ar' ? 'ar-SA' : 'en-US' });
      const { page } = d;
      const report = {};
      const audit = async (screen, { signin = false } = {}) => {
        const stops = await tabWalk(page);
        const real = stops.filter((s) => !s.body && !s.wrapped);
        const probs = judgeWalk(stops, { obscured: false });
        obscuredAll.push(...judgeWalk(stops).filter((p) => !probs.includes(p)).map((p) => `${vp.name} ${lang} ${screen}: ${p}`));
        const order = await readingOrderViolations(page, stops);
        report[screen] = { stops: real.length, probs, order };
        // no trap: the walk must wrap/leave the page, never loop on a subset
        assert.ok(stops.some((s) => s.wrapped || s.body), `${screen}: Tab leaves/wraps (no trap), got ${real.length} stops`);
        assert.deepEqual(probs, [], `${vp.name} ${lang} ${screen}`);
        assert.deepEqual(order, [], `${vp.name} ${lang} ${screen}: Tab order differs from visual order`);
        // reverse walk visits the same set
        const back = (await tabWalk(page, { reverse: true })).filter((s) => !s.body && !s.wrapped);
        const nm = (l) => l.map((s) => s.sig.split('#')[0]).sort();
        assert.deepEqual(nm(back), nm(real), `${screen}: Shift+Tab reaches the same controls`);
        await page.evaluate(() => document.querySelectorAll('[data-ts]').forEach((e) => e.removeAttribute('data-ts')));
      };

      await d.goto('');
      await audit('auth-signup');
      await page.click('[data-action="show-signin"]');
      await audit('auth-signin');
      await page.click('[data-action="show-signup"]');
      await H.signUp(d, 'Key Kim');
      await audit('home');
      await H.startClassic(page, 'master');
      await audit('play-classic-5');
      await H.solveClassic(page);
      await H.waitSynced(page);
      await audit('result-classic');
      await page.click('[data-screen="result"] [data-action="go-home"]');
      await d.waitScreen('home');
      await page.click('[data-screen="home"] [data-action="show-board"]');
      await d.waitScreen('board');
      await page.waitForSelector('[data-slot="board-rows"] tr');
      await audit('board');
      await page.click('[data-screen="board"] [data-action="back"]');
      await d.waitScreen('home');
      await page.click('[data-screen="home"] [data-action="show-help"]');
      await d.waitScreen('help');
      await audit('help');
      await page.click('[data-screen="help"] [data-action="back"]');
      await d.waitScreen('home');
      await H.startBlood(page);
      await audit('play-blood');
      await H.quitRound(page);
      await d.waitScreen('home');
      d.assertClean();
      await d.close();
    });
  }
}

test('skip link: first Tab, visible, jumps to main without navigating away', async () => {
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend(), viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = d;
  await d.goto('');
  await page.keyboard.press('Tab');
  const s = await page.evaluate(() => {
    const a = document.activeElement;
    const r = a.getBoundingClientRect();
    return { cls: a.className, text: a.textContent.trim(), top: r.top, bottom: r.bottom, href: a.getAttribute('href') };
  });
  assert.equal(s.cls, 'skip-link');
  assert.ok(s.top >= 0 && s.bottom > 0, 'skip link is on screen when focused');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main', 'focus moved to <main>');
  assert.equal(await d.screen(), 'auth', 'the router did not treat #main as a screen');
  assert.equal(await page.evaluate(() => location.hash), '#main');
  d.assertClean();
  await d.close();
});

test('dialogs: Esc rules, focus returns to the trigger, no trap (logout + quit + code)', async () => {
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend(), viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = d;
  await H.signUp(d, 'Dialog Dan');
  // logout dialog opened from the account menu
  await page.focus('header details[data-account] > summary');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.querySelector('header details[data-account]').open), true, 'Enter opens the account disclosure');
  await page.keyboard.press('Tab');
  assert.equal(await active(page), 'logout');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[data-dialog="confirm-logout"][open]');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog[data-dialog="confirm-logout"]')), true, 'focus moved into the dialog');
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[data-dialog="confirm-logout"]:not([open])', { state: 'attached' });
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'logout', 'focus returns to the control that opened it');
  assert.equal(await d.screen(), 'home', 'Esc cancels logout');
  // "Stay Signed In" closes and returns focus too
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[data-dialog="confirm-logout"][open]');
  await page.click('dialog[data-dialog="confirm-logout"] button[value="cancel"]');
  await page.waitForSelector('dialog[data-dialog="confirm-logout"]:not([open])', { state: 'attached' });
  assert.equal(await d.screen(), 'home');
  // keyboard path through the quit dialog
  await H.startClassic(page, 'rookie');
  await page.focus('[data-screen="play"] [data-action="quit"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[data-dialog="confirm-quit"][open]');
  const cycle = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    cycle.push(await page.evaluate(() => (document.activeElement.closest('dialog') ? document.activeElement.textContent.trim() : 'OUTSIDE:' + document.activeElement.tagName)));
  }
  assert.ok(cycle.every((c) => !c.startsWith('OUTSIDE:') || c === 'OUTSIDE:BODY'), `focus never lands on the inert page: ${cycle}`);
  assert.ok(cycle.includes('Keep Playing') && cycle.includes('Quit Round'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[data-dialog="confirm-quit"]:not([open])', { state: 'attached' });
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'quit');
  assert.equal(await d.screen(), 'play', 'Esc keeps the round');
  d.assertClean();
  await d.close();
});

test('play: hardware keyboard digits, Backspace, Delete, arrows, Enter; Escape never destroys the round', async () => {
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend() });
  const { page } = d;
  await H.signUp(d, 'Typist');
  await H.startClassic(page, 'hacker'); // 4 dials
  const sel = () => page.$$eval('[data-screen="play"] [data-slot="dials"] > button', (bs) => bs.findIndex((b) => b.dataset.state === 'selected'));
  const vals = () => H.dialValues(page);
  const p = await H.currentPuzzle(page);
  assert.equal(await sel(), 0, 'first dial selected initially');
  await page.keyboard.press('7');
  assert.deepEqual(await vals(), ['7', '', '', ''], 'digit fills the selected dial');
  assert.equal(await sel(), 1, 'and auto-advances');
  await page.keyboard.press('3');
  await page.keyboard.press('Backspace');
  assert.deepEqual(await vals(), ['7', '', '', ''], 'Backspace clears the current/previous dial');
  await page.keyboard.press('ArrowRight');
  assert.equal(await sel(), 2, 'ArrowRight moves one dial right');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.dial === undefined ? 'not on dial' : 'dial'), 'not on dial', 'focus is not forced onto a dial when the key came from elsewhere');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft'); // clamps at the first dial
  assert.equal(await sel(), 0);
  await page.keyboard.press('Delete');
  assert.deepEqual(await vals(), ['', '', '', '']);
  // focus a dial then arrow: focus follows (roving tabindex)
  await page.focus('[data-screen="play"] [data-slot="dials"] > button[tabindex="0"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.dial), '1', 'on a dial, arrows move focus with the selection');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-screen="play"] [data-slot="dials"] > button')].map((b) => b.tabIndex).join()), '-1,0,-1,-1', 'roving tabindex: one tab stop in the row');
  // keypad key shows pressed state while the hardware key is down
  await page.keyboard.down('5');
  assert.equal(await page.evaluate(() => document.querySelector('[data-digit="5"]').hasAttribute('data-pressed')), true);
  await page.keyboard.up('5');
  assert.equal(await page.evaluate(() => document.querySelector('[data-digit="5"]').hasAttribute('data-pressed')), false);
  await page.click('[data-screen="play"] [data-action="clear"]');
  // incomplete + Enter (from a dial): told to fill every dial
  await page.focus('[data-screen="play"] [data-slot="dials"] > button[tabindex="0"]');
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Fill every dial/.test(document.querySelector('[data-screen="play"] [data-out="msg"]').textContent));
  // a wrong full guess + Enter checks it
  await page.click('[data-screen="play"] [data-action="clear"]');
  await page.focus('[data-screen="play"] [data-slot="dials"] > button[tabindex="0"]');
  for (const g of H.wrongGuess(p.answer, 0)) await page.keyboard.press(String(g));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Wrong guesses: 1/.test(document.querySelector('[data-screen="play"] [data-out="msg"]').textContent));
  // Escape on the play screen does nothing destructive
  await page.keyboard.press('Escape');
  assert.equal(await d.screen(), 'play');
  assert.equal((await H.currentPuzzle(page)).id, p.id);
  // Enter on a focused button activates THAT button (Clear), it does not also submit
  await page.focus('[data-screen="play"] [data-action="clear"]');
  await page.keyboard.press('Enter');
  assert.deepEqual(await vals(), ['', '', '', ''], 'Enter on Clear clears');
  assert.equal(await page.locator('[data-screen="play"] [data-slot="attempts"] li').count(), 1, 'and did not submit a guess');
  // solve entirely by keyboard
  await page.focus('[data-screen="play"] [data-slot="dials"] > button[tabindex="0"]');
  for (const g of p.answer) await page.keyboard.press(String(g));
  await page.keyboard.press('Enter');
  await d.waitScreen('result');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'result-title', 'focus moves to the result heading');
  // digits are ignored while typing in a form field (sign-in on auth)
  d.assertClean();
  await d.close();
});

test('play in Arabic: dial row is LTR so ArrowRight still moves to the visually right dial', async () => {
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend(), locale: 'ar-SA' });
  const { page } = d;
  await H.signUp(d, 'مفاتيح');
  await H.startClassic(page, 'master');
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  const sel = () => page.$$eval('[data-screen="play"] [data-slot="dials"] > button', (bs) => bs.findIndex((b) => b.dataset.state === 'selected'));
  const lefts = await page.$$eval('[data-screen="play"] [data-slot="dials"] > button', (bs) => bs.map((b) => b.getBoundingClientRect().left));
  assert.deepEqual(lefts, [...lefts].sort((a, b) => a - b));
  await page.keyboard.press('ArrowRight');
  assert.equal(await sel(), 1, 'ArrowRight -> next dial to the right');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await sel(), 0);
  await page.keyboard.press('4');
  assert.deepEqual((await H.dialValues(page)).slice(0, 2), ['4', ''], 'Latin digits typed on an Arabic page');
  d.assertClean();
  await d.close();
});

test('form fields: digits typed into the sign-in code box are not hijacked by Play handlers; Enter submits the form', async () => {
  const backend = H.createBackend();
  const a = await H.openDevice(br, { baseUrl: srv.url, backend });
  const code = await H.signUp(a, 'Enter Eve');
  await H.waitSynced(a.page);
  const d = await H.openDevice(br, { baseUrl: srv.url, backend });
  await d.goto('');
  await d.page.click('[data-action="show-signin"]');
  await d.page.focus(H.q.signinName);
  await d.page.keyboard.type('Enter Eve');
  await d.page.keyboard.press('Tab');
  await d.page.keyboard.type(code);
  assert.equal((await d.page.inputValue(H.q.signinCode)), code);
  await d.page.keyboard.press('Enter');
  await d.waitScreen('home');
  a.assertClean();
  d.assertClean();
  await a.close();
  await d.close();
});

test('WCAG 2.4.11 focus not obscured: no tab stop is hidden under the sticky header, dock or a toast (all screens, 320/390/1280, en+ar)', async () => {
  assert.deepEqual(obscuredAll, []);
});
