// ADR 0006: floating keypad switched by the lock, descriptions on demand, avatar colour, equal icon tiles, auth heading.
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

const dev = (o = {}) => H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend(), ...o });
const T = 'main > [data-screen="play"]';
const PAD = '#play-pad';
const LOCK = `${T} [data-action="toggle-pad"]`;
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); const c = getComputedStyle(e); return c.visibility !== 'hidden' && Number(c.opacity) > 0.99 && e.getBoundingClientRect().height > 0; }, sel);

test('auth: the heading is just "Lock Game" and no sentence explains sign-in', async () => {
  const d = await dev({ viewport: { width: 390, height: 844 }, mobile: true });
  await d.goto('');
  const r = await d.page.evaluate(() => {
    const sec = document.querySelector('main > [data-screen="auth"]');
    const shown = [...sec.querySelectorAll('h1, p, label, button')].filter((e) => e.getClientRects().length && getComputedStyle(e).clip !== 'rect(0px, 0px, 0px, 0px)' && e.getBoundingClientRect().width > 2).map((e) => e.textContent.trim()).filter(Boolean);
    return { h1: sec.querySelector('h1').textContent.trim(), shown, title: document.title };
  });
  assert.equal(r.h1, 'Lock Game');
  assert.ok(!/welcome/i.test(r.title) && !/welcome/i.test(r.h1));
  assert.ok(!r.shown.some((t) => /nickname\.|6-digit|continue on/i.test(t)), `no explanatory sentence on screen: ${JSON.stringify(r.shown)}`);
  await d.close();
});

test('the lock shows and hides the floating keypad; it is see-through; hidden means inert; a hardware digit brings it back', async () => {
  const d = await dev({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = d;
  await H.signUp(d, 'Pad Pia');
  await H.settleToast(page);
  await H.startClassic(page, 'master');
  assert.equal(await page.getAttribute(LOCK, 'aria-expanded'), 'true');
  assert.equal(await visible(page, PAD), true, 'open at the start of a round');
  const bg = await page.evaluate((s) => { const c = getComputedStyle(document.querySelector(s)); return { bg: c.backgroundColor, blur: c.backdropFilter || c.webkitBackdropFilter, pos: c.position }; }, PAD);
  assert.equal(bg.pos, 'fixed');
  assert.match(bg.bg, /^rgba\(.*0?\.\d+\)$|^color\(.*\/ 0?\.\d+\)$/, `panel background is translucent: ${bg.bg}`);
  assert.match(bg.blur, /blur/);
  await page.click(LOCK);
  assert.equal(await page.getAttribute(LOCK, 'aria-expanded'), 'false');
  await page.waitForTimeout(400);
  assert.equal(await visible(page, PAD), false);
  assert.equal(await page.evaluate((s) => document.querySelector(s).inert, PAD), true, 'inert while hidden');
  // the 2 s bubble names the next action
  assert.equal((await page.textContent(`${LOCK} .lp-tip`)).trim(), 'Show keypad');
  assert.equal(await visible(page, `${LOCK} .lp-tip`), true);
  await page.waitForTimeout(2400);
  assert.equal(await visible(page, `${LOCK} .lp-tip`), false, 'bubble goes away after about 2 s');
  // a digit from the keyboard re-opens it and is typed
  await page.keyboard.press('7');
  await page.waitForTimeout(400);
  assert.equal(await page.getAttribute(LOCK, 'aria-expanded'), 'true');
  assert.equal(await visible(page, PAD), true);
  assert.equal((await H.dialValues(page))[0], '7');
  // the clue list can always be scrolled clear of the open panel
  const clear = await page.evaluate(() => {
    const list = document.querySelector('[data-slot="clues"]');
    list.scrollTop = list.scrollHeight;
    const last = list.lastElementChild.getBoundingClientRect();
    const pad = document.querySelector('#play-pad').getBoundingClientRect();
    return last.bottom <= pad.top + 1;
  });
  assert.equal(clear, true, 'last clue ends above the panel');
  d.assertClean && d.assertClean();
  await d.close();
});

test('descriptions: hidden until hover; a touch hold shows one for 2 s and does not start the game', async () => {
  // mouse: hover reveals the subline
  let d = await dev({ viewport: { width: 390, height: 844 } });
  let { page } = d;
  await H.signUp(d, 'Tip Tom');
  await H.settleToast(page);
  const sub = 'main > [data-screen="home"] [data-action="play-classic"] .lp-btn__sub';
  const h = () => page.evaluate((s) => { const e = document.querySelector(s); const c = getComputedStyle(e); return { op: Number(c.opacity), mh: e.getBoundingClientRect().height }; }, sub);
  await page.waitForTimeout(300);
  let x = await h();
  assert.equal(x.op, 0, 'hidden at rest');
  assert.ok((await page.textContent(sub)).trim().length > 0, 'still in the DOM / accessibility tree');
  await page.hover('main > [data-screen="home"] [data-action="play-classic"]');
  await page.waitForTimeout(400);
  x = await h();
  assert.equal(x.op, 1, 'visible on hover');
  await d.close();

  // touch: press and hold ~0.5 s
  d = await dev({ viewport: { width: 390, height: 844 }, mobile: true });
  page = d.page;
  await H.signUp(d, 'Hold Hal');
  await H.settleToast(page);
  const btn = 'main > [data-screen="home"] [data-action="play-classic"]';
  // A raw touch is hit-tested against the ::view-transition overlay until the screen change has finished; wait it out.
  await page.waitForFunction(() => !document.getAnimations().some((a) => String(a.effect && a.effect.pseudoElement).includes('view-transition')));
  const box = await page.locator(btn).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: cx, y: cy }] });
  await touch('touchStart');
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate((b) => document.querySelector(b).hasAttribute('data-tip-on'), btn), true, 'description shown while held');
  await touch('touchEnd');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.body.dataset.screen), 'home', 'a peek never starts a round');
  await page.waitForTimeout(2300);
  assert.equal(await page.evaluate((b) => document.querySelector(b).hasAttribute('data-tip-on'), btn), false, 'gone after about 2 s');
  // a plain tap still starts the round
  await page.tap(btn);
  await page.waitForSelector(`${T}:not([hidden])`);
  await d.close();
});

test('avatar colour: derived from the account, same on a second device, different per account, removed at logout', async () => {
  const backend = H.createBackend();
  const colour = (page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--lp-user').trim());
  const painted = (page) => page.evaluate(() => getComputedStyle(document.querySelector('body > header summary .lp-avatar use')).fill || '');
  const a = await H.openDevice(br, { baseUrl: srv.url, backend, viewport: { width: 390, height: 844 } });
  const codeA = await H.signUp(a, 'Hue Hana');
  await H.waitSynced(a.page);
  const ca = await colour(a.page);
  assert.match(ca, /^hsl\(\d+ \d+% \d+%\)$/);
  const fill = await a.page.evaluate(() => { const u = document.querySelector('body > header summary .lp-avatar'); return getComputedStyle(u).getPropertyValue('--lp-user').trim(); });
  assert.equal(fill, ca, 'the user icon inherits the colour');
  // second device, same account
  const b = await H.openDevice(br, { baseUrl: srv.url, backend, viewport: { width: 390, height: 844 } });
  await H.signIn(b, 'Hue Hana', codeA);
  assert.equal(await colour(b.page), ca, 'every device shows the same colour');
  // another account differs
  const c = await H.openDevice(br, { baseUrl: srv.url, backend, viewport: { width: 390, height: 844 } });
  await H.signUp(c, 'Hue Hugo');
  assert.notEqual(await colour(c.page), ca);
  // logout clears it
  await H.logout(a);
  assert.equal(await colour(a.page), '');
  void painted;
  await a.close(); await b.close(); await c.close();
});

for (const [w, h, lang] of [[320, 568, 'en'], [390, 844, 'en'], [320, 568, 'ar']]) {
  test(`header icon tiles are identical boxes on one row @ ${w}x${h} ${lang}, even with the sync chip showing`, async () => {
    const d = await dev({ viewport: { width: w, height: h }, mobile: true, locale: lang === 'ar' ? 'ar-SA' : 'en-US' });
    const { page } = d;
    await H.signUp(d, 'Box Bea');
    await H.settleToast(page);
    await page.evaluate(() => { document.querySelector('body > header .lp-chip').hidden = false; });
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const hd = document.querySelector('body > header');
      const hr = hd.getBoundingClientRect();
      const tiles = [...hd.querySelectorAll(':scope > .lp-iconbtn, :scope > .lp-chip, :scope > details > summary')].filter((e) => e.getClientRects().length);
      return {
        sizes: tiles.map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)].join('x'); }),
        tops: new Set(tiles.map((e) => Math.round(e.getBoundingClientRect().top))).size,
        inside: tiles.every((e) => { const b = e.getBoundingClientRect(); return b.top >= hr.top && b.bottom <= hr.bottom && b.left >= 0 && b.right <= innerWidth; }),
        count: tiles.length,
        hscroll: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.ok(r.count >= 6, 'sound, language, help, board, account and the chip');
    assert.deepEqual([...new Set(r.sizes)], ['44x44'], `every tile is 44x44: ${r.sizes}`);
    assert.equal(r.tops, 1, 'one row');
    assert.equal(r.inside, true, 'nothing leaves the header or the screen');
    assert.equal(r.hscroll, false);
    await d.close();
  });
}
