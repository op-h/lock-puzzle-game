// 3f. Service worker: registers on http://localhost, precaches, offline reload, never touches cross-origin,
// updated cache version waits and takes over on the next load without breaking the running round, none on file:.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as H from './support/harness.mjs';

import { execFileSync } from 'node:child_process';
import os from 'node:os';

// The repo tree carries `const VERSION = '__BUILD_ID__'`, which makes the worker a no-op passthrough (a dev server must
// never serve stale files). Caching exists only in a STAGED copy where the release workflow has stamped the token, so
// every caching test serves a copy made by the real .github/scripts/stage-site.sh.
let srv;
let br;
let swId = 'e2e-v1'; // what the served sw.js claims to be (rewritten on the fly to simulate a new deploy)
const staged = path.join(os.tmpdir(), `lp-e2e-stage-${process.pid}`);
const stage = (id, dir = staged) => execFileSync('bash', [path.join(H.REPO, '.github/scripts/stage-site.sh'), dir], { env: { ...process.env, BUILD_ID: id }, stdio: 'pipe' });
const stamp = (buf) => Buffer.from(buf.toString().replace(/^const VERSION = '[^']*';/m, `const VERSION = '${swId}';`));
before(async () => {
  stage('e2e-v1');
  srv = await H.startServer({ root: staged, cache: false, rewrite: (rel, buf) => (rel === 'sw.js' ? stamp(buf) : null) });
  br = await H.launchBrowser();
});
after(async () => {
  await br.close();
  await srv.close();
  fs.rmSync(staged, { recursive: true, force: true });
});

const OFFLINE_NOISE = [/ERR_INTERNET_DISCONNECTED|net::ERR_/];
const precacheList = () => {
  const src = fs.readFileSync(path.join(H.REPO, 'sw.js'), 'utf8');
  const body = /const PRECACHE = \[([\s\S]*?)\];/.exec(src)[1];
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};
async function until(fn, timeout = 15000, step = 100) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('until(): timed out');
    await H.sleep(step);
  }
}
const swState = (page) =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      scope: reg && reg.scope,
      active: reg && reg.active && reg.active.scriptURL,
      waiting: !!(reg && reg.waiting),
      installing: !!(reg && reg.installing),
      controlled: !!navigator.serviceWorker.controller,
      caches: await caches.keys(),
    };
  });

test('service worker: registers with scope = the project path, precaches every listed file, controls the next load', async () => {
  swId = 'e2e-v1';
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend(), sw: true });
  const { page } = d;
  await d.goto('');
  await page.evaluate(() => navigator.serviceWorker.ready);
  let st = await swState(page);
  assert.equal(st.scope, srv.url, 'scope is the subpath, not the origin root');
  assert.equal(st.active, srv.url + 'sw.js');
  assert.equal(st.controlled, false, 'first load is not controlled (no clients.claim by design)');
  assert.deepEqual(st.caches, ['lp1-e2e-v1']);
  const cached = await page.evaluate(async () => (await (await caches.open('lp1-e2e-v1')).keys()).map((r) => new URL(r.url).pathname));
  // './' and './index.html' are one document: the worker stores it once (as index.html) and maps both URLs to it
  const want = precacheList().filter((u) => u !== './').map((u) => new URL(u, srv.url).pathname);
  const missing = want.filter((u) => !cached.includes(u));
  assert.deepEqual(missing, [], 'every PRECACHE entry is in the cache');
  assert.equal(new Set(cached).size, cached.length);
  // every path in PRECACHE exists on disk (a 404 would be swallowed by the worker's per-file catch)
  for (const u of precacheList()) {
    if (u === './') continue;
    assert.ok(fs.existsSync(path.join(H.REPO, u)), `${u} exists`);
  }
  // no module the app can import is missing from the list
  const jsOnDisk = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isDirectory()) walk(path.join(dir, f.name));
      else if (f.name.endsWith('.js') || f.name.endsWith('.css')) jsOnDisk.push('./' + path.relative(H.REPO, path.join(dir, f.name)).split(path.sep).join('/'));
    }
  };
  walk(path.join(H.REPO, 'js'));
  walk(path.join(H.REPO, 'css'));
  assert.deepEqual(jsOnDisk.filter((f) => !precacheList().includes(f)), [], 'every js/css file is precached');
  await page.reload();
  await d.booted();
  st = await swState(page);
  assert.equal(st.controlled, true, 'second load is controlled');
  d.assertClean();
  await d.close();
});

test('service worker: offline reload serves the app from cache; offline sign-up works on-device and syncs when back online', async () => {
  swId = 'e2e-v1';
  const backend = H.createBackend();
  const d = await H.openDevice(br, { baseUrl: srv.url, backend, sw: true, allow: OFFLINE_NOISE });
  const { page, context } = d;
  await d.goto('');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await d.booted();
  assert.equal((await swState(page)).controlled, true);

  d.net.offline = true;
  await context.setOffline(true);
  await page.reload();
  await d.booted();
  assert.equal(await d.screen(), 'auth', 'app shell boots offline');
  assert.equal(await page.evaluate(() => document.fonts.check('16px "Pixelify Sans"')), true, 'font served from cache');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)', 'CSS applied offline');
  const spriteOk = await page.evaluate(async () => (await fetch('./assets/sprites.svg')).ok);
  assert.equal(spriteOk, true, 'sprite sheet available offline');

  // offline sign-up is on-device only, says so, and still works
  await page.fill(H.q.signupName, 'Offline Olly');
  await page.click(H.q.signupSubmit);
  await page.waitForSelector(`${H.q.codeDialog}[open]`);
  const code = (await page.textContent(`${H.q.codeDialog} [data-out="code"]`)).replace(/\D/g, '');
  assert.match(await page.textContent(`${H.q.codeDialog} [data-out="msg"]`), /Saved on this device only/);
  await page.check('#code-ack');
  await page.click(`${H.q.codeDialog} [data-action="ack-code"]`);
  await d.waitScreen('home');
  await page.waitForFunction(() => document.querySelector('header .lp-chip').dataset.status === 'local');
  // play offline: a puzzle can be solved
  await H.startClassic(page, 'rookie');
  await H.solveClassic(page);
  // back online: the account and the solve reach the backend with no reload
  d.net.offline = false;
  await context.setOffline(false);
  await H.waitSynced(page, 25000);
  const players = [...backend.docs.keys()].filter((k) => k.startsWith('players/'));
  assert.equal(players.length, 1, 'offline-created account was uploaded');
  const save = JSON.parse(backend.docs.get(players[0]).fields.save.stringValue);
  assert.equal(save.history.length, 1, 'offline solve was uploaded');
  // and it is usable from another device with the code shown offline
  const b = await H.openDevice(br, { baseUrl: srv.url, backend });
  await H.signIn(b, 'Offline Olly', code);
  assert.ok(H.num((await H.homeTotals(b.page)).classic) > 0);
  d.assertClean();
  b.assertClean();
  await b.close();
  await d.close();
});

test('service worker: cross-origin requests are never intercepted or cached', async () => {
  swId = 'e2e-v1';
  const backend = H.createBackend();
  const d = await H.openDevice(br, { baseUrl: srv.url, backend, sw: true });
  const { page } = d;
  const viaWorker = [];
  page.on('request', (r) => {
    if (r.serviceWorker()) viaWorker.push(r.url());
  });
  await d.goto('');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await d.booted();
  assert.equal((await swState(page)).controlled, true);
  await H.signUp(d, 'Cross Origin');
  await H.waitSynced(page);
  assert.ok(d.net.requests.length > 0, 'Firestore traffic really happened under a controlling worker');
  assert.deepEqual(viaWorker.filter((u) => !u.startsWith(srv.origin)), [], 'the worker issued no cross-origin request');
  const cachedKeys = await page.evaluate(async () => {
    const out = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url);
    return out;
  });
  assert.deepEqual(cachedKeys.filter((u) => !u.startsWith(srv.origin)), [], 'only same-origin URLs are cached');
  assert.ok(!cachedKeys.some((u) => u.includes('firestore')), 'no Firestore response is ever cached');
  const src = fs.readFileSync(path.join(H.REPO, 'sw.js'), 'utf8');
  assert.match(src, /url\.origin !== self\.location\.origin\) return/, 'fetch handler bails on foreign origins before respondWith');
  d.assertClean();
  await d.close();
});

test('service worker: a new cache version waits, does not disturb the running round, and takes over on the next load', async () => {
  swId = 'e2e-v1';
  const backend = H.createBackend();
  const d = await H.openDevice(br, { baseUrl: srv.url, backend, sw: true });
  const { page } = d;
  await H.signUp(d, 'Updater');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await d.booted();
  assert.deepEqual((await swState(page)).caches, ['lp1-e2e-v1']);

  await H.startClassic(page, 'rookie');
  const p = await H.currentPuzzle(page);
  await H.typeWithKeypad(page, H.wrongGuess(p.answer, 0));
  await H.pressCheck(page);

  // ship "v2": the file changes by one byte, the browser's update check installs it
  swId = 'e2e-v2';
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg.update();
  });
  await until(async () => (await swState(page)).waiting);
  let st = await swState(page);
  assert.equal(st.waiting, true, 'new worker waits (no skipWaiting): it must not swap caches under a running round');
  assert.ok(st.caches.includes('lp1-e2e-v1') && st.caches.includes('lp1-e2e-v2'), `both caches exist while waiting: ${st.caches}`);
  assert.equal(st.controlled, true);
  // the running round is untouched and still playable
  assert.equal((await H.currentPuzzle(page)).id, p.id);
  assert.equal(await page.locator('[data-screen="play"] [data-slot="attempts"] li').count(), 1);
  await H.typeWithKeypad(page, p.answer);
  await H.pressCheck(page);
  await d.waitScreen('result');
  await page.click('[data-screen="result"] [data-action="go-home"]');
  await d.waitScreen('home');

  // "next load": leave the page so the old worker loses its client, then open the app again
  await page.goto('about:blank');
  await page.goto(srv.url);
  await d.booted();
  await until(async () => JSON.stringify((await swState(page)).caches) === '["lp1-e2e-v2"]');
  st = await swState(page);
  assert.deepEqual(st.caches, ['lp1-e2e-v2'], 'old cache deleted on activate');
  assert.equal(st.waiting, false);
  // the session survived the worker swap
  assert.equal(await d.screen(), 'home');
  assert.ok(H.num((await H.homeTotals(page)).total) > 0);
  const cached = await page.evaluate(async () => (await (await caches.open('lp1-e2e-v2')).keys()).length);
  assert.ok(cached >= precacheList().length - 1, `new cache is fully populated (${cached})`);
  d.assertClean();
  await d.close();
  swId = 'e2e-v1';
});

test('service worker: nothing is registered on file: (and the app itself needs http)', async () => {
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: null, sw: true, allow: [/./] });
  const { page } = d;
  const swRegisterAttempts = [];
  await page.addInitScript(() => {
    if (navigator.serviceWorker) {
      const orig = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = (...a) => (window.__swReg = (window.__swReg || 0) + 1, orig(...a));
    }
  });
  await page.goto('file://' + path.join(H.REPO, 'index.html'));
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    let regs = 0;
    let err = null;
    try {
      regs = 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0;
    } catch (e) {
      err = e.name; // SecurityError: the browser itself refuses service workers for file:
    }
    return { protocol: location.protocol, regs, err, controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller) };
  });
  assert.equal(r.protocol, 'file:');
  assert.equal(r.regs, 0, 'no service worker on file:');
  assert.equal(r.controlled, false);
  swRegisterAttempts.push(...(await page.evaluate(() => (window.__swReg ? [window.__swReg] : []))));
  assert.ok(!swRegisterAttempts.length, 'main.js never even calls register() on file: (protocol guard)');
  await d.close();
});

test('service worker: repo tree (unstamped __BUILD_ID__) is a pure passthrough: no caches at all, stale lp1-* caches are deleted', async () => {
  const dev = await H.startServer({ cache: false }); // the working tree, token unreplaced
  try {
    const d = await H.openDevice(br, { baseUrl: dev.url, backend: H.createBackend(), sw: true, allow: OFFLINE_NOISE });
    await d.context.addInitScript(() => {
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        caches.open('lp1-stale-from-an-old-deploy');
      }
    });
    await d.goto('');
    await d.page.evaluate(() => navigator.serviceWorker.ready);
    await d.page.reload();
    await d.booted();
    await until(async () => (await swState(d.page)).caches.length === 0);
    const st = await swState(d.page);
    assert.equal(st.scope, dev.url);
    assert.deepEqual(st.caches, [], 'no cache is created and the stale one is gone');
    d.context.setOffline(true);
    d.net.offline = true;
    await assert.rejects(d.page.reload(), /ERR_INTERNET_DISCONNECTED/, 'passthrough: nothing is served offline');
    d.assertClean();
    await d.close();
  } finally {
    await dev.close();
  }
});

test('service worker: install is atomic. One missing precache file fails the whole install, leaves no half cache, and the page keeps working from the network', async () => {
  swId = 'e2e-broken';
  const broken = await H.startServer({ root: staged, cache: false, allow: (rel) => rel !== 'js/ui/sound.js', rewrite: (rel, buf) => (rel === 'sw.js' ? stamp(buf) : null) });
  try {
    const d = await H.openDevice(br, { baseUrl: broken.url, backend: H.createBackend(), sw: true, allow: [/sound\.js|Failed to load resource|ServiceWorker|precache/i] });
    await d.goto('');
    await H.sleep(2500);
    const st = await d.page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return { active: !!(reg && reg.active), waiting: !!(reg && reg.waiting), caches: await caches.keys() };
    });
    assert.equal(st.active, false, 'a worker whose install failed never activates');
    assert.deepEqual(st.caches, [], 'the half-filled cache was deleted');
    assert.equal(await d.screen(), 'auth', 'the app itself still runs (network)');
    await d.close();
  } finally {
    await broken.close();
    swId = 'e2e-v1';
  }
});
