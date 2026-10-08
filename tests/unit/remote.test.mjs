import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRemote, toValue, fromValue, fromFields, reasonFor, MAX_SAVE_CHARS } from '../../js/sync/remote.js';
import { createFakeFirestore, PROJECT, API_KEY } from './helpers/fake-firestore.mjs';
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
  const backend = createFakeFirestore();
  const dev = backend.device();
  const remote = createRemote({ projectId: PROJECT, apiKey: API_KEY, fetch: dev.fetch, timeoutMs: 40, ...over });
  return { backend, dev, remote };
}

const row = (name, total, extra = {}) => ({ name, total, blood: 0, solved: 1, bestRun: 0, updatedAt: 1700000000000, ...extra });

test('typed values: integerValue is a string, and round-trips', () => {
  assert.deepEqual(toValue(5), { integerValue: '5' });
  assert.deepEqual(toValue(1.5), { doubleValue: 1.5 });
  assert.deepEqual(toValue('x'), { stringValue: 'x' });
  assert.deepEqual(toValue(true), { booleanValue: true });
  assert.deepEqual(toValue(null), { nullValue: null });
  assert.deepEqual(toValue([1, 'a']), { arrayValue: { values: [{ integerValue: '1' }, { stringValue: 'a' }] } });
  assert.equal(fromValue({ integerValue: '9007199254740' }), 9007199254740);
  assert.equal(fromValue({ stringValue: 'é' }), 'é');
  assert.equal(fromValue({ booleanValue: false }), false);
  assert.equal(fromValue({ doubleValue: 2.5 }), 2.5);
  assert.equal(fromValue({ nullValue: null }), null);
  assert.equal(fromValue({ timestampValue: '2026-01-01T00:00:00Z' }), '2026-01-01T00:00:00Z');
  assert.deepEqual(fromValue({ mapValue: { fields: { a: { integerValue: '1' } } } }), { a: 1 });
  assert.deepEqual(fromValue({ arrayValue: {} }), []);
  assert.equal(fromValue(undefined), null);
  const obj = { a: 1, b: 's', c: [true, { d: 2 }] };
  assert.deepEqual(fromValue(toValue(obj)), obj);
  assert.deepEqual(fromFields({ x: { integerValue: '3' } }), { x: 3 });
});

test('status mapping', () => {
  assert.equal(reasonFor(403, null, false), 'denied');
  assert.equal(reasonFor(401, null, false), 'denied');
  assert.equal(reasonFor(404, null, false), 'notfound');
  assert.equal(reasonFor(409, null, true), 'conflict');
  assert.equal(reasonFor(412, null, true), 'conflict');
  assert.equal(reasonFor(400, { error: { status: 'FAILED_PRECONDITION' } }, true), 'conflict');
  assert.equal(reasonFor(400, { error: { status: 'FAILED_PRECONDITION' } }, false), 'error', 'missing index is not a conflict');
  assert.equal(reasonFor(429, null, false), 'quota');
  assert.equal(reasonFor(200, { error: { status: 'RESOURCE_EXHAUSTED' } }, false), 'quota');
  assert.equal(reasonFor(503, null, false), 'offline');
  assert.equal(reasonFor(400, null, false), 'error');
});

test('create then get; create is create-only (second create conflicts)', async () => {
  const { remote, backend } = setup();
  const miss = await remote.getPlayer(ID);
  assert.deepEqual(miss, { ok: false, reason: 'notfound', status: 404 });

  const c = await remote.createPlayer(ID, '{"v":1}');
  assert.equal(c.ok, true);
  assert.match(c.data.updateTime, /^2026-/);

  const g = await remote.getPlayer(ID);
  assert.equal(g.ok, true);
  assert.deepEqual(g.data, { v: 1, save: '{"v":1}', updateTime: c.data.updateTime });

  const again = await remote.createPlayer(ID, '{"v":1,"x":1}');
  assert.deepEqual(again, { ok: false, reason: 'conflict', status: 409 });
  assert.equal(backend.get('players/' + ID).fields.save.stringValue, '{"v":1}', 'nothing was overwritten');
});

test('request shape: key in query, exists=false precondition, typed body, no auth header', async () => {
  const { remote, backend } = setup();
  await remote.createPlayer(ID, 'S');
  const w = backend.log.at(-1);
  assert.equal(w.method, 'PATCH');
  assert.equal(w.path, `/v1/projects/${PROJECT}/databases/(default)/documents/players/${ID}`);
  assert.equal(w.query.key, API_KEY);
  assert.equal(w.query['currentDocument.exists'], 'false');
  const stored = backend.get('players/' + ID).fields;
  assert.deepEqual(stored, { v: { integerValue: '1' }, save: { stringValue: 'S' } });
});

test('update requires the current updateTime: stale precondition -> conflict, fresh -> ok', async () => {
  const { remote, backend } = setup();
  const c = await remote.createPlayer(ID, 'A');
  const u1 = await remote.updatePlayer(ID, 'B', c.data.updateTime);
  assert.equal(u1.ok, true);
  assert.notEqual(u1.data.updateTime, c.data.updateTime);
  const stale = await remote.updatePlayer(ID, 'C', c.data.updateTime);
  assert.deepEqual(stale, { ok: false, reason: 'conflict', status: 400 });
  assert.equal(backend.get('players/' + ID).fields.save.stringValue, 'B');
  assert.equal((await remote.updatePlayer(ID, 'C', '')).reason, 'error', 'refuses an unconditional update');
  const missing = await remote.updatePlayer(ID2, 'C', c.data.updateTime);
  assert.equal(missing.ok, false);
});

test('409 and 412 both map to conflict (injected)', async () => {
  const { remote, backend } = setup();
  const c = await remote.createPlayer(ID, 'A');
  backend.failWrites.push({ status: 412, code: 'FAILED_PRECONDITION' });
  assert.equal((await remote.updatePlayer(ID, 'B', c.data.updateTime)).reason, 'conflict');
  backend.failWrites.push({ status: 409, code: 'ABORTED' });
  assert.equal((await remote.updatePlayer(ID, 'B', c.data.updateTime)).reason, 'conflict');
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
  const remote = createRemote({ projectId: PROJECT, apiKey: API_KEY, fetch, timeoutMs: 20 });
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
    const remote = createRemote({ projectId: PROJECT, apiKey: API_KEY, fetch: () => new Promise(() => {}) });
    assert.equal((await remote.getPlayer(ID)).reason, 'offline');
  } finally {
    globalThis.setTimeout = realSet;
  }
  assert.ok(seen.includes(8000), JSON.stringify(seen));
});

test('disabled or unconfigured remote never touches the network', async () => {
  for (const o of [{ enabled: false }, { projectId: '' }, { apiKey: '' }]) {
    const remote = createRemote({ projectId: PROJECT, apiKey: API_KEY, fetch: throwingFetch, ...o });
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
    const remote = createRemote({ projectId: PROJECT, apiKey: API_KEY, fetch });
    const r = await remote.getPlayer(ID);
    assert.equal(typeof r.ok, 'boolean');
  }
});

test('invalid ids and oversized saves are refused before any request', async () => {
  const remote = createRemote({ projectId: PROJECT, apiKey: API_KEY, fetch: throwingFetch });
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

  const q = JSON.parse(JSON.stringify(backend.log.at(-1)));
  assert.equal(q.method, 'POST');
  assert.ok(q.path.endsWith(':runQuery'));

  // upsert: same bid, new numbers
  await remote.putBoard(bids[0], row('Ann', 5000));
  l = await remote.listBoard({ orderBy: 'total', limit: 1 });
  assert.equal(l.data[0].name, 'Ann');
});

test('listBoard clamps limit into the rule\'s range and defaults unknown orderBy', async () => {
  const { remote, backend } = setup();
  await remote.putBoard(BID, row('Ann', 1));
  for (const lim of [1000, 0, -4, NaN, undefined]) {
    const r = await remote.listBoard({ limit: lim });
    assert.equal(r.ok, true, `limit ${lim}`);
  }
  const r = await remote.listBoard({ orderBy: 'evil', limit: 5 });
  assert.equal(r.ok, true);
  assert.equal((await remote.listBoard()).ok, true);
  void backend;
});

test('empty board is an empty list, not an error', async () => {
  const { remote } = setup();
  assert.deepEqual(await remote.listBoard({ limit: 10 }), { ok: true, data: [] });
});

test('the fake enforces the same rules the client relies on: players are not listable', async () => {
  const { dev } = setup();
  const res = await dev.fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery?key=${API_KEY}`,
    { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'players' }], limit: 5 } }) },
  );
  assert.equal(res.status, 403);
  const noLimit = await dev.fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery?key=${API_KEY}`,
    { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'board' }] } }) },
  );
  assert.equal(noLimit.status, 403);
});

test('board rows that break the rules are refused (name size, negative, range); the size rule is bytes <= 96', async () => {
  const { remote } = setup();
  // rules: name.size() >= 1 && <= 96 (whether size() counts characters or UTF-8 bytes); the client cuts to 24 code points
  assert.equal((await remote.putBoard(BID, row('x'.repeat(97), 1))).reason, 'denied', '97 bytes');
  assert.equal((await remote.putBoard(BID, row('\u{1F600}'.repeat(25), 1))).reason, 'denied', '25 emoji = 100 bytes');
  assert.equal((await remote.putBoard(BID, row('', 1))).reason, 'denied');
  assert.equal((await remote.putBoard(BID, row('A', -1))).reason, 'denied');
  assert.equal((await remote.putBoard(BID, row('A', 1e9))).reason, 'denied');
  assert.equal((await remote.putBoard(BID, row('x'.repeat(96), 1))).ok, true, '96 bytes is the limit');
  assert.equal((await remote.putBoard(BID, row('\u{1F600}'.repeat(24), 1))).ok, true, '24 emoji = 96 bytes: the longest name the client ever sends');
  assert.equal((await remote.putBoard(BID, row('A', 5))).ok, true);
});

test('board list: limit <= 50 AND offset == 0 (paging past the first 50 rows is denied)', async () => {
  const { dev } = setup();
  const q = (structuredQuery) =>
    dev.fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery?key=${API_KEY}`, { method: 'POST', body: JSON.stringify({ structuredQuery }) });
  const from = [{ collectionId: 'board' }];
  assert.equal((await q({ from, limit: 50 })).status, 200);
  assert.equal((await q({ from, limit: 50, offset: 0 })).status, 200);
  assert.equal((await q({ from, limit: 50, offset: 50 })).status, 403);
  assert.equal((await q({ from, limit: 51 })).status, 403);
});

test('wrong API key is denied', async () => {
  const { dev } = setup();
  const remote = createRemote({ projectId: PROJECT, apiKey: 'other', fetch: dev.fetch });
  assert.equal((await remote.getPlayer(ID)).reason, 'denied');
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

// ---- F-01: existence probes must never produce an HTTP 404 (browsers print each one as a console error) ----

test('getPlayer uses documents:batchGet with the full resource name; a missing document is 200 + `missing`, mapped to notfound', async () => {
  const { backend, dev, remote } = setup();
  const r = await remote.getPlayer(ID);
  assert.deepEqual(r, { ok: false, reason: 'notfound', status: 404 });
  assert.equal(backend.notFound, 0, 'the server never answered 404');
  const probe = backend.log.at(-1);
  assert.equal(probe.method, 'POST');
  assert.match(probe.path, /\/documents:batchGet$/);
  assert.equal(backend.log.filter((e) => e.method === 'GET').length, 0, 'no plain GET is ever sent for a player');

  // The wire contract itself, observed directly on the fake.
  const res = await dev.fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:batchGet?key=${API_KEY}`, {
    method: 'POST',
    body: JSON.stringify({ documents: [`projects/${PROJECT}/databases/(default)/documents/players/${ID}`] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].missing, `projects/${PROJECT}/databases/(default)/documents/players/${ID}`);
  assert.ok(body[0].readTime);
});

test('getPlayer returns the document when it exists (found entry), with updateTime for the optimistic write', async () => {
  const { backend, remote } = setup();
  assert.equal((await remote.createPlayer(ID, '{"v":1}')).ok, true);
  const g = await remote.getPlayer(ID);
  assert.equal(g.ok, true);
  assert.equal(g.data.save, '{"v":1}');
  assert.equal(g.data.v, 1);
  assert.ok(g.data.updateTime);
  assert.equal((await remote.updatePlayer(ID, '{"v":1,"x":1}', g.data.updateTime)).ok, true);
  assert.equal(backend.notFound, 0);
});

test('batchGet is authorised like `get`: players and board only, bad names are refused, faults map as before', async () => {
  const { backend, dev, remote } = setup();
  const post = (documents) =>
    dev.fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:batchGet?key=${API_KEY}`, { method: 'POST', body: JSON.stringify({ documents }) });
  const root = `projects/${PROJECT}/databases/(default)/documents`;
  assert.equal((await post([`${root}/secrets/${ID}`])).status, 403, 'unknown collection: denied by the catch-all rule');
  assert.equal((await post([`${root}/players/not-hex`])).status, 400);
  assert.equal((await post([])).status, 400);
  assert.equal((await post([`projects/other/databases/(default)/documents/players/${ID}`])).status, 400);
  backend.faults.deny = true;
  assert.equal((await remote.getPlayer(ID)).reason, 'denied');
  backend.faults.deny = false;
  backend.faults.quota = true;
  assert.equal((await remote.getPlayer(ID)).reason, 'quota');
  backend.faults.quota = false;
  dev.offline = true;
  assert.equal((await remote.getPlayer(ID)).reason, 'offline');
});
