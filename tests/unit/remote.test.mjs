import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRemote, reasonFor, MAX_SAVE_CHARS } from '../../js/sync/remote.js';
import { createFakeBackend, API_URL } from './helpers/fake-backend.mjs';
import { guardGlobalFetch, throwingFetch } from './helpers/harness.mjs';

const ID = '1'.repeat(64);
const ID2 = '2'.repeat(64);
const BID = '3'.repeat(64);

let guard;
before(() => {
  guard = guardGlobalFetch();
});
after(() => {
  guard.restore();
  assert.equal(guard.calls, 0, 'the real global fetch must never be used by tests');
});

function setup(over = {}) {
  const backend = createFakeBackend();
  const dev = backend.device();
  const remote = createRemote({ url: API_URL, fetch: dev.fetch, timeoutMs: 40, ...over });
  return { backend, dev, remote };
}

const row = (name, total, extra = {}) => ({ name, total, blood: 0, solved: 1, bestRun: 0, updatedAt: 1700000000000, ...extra });

test('create then get; create is create-only (second create conflicts)', async () => {
  const { remote, backend } = setup();
  const miss = await remote.getPlayer(ID);
  assert.deepEqual(miss, { ok: false, reason: 'notfound', status: 404 });

  const c = await remote.createPlayer(ID, '{"v":1}');
  assert.equal(c.ok, true);
  assert.match(c.data.updateTime, /^[0-9]+$/);

  const g = await remote.getPlayer(ID);
  assert.equal(g.ok, true);
  assert.deepEqual(g.data, { v: 1, save: '{"v":1}', updateTime: c.data.updateTime });

  const again = await remote.createPlayer(ID, '{"v":1,"x":1}');
  assert.deepEqual(again, { ok: false, reason: 'conflict', status: 409 });
  assert.equal(backend.get('players/' + ID).save, '{"v":1}', 'nothing was overwritten');
});

test('request shape: one POST per call, text/plain JSON body (no preflight), no credentials, create is its own route', async () => {
  const seen = [];
  const { dev, backend } = setup();
  const remote = createRemote({ url: API_URL + '/', fetch: (u, i) => (seen.push({ u, i }), dev.fetch(u, i)), timeoutMs: 40 });
  await remote.createPlayer(ID, 'S');
  assert.equal(seen[0].u, API_URL + '/player/create', 'trailing slash on the base URL is normalised');
  assert.equal(seen[0].i.method, 'POST');
  assert.equal(seen[0].i.credentials, 'omit');
  assert.match(seen[0].i.headers['Content-Type'], /^text\/plain/);
  assert.deepEqual(JSON.parse(seen[0].i.body), { id: ID, save: 'S' });
  assert.deepEqual(Object.keys(backend.get('players/' + ID)).sort(), ['rev', 'save', 'v']);
  assert.equal(backend.get('players/' + ID).v, 1);
});

test('update requires the current updateTime: stale precondition -> conflict, fresh -> ok', async () => {
  const { remote, backend } = setup();
  const c = await remote.createPlayer(ID, 'A');
  const u1 = await remote.updatePlayer(ID, 'B', c.data.updateTime);
  assert.equal(u1.ok, true);
  assert.notEqual(u1.data.updateTime, c.data.updateTime);
  const stale = await remote.updatePlayer(ID, 'C', c.data.updateTime);
  assert.deepEqual(stale, { ok: false, reason: 'conflict', status: 409 });
  assert.equal(backend.get('players/' + ID).save, 'B');
  assert.equal((await remote.updatePlayer(ID, 'C', '')).reason, 'error', 'refuses an unconditional update');
  const missing = await remote.updatePlayer(ID2, 'C', c.data.updateTime);
  assert.equal(missing.ok, false);
});

test('faults: offline, 403, 429, 5xx, timeout', async () => {
  const { remote, backend, dev } = setup();
  dev.offline = true;
  assert.deepEqual(await remote.getPlayer(ID), { ok: false, reason: 'offline' });
  dev.offline = false;

  backend.faults.deny = true;
  assert.equal((await remote.getPlayer(ID)).reason, 'denied');
  backend.faults.deny = false;

  backend.faults.quota = true;
  assert.equal((await remote.getPlayer(ID)).reason, 'quota');
  backend.faults.quota = false;

  backend.faults.server5xx = true;
  assert.equal((await remote.getPlayer(ID)).reason, 'offline');
  backend.faults.server5xx = false;

  backend.faults.hang = true;
  const t0 = Date.now();
  assert.equal((await remote.getPlayer(ID)).reason, 'offline', 'hung request times out as offline');
  assert.ok(Date.now() - t0 < 1000);
});

test('timeout also covers a fetch that ignores AbortSignal, and a late rejection is not unhandled', async () => {
  let rejectLater;
  const fetch = () => new Promise((_, rej) => (rejectLater = rej));
  const remote = createRemote({ url: API_URL, fetch, timeoutMs: 20 });
  assert.equal((await remote.getPlayer(ID)).reason, 'offline');
  rejectLater(new Error('late'));
  await new Promise((r) => setTimeout(r, 10)); // would crash the run via unhandledRejection if mishandled
});

test('default timeout is 8 seconds', async () => {
  const seen = [];
  const realSet = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => {
    seen.push(ms);
    return realSet(fn, 0, ...rest); // fire immediately: we only inspect the requested delay
  };
  try {
    const remote = createRemote({ url: API_URL, fetch: () => new Promise(() => {}) });
    assert.equal((await remote.getPlayer(ID)).reason, 'offline');
  } finally {
    globalThis.setTimeout = realSet;
  }
  assert.ok(seen.includes(8000), JSON.stringify(seen));
});

test('disabled or unconfigured remote never touches the network', async () => {
  for (const o of [{ enabled: false }, { url: '' }, { url: 'not-a-url' }]) {
    const remote = createRemote({ url: API_URL, fetch: throwingFetch, ...o });
    assert.deepEqual(await remote.getPlayer(ID), { ok: false, reason: 'offline' });
    assert.equal((await remote.createPlayer(ID, 'x')).reason, 'offline');
    assert.equal((await remote.listBoard({ limit: 5 })).reason, 'offline');
  }
});

test('a throwing or garbage fetch resolves to a Result, never rejects', async () => {
  const bad = [
    () => {
      throw new Error('sync throw');
    },
    async () => {
      throw new TypeError('x');
    },
    async () => ({ status: 200, text: async () => '<html>' }),
    async () => ({ status: 200, text: async () => { throw new Error('body'); } }),
    async () => undefined,
  ];
  for (const fetch of bad) {
    const remote = createRemote({ url: API_URL, fetch });
    const r = await remote.getPlayer(ID);
    assert.equal(typeof r.ok, 'boolean');
  }
});

test('invalid ids and oversized saves are refused before any request', async () => {
  const remote = createRemote({ url: API_URL, fetch: throwingFetch });
  // throwingFetch would turn a request into 'offline'; these must be 'error'/'toolarge' instead
  assert.equal((await remote.getPlayer('../x')).reason, 'error');
  assert.equal((await remote.createPlayer('nothex', 'x')).reason, 'error');
  assert.equal((await remote.putBoard('short', row('A', 1))).reason, 'error');
  assert.equal((await remote.createPlayer(ID, 'x'.repeat(MAX_SAVE_CHARS + 1))).reason, 'toolarge');
});

test('board: put, list ordered desc by total / bestRun, limit honoured', async () => {
  const { remote, backend } = setup();
  const bids = ['a', 'b', 'c', 'd'].map((c) => c.repeat(64));
  const rows = [
    row('Ann', 300, { bestRun: 10 }),
    row('Bob', 900, { bestRun: 5 }),
    row('Cy', 100, { bestRun: 50 }),
    row('Di', 600, { bestRun: 20 }),
  ];
  for (let i = 0; i < 4; i++) assert.equal((await remote.putBoard(bids[i], rows[i])).ok, true);

  let l = await remote.listBoard({ orderBy: 'total', limit: 3 });
  assert.equal(l.ok, true);
  assert.deepEqual(l.data.map((r) => r.name), ['Bob', 'Di', 'Ann']);
  assert.equal(l.data[0].bid, bids[1]);
  assert.equal(l.data[0].total, 900);
  assert.equal(typeof l.data[0].updatedAt, 'number');

  l = await remote.listBoard({ orderBy: 'bestRun', limit: 2 });
  assert.deepEqual(l.data.map((r) => r.name), ['Cy', 'Di']);

  const q = backend.log.at(-1);
  assert.equal(q.method, 'POST');
  assert.equal(q.path, '/board/list');
  assert.deepEqual(q.body, { orderBy: 'bestRun', limit: 2 });

  // upsert: same bid, new numbers
  await remote.putBoard(bids[0], row('Ann', 5000));
  l = await remote.listBoard({ orderBy: 'total', limit: 1 });
  assert.equal(l.data[0].name, 'Ann');
});

test('listBoard clamps limit into the server range and defaults unknown orderBy', async () => {
  const { remote, backend } = setup();
  await remote.putBoard(BID, row('Ann', 1));
  for (const [lim, sent] of [[1000, 50], [0, 20], [-4, 1], [NaN, 20], [undefined, 20]]) {
    const r = await remote.listBoard({ limit: lim });
    assert.equal(r.ok, true, `limit ${lim}`);
    assert.equal(backend.log.at(-1).body.limit, sent, `limit ${lim} is sent as ${sent}`);
  }
  const r = await remote.listBoard({ orderBy: 'evil', limit: 5 });
  assert.equal(r.ok, true);
  assert.equal(backend.log.at(-1).body.orderBy, 'total');
  assert.equal((await remote.listBoard()).ok, true);
});

test('empty board is an empty list, not an error', async () => {
  const { remote } = setup();
  assert.deepEqual(await remote.listBoard({ limit: 10 }), { ok: true, data: [] });
});

test('board rows that break the server checks are refused (name size, negative, range); the size rule is bytes <= 96', async () => {
  const { remote } = setup();
  // server: 1..96 UTF-8 bytes; the client cuts to 24 code points
  assert.equal((await remote.putBoard(BID, row('x'.repeat(97), 1))).reason, 'error', '97 bytes');
  assert.equal((await remote.putBoard(BID, row('\u{1F600}'.repeat(25), 1))).reason, 'error', '25 emoji = 100 bytes');
  assert.equal((await remote.putBoard(BID, row('', 1))).reason, 'error');
  assert.equal((await remote.putBoard(BID, row('A', -1))).reason, 'error');
  assert.equal((await remote.putBoard(BID, row('A', 1e9))).reason, 'error');
  assert.equal((await remote.putBoard(BID, row('x'.repeat(96), 1))).ok, true, '96 bytes is the limit');
  assert.equal((await remote.putBoard(BID, row('\u{1F600}'.repeat(24), 1))).ok, true, '24 emoji = 96 bytes: the longest name the client ever sends');
  assert.equal((await remote.putBoard(BID, row('A', 5))).ok, true);
});

test('nothing is logged: ids, codes and saves stay out of console output', async () => {
  const lines = [];
  const orig = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
    orig[k] = console[k];
    console[k] = (...a) => lines.push(a.join(' '));
  }
  try {
    const { remote, dev, backend } = setup();
    await remote.createPlayer(ID, 'secret-save');
    await remote.getPlayer(ID);
    dev.offline = true;
    await remote.getPlayer(ID);
    dev.offline = false;
    backend.faults.deny = true;
    await remote.getPlayer(ID);
  } finally {
    Object.assign(console, orig);
  }
  assert.deepEqual(lines, []);
});

test('status mapping', () => {
  assert.equal(reasonFor(403), 'denied');
  assert.equal(reasonFor(401), 'denied');
  assert.equal(reasonFor(404), 'notfound');
  assert.equal(reasonFor(409), 'conflict');
  assert.equal(reasonFor(413), 'toolarge');
  assert.equal(reasonFor(429), 'quota');
  assert.equal(reasonFor(503), 'offline');
  assert.equal(reasonFor(500), 'offline');
  assert.equal(reasonFor(400), 'error');
});

// ---- existence probes must never produce an HTTP 404 (browsers print each one as a console error) ----

test('getPlayer answers a missing player with 200 {found:false}, mapped to notfound; the server never sends 404', async () => {
  const { backend, remote } = setup();
  assert.deepEqual(await remote.getPlayer(ID), { ok: false, reason: 'notfound', status: 404 });
  assert.equal(backend.notFound, 0);
  assert.equal(backend.log.at(-1).path, '/player/get');
  assert.equal(backend.log.filter((e) => e.method === 'GET').length, 0, 'no plain GET is ever sent');
});

test('getPlayer returns the save when it exists, with updateTime for the optimistic write', async () => {
  const { backend, remote } = setup();
  assert.equal((await remote.createPlayer(ID, '{"v":1}')).ok, true);
  const g = await remote.getPlayer(ID);
  assert.equal(g.ok, true);
  assert.deepEqual([g.data.v, g.data.save], [1, '{"v":1}']);
  assert.ok(g.data.updateTime);
  assert.equal((await remote.updatePlayer(ID, '{"v":1,"x":1}', g.data.updateTime)).ok, true);
  assert.equal(backend.notFound, 0);
});

test('faults map as before on the read path', async () => {
  const { backend, dev, remote } = setup();
  backend.faults.deny = true;
  assert.equal((await remote.getPlayer(ID)).reason, 'denied');
  backend.faults.deny = false;
  backend.faults.quota = true;
  assert.equal((await remote.getPlayer(ID)).reason, 'quota');
  backend.faults.quota = false;
  dev.offline = true;
  assert.equal((await remote.getPlayer(ID)).reason, 'offline');
});
