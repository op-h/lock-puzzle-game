// 3a. Sign-up -> code dialog -> home, resume, logout, second device, wrong code, injection, Arabic.
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

const dev = (backend, o = {}) => H.openDevice(br, { baseUrl: srv.url, backend, ...o });

test('sign-up: code dialog is modal, not dismissable until acknowledged, code is 6 digits and formatted', async () => {
  const backend = H.createBackend();
  const d = await dev(backend);
  const { page } = d;
  await d.goto('');
  assert.equal(await d.screen(), 'auth');
  await page.fill(H.q.signupName, 'Alice');
  await page.click(H.q.signupSubmit);
  await page.waitForSelector(`${H.q.codeDialog}[open]`);

  const shown = (await page.textContent(`${H.q.codeDialog} [data-out="code"]`)).trim();
  assert.match(shown, /^\d{3} \d{3}$/, 'code is formatted "123 456"');
  assert.equal(shown.replace(' ', '').length, 6);

  // Continue is disabled until the box is ticked.
  assert.equal(await page.isDisabled(`${H.q.codeDialog} [data-action="ack-code"]`), true);
  // Esc (twice: Chrome lets a second Esc through a cancelled dialog) must not dismiss it.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.querySelector('dialog[data-dialog="code"]').open), true, 'dialog survives Esc');
  // Clicking the backdrop must not dismiss it either.
  await page.mouse.click(2, 2);
  assert.equal(await page.evaluate(() => document.querySelector('dialog[data-dialog="code"]').open), true, 'dialog survives backdrop click');
  // The one-time code must be protected from an accidental tab close.
  const prevented = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  assert.equal(prevented, true, 'beforeunload guard is armed while the code is on screen');
  // The page behind the modal is inert: Tab cannot leave the dialog.
  // (BODY = focus handed to the browser chrome, which is how a native modal wraps; never an element behind it.)
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    seen.add(await page.evaluate(() => (document.activeElement.closest('dialog') ? 'dialog' : document.activeElement.tagName)));
  }
  assert.ok([...seen].every((x) => x === 'dialog' || x === 'BODY'), `focus never reaches the inert page behind the modal: ${[...seen]}`);
  assert.ok(seen.has('dialog'));
  assert.equal(await d.screen(), 'auth', 'router stays on auth while the code is shown');

  await page.check('#code-ack');
  assert.equal(await page.isDisabled(`${H.q.codeDialog} [data-action="ack-code"]`), false);
  await page.click(`${H.q.codeDialog} [data-action="ack-code"]`);
  await d.waitScreen('home');
  assert.equal(await page.evaluate(() => document.querySelector('dialog[data-dialog="code"]').open), false);
  assert.equal(await page.textContent(`${H.q.codeDialog} [data-out="code"]`, { strict: false }), '------', 'code wiped from the DOM after ack');
  // The code is a credential: not in storage, not in any backend document.
  const code = shown.replace(' ', '');
  const store = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  assert.ok(!store.includes(code), 'code is never stored on the device');
  const docs = JSON.stringify([...backend.docs.values()]);
  assert.ok(!docs.includes(code), 'code is never sent to the backend');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.closest('[data-screen]')?.dataset.screen), 'home', 'focus lands in the home screen');
  await H.waitStatus(page, 'Synced');
  const players = [...backend.docs.keys()].filter((k) => k.startsWith('players/'));
  assert.equal(players.length, 1);
  assert.deepEqual(Object.keys(backend.docs.get(players[0]).fields).sort(), ['save', 'v'], 'document has exactly {v, save}');
  assert.match(players[0], /^players\/[0-9a-f]{64}$/);
  d.assertClean();
  await d.close();
});

test('sign-up validation: empty and over-long names get a role=alert message and aria-invalid', async () => {
  const d = await dev(H.createBackend());
  const { page } = d;
  await d.goto('');
  await page.click(H.q.signupSubmit);
  assert.match(await page.textContent('#signup-error'), /Enter a player name/);
  assert.equal(await page.getAttribute(H.q.signupName, 'aria-invalid'), 'true');
  assert.equal(await page.getAttribute('#signup-error', 'role'), 'alert');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'signup-name', 'focus moves to the offending field');
  // fill() honours maxlength like typing; set the value directly to model a paste that bypassed it.
  await page.evaluate((sel) => {
    document.querySelector(sel).value = 'x'.repeat(21);
  }, H.q.signupName);
  await page.click(H.q.signupSubmit);
  assert.match(await page.textContent('#signup-error'), /too long/i);
  d.assertClean();
  await d.close();
});

test('reload resumes the session; logout returns to auth and wipes the account from the device', async () => {
  const backend = H.createBackend();
  const d = await dev(backend);
  const { page } = d;
  await H.signUp(d, 'Resume Me');
  await H.waitStatus(page);
  await page.reload();
  await d.booted();
  assert.equal(await d.screen(), 'home', 'reload lands on home, not auth');
  assert.equal(await page.textContent('header [data-account] [data-out="name"]'), 'Resume Me');
  await d.goto(''); // direct navigation to the entry URL also resumes
  assert.equal(await d.screen(), 'home');
  await H.logout(d);
  assert.equal(await d.screen(), 'auth');
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  assert.ok(keys.every((k) => k === 'lp1.lang' || k === 'lp1.pref'), `only non-account prefs remain after logout, got ${keys}`);
  assert.equal(await page.isHidden('header details[data-account]'), true, 'account menu hidden when signed out');
  // Logged out: Back/forward to #home must not reveal a screen that needs a session.
  await page.goto(srv.url + '#home');
  await d.booted();
  assert.equal(await d.screen(), 'auth');
  d.assertClean();
  await d.close();
});

test('second device: name + code on another context shows the same totals; wrong code is a generic error', async () => {
  const backend = H.createBackend();
  const a = await dev(backend);
  const code = await H.signUp(a, 'Two Devices');
  await H.startClassic(a.page, 'rookie');
  await H.solveClassic(a.page);
  await H.waitStatus(a.page);
  await a.page.click('[data-screen="result"] [data-action="go-home"]');
  await a.waitScreen('home');
  const totalsA = await H.homeTotals(a.page);
  assert.ok(H.num(totalsA.classic) > 0, `device A has points: ${JSON.stringify(totalsA)}`);
  assert.equal(totalsA.blood, '0');
  assert.equal(H.num(totalsA.total), H.num(totalsA.classic));

  const b = await dev(backend);
  // wrong code first: generic message, both fields flagged, same text as for an unknown name
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
  await H.signIn(b, 'Two Devices', wrong, { expect: null });
  await b.page.waitForFunction(() => document.querySelector('#signin-error').textContent.trim() !== '');
  const msgWrongCode = await b.page.textContent('#signin-error');
  assert.match(msgWrongCode, /don’t match any player/);
  assert.equal(await b.page.getAttribute(H.q.signinName, 'aria-invalid'), 'true');
  assert.equal(await b.page.getAttribute(H.q.signinCode, 'aria-invalid'), 'true');
  assert.equal(await b.screen(), 'auth');
  await b.page.fill(H.q.signinName, 'Nobody At All');
  await b.page.fill(H.q.signinCode, code);
  await b.page.click(H.q.signinSubmit);
  await b.page.waitForFunction((m) => document.querySelector('#signin-error').textContent.trim() !== '' && true, msgWrongCode);
  assert.equal(await b.page.textContent('#signin-error'), msgWrongCode, 'unknown name and wrong code are indistinguishable');
  // malformed code is caught locally with the format message and no network round trip
  const before = backend.log.length;
  await b.page.fill(H.q.signinCode, '12345');
  await b.page.click(H.q.signinSubmit);
  assert.match(await b.page.textContent('#signin-error'), /6\s?digits/);
  assert.equal(backend.log.length, before, 'format error costs no request');
  // right name (different case) + right code, with separators like a pasted "123 456"
  await b.page.fill(H.q.signinName, 'TWO devices');
  await b.page.fill(H.q.signinCode, code.slice(0, 3) + ' ' + code.slice(3));
  await b.page.click(H.q.signinSubmit);
  await b.waitScreen('home');
  const totalsB = await H.homeTotals(b.page);
  assert.deepEqual(totalsB, totalsA, 'second device shows the same totals');
  assert.equal((await b.page.textContent('[data-screen="home"] [data-slot="history"] li')).includes('Classic'), true, 'history names its source');
  a.assertClean();
  b.assertClean();
  await a.close();
  await b.close();
});

test('HTML in a player name is rendered inert (home, header, leaderboard)', async () => {
  const backend = H.createBackend();
  const d = await dev(backend);
  const { page } = d;
  const evil = '<img src onerror=1>'; // 19 chars: fits maxlength, would fire in innerHTML
  await H.signUp(d, evil);
  await H.startClassic(page, 'rookie');
  await H.solveClassic(page);
  await H.waitStatus(page);
  const check = async () => {
    const r = await page.evaluate(() => ({
      imgs: document.querySelectorAll('img').length,
      injected: document.querySelectorAll('body :is(b, i, u, script, [onerror])').length,
      headerHtml: document.querySelector('header [data-account] [data-out="name"]').innerHTML,
    }));
    assert.equal(r.imgs, 0, 'no <img> was created from the name');
    assert.equal(r.injected, 0);
    assert.equal(r.headerHtml, '<bdi>&lt;img src onerror=1&gt;</bdi>');
  };
  await check();
  await page.click('[data-screen="result"] [data-action="go-home"]');
  await d.waitScreen('home');
  await check();
  assert.equal(await page.textContent('[data-screen="home"] strong[data-out="name"]'), evil);
  await page.click('[data-screen="home"] [data-action="show-board"]');
  await d.waitScreen('board');
  await page.waitForSelector('[data-slot="board-rows"] tr');
  await check();
  assert.equal(await page.textContent('[data-slot="board-rows"] tr th bdi'), evil);
  d.assertClean();
  await d.close();
});

test('Arabic name works end to end, on a second device too', async () => {
  const backend = H.createBackend();
  const a = await dev(backend);
  const name = 'سارة';
  const code = await H.signUp(a, name);
  assert.equal(await a.page.textContent('header [data-account] [data-out="name"]'), name);
  await H.waitStatus(a.page);
  const b = await dev(backend);
  await H.signIn(b, ' سارة ', code); // surrounding spaces are trimmed
  assert.equal(await b.page.textContent('header [data-account] [data-out="name"]'), name);
  // the id is stable across devices: exactly one player document exists
  assert.equal([...backend.docs.keys()].filter((k) => k.startsWith('players/')).length, 1);
  a.assertClean();
  b.assertClean();
  await a.close();
  await b.close();
});

test('Arabic-Indic digits are accepted in the code field', async () => {
  const backend = H.createBackend();
  const a = await dev(backend);
  const code = await H.signUp(a, 'Digits');
  await H.waitStatus(a.page);
  const b = await dev(backend);
  const arabic = [...code].map((c) => String.fromCharCode(0x0660 + Number(c))).join('');
  await H.signIn(b, 'Digits', arabic);
  a.assertClean();
  b.assertClean();
  await a.close();
  await b.close();
});

// F-01 (fixed): existence probes use documents:batchGet (200 + `missing`), so neither sign-up nor a wrong-code sign-in
// may print a network error to the console. Strict: assertClean() fails on any console error/warning or HTTP >= 400.
test('sign-up and failed sign-in produce zero console errors and no 4xx anywhere (F-01)', async () => {
  const backend = H.createBackend();
  const a = await dev(backend);
  const code = await H.signUp(a, 'Quiet');
  await H.waitSynced(a.page);
  const b = await dev(backend);
  await H.signIn(b, 'Quiet', String((Number(code) + 1) % 1000000).padStart(6, '0'), { expect: null });
  await b.page.waitForFunction(() => document.querySelector('#signin-error').textContent.trim() !== '');
  await b.page.fill(H.q.signinName, 'Nobody Here');
  await b.page.fill(H.q.signinCode, code);
  await b.page.click(H.q.signinSubmit);
  await b.page.waitForTimeout(500);
  a.assertClean();
  b.assertClean();
  assert.ok(!a.net.requests.some((r) => /^GET .*\/players\//.test(r)), 'no plain GET probe of players/<id> remains');
  await a.close();
  await b.close();
});
