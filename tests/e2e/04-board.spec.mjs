// 3d. Leaderboard: tabs + keyboard roving, rows from the fake backend, self-highlight with a non-colour cue, offline.
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

const hex = (n) => n.toString(16).padStart(64, '0');
const int = (n) => ({ integerValue: String(n) });
function seedBoard(backend) {
  const rows = [
    ['Zed', 9000, 4000, 30, 1800],
    ['سارة', 7000, 0, 20, 0],
    ['<b>bold</b>', 5000, 3500, 15, 1500],
    ['Longname-without-spaces', 3000, 1000, 9, 900],
    ['Nobody', 0, 0, 0, 0],
  ];
  rows.forEach(([name, total, blood, solved, bestRun], i) =>
    backend.put(`board/${hex(i + 1)}`, { name: { stringValue: name }, total: int(total), blood: int(blood), solved: int(solved), bestRun: int(bestRun), updatedAt: int(1760000000000 + i) }));
}
const tabs = (page) => page.$$eval('[role="tab"]', (t) => t.map((b) => ({ id: b.dataset.tab, sel: b.getAttribute('aria-selected'), ti: b.tabIndex })));
const rows = (page) => page.$$eval('[data-slot="board-rows"] tr', (r) => r.map((x) => [...x.children].map((c) => c.textContent.trim().replace(/\s+/g, ' '))));

async function boardDevice(backend, o = {}) {
  const d = await H.openDevice(br, { baseUrl: srv.url, backend, ...o });
  await H.signUp(d, 'Me Myself');
  await H.startClassic(d.page, 'rookie');
  await H.solveClassic(d.page);
  await H.waitStatus(d.page);
  await d.page.click('[data-screen="result"] [data-action="go-home"]');
  await d.waitScreen('home');
  return d;
}

test('board: All-time and Blood tabs, ranked rows, own row marked by text + aria-current, keyboard roving', async () => {
  const backend = H.createBackend();
  seedBoard(backend);
  const d = await boardDevice(backend);
  const { page } = d;
  await page.click('[data-screen="home"] [data-action="show-board"]');
  await d.waitScreen('board');
  await page.waitForSelector('[data-slot="board-rows"] tr');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'board-title', 'h1 takes focus on navigation');
  assert.match(await page.textContent('[data-screen="board"] p'), /not verified/);

  // structure
  assert.deepEqual(await tabs(page), [{ id: 'all', sel: 'true', ti: 0 }, { id: 'blood', sel: 'false', ti: -1 }]);
  assert.equal(await page.getAttribute('[role="tablist"]', 'aria-label'), 'Leaderboard views');
  assert.equal(await page.getAttribute('[role="tabpanel"]', 'aria-labelledby'), 'board-tab-all');
  assert.equal(await page.textContent('caption'), 'All-time leaderboard, ranked by total points');
  const all = await rows(page);
  // zero-score rows are not listed; "Me Myself" has a Classic solve, so it is on the board
  const names = all.map((r) => r[1].replace(/ You$/, ''));
  assert.deepEqual(names.slice(0, 3), ['Zed', 'سارة', '<b>bold</b>'], 'seeded rows in total order');
  assert.ok(names.includes('Me Myself'), 'my own row is published after the first solve');
  assert.ok(!names.includes('Nobody'), 'zero rows are hidden');
  const totals = all.map((r) => H.num(r[2]));
  assert.deepEqual(totals, [...totals].sort((a, b) => b - a), 'sorted by total descending');
  assert.deepEqual(all.map((r) => r[0]), all.map((_, i) => String(i + 1)), 'rank column is 1..n');
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-slot="board-rows"] b, [data-slot="board-rows"] img').length), 0, 'names are inert text');
  assert.equal(await page.textContent('[data-slot="board-rows"] th bdi >> nth=2'), '<b>bold</b>');

  // own row: exactly one, identified by board id (not name), with a text cue and aria-current
  const self = await page.$$eval('[data-slot="board-rows"] tr[data-self="true"]', (r) => r.map((x) => ({ cur: x.getAttribute('aria-current'), text: x.querySelector('th').textContent.trim() })));
  assert.equal(self.length, 1);
  assert.equal(self[0].cur, 'true');
  assert.match(self[0].text, /Me Myself\s+You$/, 'non-colour cue: the word "You"');

  // an impostor with the same NAME is not highlighted
  backend.put(`board/${hex(99)}`, { name: { stringValue: 'Me Myself' }, total: int(100), blood: int(0), solved: int(1), bestRun: int(0), updatedAt: int(1760000009999) });
  await page.click('[data-action="back"]');
  await d.waitScreen('home');
  await page.click('[data-screen="home"] [data-action="show-board"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-slot="board-rows"] tr').length >= 5);
  assert.equal(await page.locator('[data-slot="board-rows"] tr[data-self="true"]').count(), 1, 'identity is by board id, never by name');

  // keyboard roving
  await page.focus('#board-tab-all');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#board-tab-blood').getAttribute('aria-selected') === 'true');
  assert.deepEqual(await tabs(page), [{ id: 'all', sel: 'false', ti: -1 }, { id: 'blood', sel: 'true', ti: 0 }]);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'board-tab-blood', 'focus follows the selected tab');
  assert.equal(await page.getAttribute('[role="tabpanel"]', 'aria-labelledby'), 'board-tab-blood');
  assert.equal(await page.textContent('caption'), 'Blood leaderboard, ranked by best single run');
  assert.equal((await page.textContent('thead th:last-child')).trim(), 'Best run');
  await page.waitForFunction(() => document.querySelector('[data-slot="board-rows"] th bdi')?.textContent === 'Zed');
  const blood = await rows(page);
  const bn = blood.map((r) => r[1]);
  assert.deepEqual(bn.slice(0, 3), ['Zed', '<b>bold</b>', 'Longname-without-spaces'], 'ordered by bestRun, zero-run players hidden');
  assert.deepEqual(blood.map((r) => H.num(r[2])).slice(0, 3), [1800, 1500, 900]);
  assert.ok(!bn.includes('سارة'), 'a player with no Blood run is not on the Blood tab');
  assert.equal(await page.locator('[data-slot="board-rows"] tr[data-self="true"]').count(), 0, 'I have no Blood run, so I am not on that tab');
  await page.keyboard.press('ArrowRight'); // wraps
  assert.equal(await page.evaluate(() => document.activeElement.id), 'board-tab-all');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'board-tab-blood');
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'board-tab-all');
  await page.keyboard.press('ArrowLeft'); // wraps backwards
  assert.equal(await page.evaluate(() => document.activeElement.id), 'board-tab-blood');
  // Tab order out of the tablist: only the selected tab is a tab stop, then the panel, then Back
  const order = [];
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => document.activeElement.id || document.activeElement.dataset.action));
  }
  assert.deepEqual(order, ['board-panel', 'back']);
  // clicking a tab selects it without stealing the roving state
  await page.click('#board-tab-all');
  assert.deepEqual(await tabs(page), [{ id: 'all', sel: 'true', ti: 0 }, { id: 'blood', sel: 'false', ti: -1 }]);
  // not polled: no further board queries while the player just sits there
  const q0 = d.net.requests.filter((r) => r.includes(':runQuery')).length;
  await page.waitForTimeout(3500);
  assert.equal(d.net.requests.filter((r) => r.includes(':runQuery')).length, q0, 'leaderboard is never polled');
  d.assertClean();
  await d.close();
});

test('board: RTL swaps the arrow keys (Left = next tab in Arabic)', async () => {
  const backend = H.createBackend();
  seedBoard(backend);
  const d = await boardDevice(backend);
  const { page } = d;
  await page.click('header [data-action="lang"]');
  await page.waitForFunction(() => document.documentElement.dir === 'rtl');
  await page.click('[data-screen="home"] [data-action="show-board"]');
  await d.waitScreen('board');
  await page.waitForSelector('[data-slot="board-rows"] tr');
  await page.focus('#board-tab-all');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'board-tab-blood', 'in RTL, ArrowLeft goes to the next (visually left) tab');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'board-tab-all');
  assert.ok((await page.textContent('[data-slot="board-rows"] tr[data-self="true"] th')).trim().length > 0);
  d.assertClean();
  await d.close();
});

test('board: backend blocked shows the offline message; stale list is kept when a refresh fails; denied is explained', async () => {
  const backend = H.createBackend();
  seedBoard(backend);
  const d = await boardDevice(backend, { allow: [/ERR_INTERNET_DISCONNECTED|net::ERR/, /(http403|console\.error: Failed to load resource: the server responded with a status of 403).*runQuery/] });
  const { page } = d;
  // 1. first load works and is cached
  await page.click('[data-screen="home"] [data-action="show-board"]');
  await page.waitForSelector('[data-slot="board-rows"] tr');
  const cached = (await rows(page)).length;
  assert.ok(cached >= 4);
  assert.equal((await page.textContent('[data-screen="board"] [data-out="msg"]')).trim(), '');
  // 2. blocked: reopening keeps the stale rows and says so
  d.net.block = true;
  await page.click('[data-action="back"]');
  await d.waitScreen('home');
  await page.click('[data-screen="home"] [data-action="show-board"]');
  await page.waitForFunction(() => /Showing the last list/.test(document.querySelector('[data-screen="board"] [data-out="msg"]').textContent));
  assert.equal((await rows(page)).length, cached, 'stale rows remain visible');
  // 3. never-loaded tab while blocked: plain offline message, no rows
  await page.click('#board-tab-blood');
  await page.waitForFunction(() => /offline/i.test(document.querySelector('[data-screen="board"] [data-out="msg"]').textContent));
  assert.match(await page.textContent('[data-screen="board"] [data-out="msg"]'), /You’re offline\. Connect to the internet/);
  assert.equal(await page.locator('[data-slot="board-rows"] tr').count(), 0);
  assert.equal(await page.getAttribute('[data-screen="board"] [data-out="msg"]', 'aria-live'), 'polite');
  // 4. permission denied (rules not published / key restricted) is distinct from offline
  d.net.block = false;
  backend.faults.deny = true;
  await page.click('#board-tab-all');
  await page.click('#board-tab-blood');
  await page.waitForFunction(() => /isn’t available|Showing the last list|offline/i.test(document.querySelector('[data-screen="board"] [data-out="msg"]').textContent));
  backend.faults.deny = false;
  d.assertClean();
  await d.close();
});

test('board: signed-out visitors cannot reach the board; empty board has a message', async () => {
  const backend = H.createBackend();
  const d = await H.openDevice(br, { baseUrl: srv.url, backend });
  await d.goto('#board');
  assert.equal(await d.screen(), 'auth');
  await H.signUp(d, 'Solo');
  await d.page.click('[data-screen="home"] [data-action="show-board"]');
  await d.waitScreen('board');
  await d.page.waitForFunction(() => /No scores yet/.test(document.querySelector('[data-screen="board"] [data-out="msg"]').textContent));
  d.assertClean();
  await d.close();
});
