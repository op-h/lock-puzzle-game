import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handle, cleanRow, MAX_SAVE_CHARS } from '../../worker/src/handler.js';
import { createD1Store } from '../../worker/src/d1-store.js';

const ID = 'a'.repeat(64);
const ID2 = 'b'.repeat(64);
const ORIGIN = 'https://op-h.github.io';
const origins = (o) => o === ORIGIN;

/** A D1-shaped wrapper over node:sqlite so the real schema.sql and d1-store.js SQL run in tests. */
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../worker/schema.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      const st = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) {
          args = a;
          return api;
        },
        async first() {
          return st.get(...args) ?? null;
        },
        async all() {
          return { results: st.all(...args) };
        },
        async run() {
          const r = st.run(...args);
          return { meta: { changes: Number(r.changes) } };
        },
      };
      return api;
    },
  };
}

const post = (path, body, headers = {}) =>
  new Request('https://api.test.invalid' + path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'text/plain', ...headers } });
const call = async (store, path, body, headers) => {
  const res = await handle(post(path, body, headers), store, { origins });
  return { status: res.status, json: await res.json(), res };
};

const row = (o = {}) => ({ name: 'Ali', total: 10, blood: 0, solved: 1, bestRun: 0, updatedAt: 1700000000000, ...o });

for (const [label, make] of [['D1 SQL (node:sqlite)', () => createD1Store(fakeD1())]]) {
  test(`${label}: create is create-only, update needs the current revision`, async () => {
    const store = make();
    assert.deepEqual((await call(store, '/player/get', { id: ID })).json, { found: false });
    const c = await call(store, '/player/create', { id: ID, save: 'S1' });
    assert.deepEqual([c.status, c.json], [200, { updateTime: '1' }]);
    assert.equal((await call(store, '/player/create', { id: ID, save: 'EVIL' })).status, 409);
    assert.deepEqual((await call(store, '/player/get', { id: ID })).json, { found: true, v: 1, save: 'S1', updateTime: '1' });

    assert.equal((await call(store, '/player/update', { id: ID, save: 'S2', updateTime: '9' })).status, 409, 'stale revision');
    const u = await call(store, '/player/update', { id: ID, save: 'S2', updateTime: '1' });
    assert.deepEqual([u.status, u.json], [200, { updateTime: '2' }]);
    assert.equal((await call(store, '/player/update', { id: ID, save: 'S3', updateTime: '1' })).status, 409, 'the old revision no longer works');
    assert.equal((await call(store, '/player/update', { id: ID2, save: 'x', updateTime: '1' })).status, 409, 'updating a missing player is a conflict, never an upsert');
    assert.equal((await call(store, '/player/get', { id: ID })).json.save, 'S2');
  });

  test(`${label}: board upsert, ordering, tie-break and limit`, async () => {
    const store = make();
    const ids = ['1', '2', '3', '4'].map((c) => c.repeat(64));
    const rows = [row({ name: 'A', total: 300, bestRun: 10 }), row({ name: 'B', total: 900, bestRun: 5 }), row({ name: 'C', total: 300, bestRun: 50 }), row({ name: 'D', total: 600, bestRun: 20 })];
    for (let i = 0; i < 4; i++) assert.equal((await call(store, '/board/put', { bid: ids[i], row: rows[i] })).status, 200);
    let l = (await call(store, '/board/list', { orderBy: 'total', limit: 10 })).json.rows;
    assert.deepEqual(l.map((r) => r.name), ['B', 'D', 'A', 'C'], 'ties break by bid, so the order is stable');
    l = (await call(store, '/board/list', { orderBy: 'bestRun', limit: 2 })).json.rows;
    assert.deepEqual(l.map((r) => r.name), ['C', 'D']);
    await call(store, '/board/put', { bid: ids[0], row: row({ name: 'A2', total: 5000 }) });
    l = (await call(store, '/board/list', { orderBy: 'total', limit: 1 })).json.rows;
    assert.equal(l[0].name, 'A2');
    assert.equal((await call(store, '/board/list', { orderBy: 'total', limit: 50 })).json.rows.length, 4, 'one row per bid, never duplicates');
    assert.deepEqual(Object.keys(l[0]).sort(), ['bestRun', 'bid', 'blood', 'name', 'solved', 'total', 'updatedAt']);
  });

  test(`${label}: hostile strings are bound, never executed`, async () => {
    const store = make();
    const evil = `x'); DROP TABLE players; --`;
    assert.equal((await call(store, '/player/create', { id: ID, save: evil })).status, 200);
    assert.equal((await call(store, '/board/put', { bid: ID, row: row({ name: evil }) })).status, 200);
    assert.equal((await call(store, '/player/get', { id: ID })).json.save, evil);
    assert.equal((await call(store, '/board/list', { orderBy: 'total; DROP TABLE board', limit: 5 })).json.rows[0].name, evil, 'unknown orderBy falls back to total');
  });
}

test('validation: ids, shapes, sizes, ranges', async () => {
  const store = createD1Store(fakeD1());
  for (const bad of ['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 5, null]) {
    assert.equal((await call(store, '/player/get', { id: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call(store, '/player/create', { id: ID, save: 5 })).status, 400);
  assert.equal((await call(store, '/player/create', { id: ID, save: 'x'.repeat(MAX_SAVE_CHARS + 1) })).status, 413);
  assert.equal((await call(store, '/player/create', { id: ID, save: 'x'.repeat(MAX_SAVE_CHARS) })).status, 200, 'the limit itself is allowed');
  for (const t of [undefined, 1, '', 'x', '-1', '1.5', '1'.repeat(16)]) {
    assert.equal((await call(store, '/player/update', { id: ID, save: 's', updateTime: t })).status, 400, `updateTime ${JSON.stringify(t)}`);
  }
  assert.equal((await call(store, '/board/list', { limit: 0 })).status, 400);
  assert.equal((await call(store, '/board/list', { limit: 51 })).status, 400);
  assert.equal((await call(store, '/board/list', { limit: '5' })).status, 200, 'a non-integer limit falls back to the default');
});

test('board rows: exact keys, integer ranges, name 1..96 UTF-8 bytes', () => {
  assert.ok(cleanRow(row()));
  assert.equal(cleanRow(row({ extra: 1 })), null, 'extra key');
  const { name, ...noName } = row();
  assert.equal(name, 'Ali');
  assert.equal(cleanRow(noName), null, 'missing key');
  for (const bad of [{ name: '' }, { name: 'x'.repeat(97) }, { name: '\u{1F600}'.repeat(25) }, { name: 5 }, { total: -1 }, { total: 1.5 }, { total: 1e9 }, { solved: 1e7 }, { updatedAt: 1e15 }, { bestRun: '5' }, { blood: NaN }]) {
    assert.equal(cleanRow(row(bad)), null, JSON.stringify(bad));
  }
  assert.ok(cleanRow(row({ name: 'x'.repeat(96) })));
  assert.ok(cleanRow(row({ name: '\u{1F600}'.repeat(24) })));
  assert.equal(cleanRow(null), null);
  assert.equal(cleanRow([]), null);
});

test('transport: method, JSON, body size, route, no stored state leaks through errors', async () => {
  const store = createD1Store(fakeD1());
  assert.equal((await handle(new Request('https://x.invalid/player/get'), store, { origins })).status, 405);
  assert.equal((await call(store, '/player/get', 'not json')).status, 400);
  assert.equal((await call(store, '/player/get', '[1]')).status, 400);
  assert.equal((await call(store, '/player/get', 'null')).status, 400);
  assert.equal((await call(store, '/nope', {})).status, 404);
  assert.equal((await call(store, '/player/get/', { id: ID })).status, 200, 'trailing slash tolerated');
  assert.equal((await call(store, '/player/create', { id: ID, save: 'x'.repeat(950000) })).status, 413);
  const lying = await handle(post('/player/get', {}, { 'Content-Length': '99999999' }), store, { origins });
  assert.equal(lying.status, 413, 'a declared oversize body is refused before it is read');

  const broken = { ...store, getPlayer: async () => { throw new Error("SQL: SELECT secret FROM players WHERE id='" + ID + "'"); } };
  const r = await call(broken, '/player/get', { id: ID });
  assert.deepEqual([r.status, r.json], [503, { error: 'unavailable' }], 'store errors are never forwarded');
});

test('responses are never cached', async () => {
  const store = createD1Store(fakeD1());
  const { res } = await call(store, '/player/get', { id: ID });
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.match(res.headers.get('Content-Type'), /^application\/json/);
});

test('CORS: only the site origin is echoed; foreign browsers get 403; preflight is answered; no Origin (curl) still works', async () => {
  const store = createD1Store(fakeD1());
  const ok = await call(store, '/player/get', { id: ID }, { Origin: ORIGIN });
  assert.equal(ok.res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(ok.res.headers.get('Vary'), /Origin/);

  const evil = await call(store, '/player/get', { id: ID }, { Origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.equal(evil.res.headers.get('Access-Control-Allow-Origin'), null);

  const pre = await handle(new Request('https://x.invalid/player/get', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), store, { origins });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /POST/);
  const preEvil = await handle(new Request('https://x.invalid/player/get', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), store, { origins });
  assert.equal(preEvil.headers.get('Access-Control-Allow-Origin'), null);

  assert.equal((await call(store, '/player/get', { id: ID })).status, 200);
});

test('a concurrent create of one id has exactly one winner', async () => {
  const store = createD1Store(fakeD1());
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => call(store, '/player/create', { id: ID, save: 'S' + i })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 4);
});

test('schema: ids must be 64 chars, v must be 1, and the script is idempotent', () => {
  const db = new DatabaseSync(':memory:');
  const sql = readFileSync(new URL('../../worker/schema.sql', import.meta.url), 'utf8');
  db.exec(sql);
  db.exec(sql);
  assert.throws(() => db.prepare("INSERT INTO players (id, v, save, rev) VALUES ('short', 1, 's', 1)").run());
  assert.throws(() => db.prepare('INSERT INTO players (id, v, save, rev) VALUES (?, 2, ?, 1)').run(ID, 's'));
});

// ---- guess limiter (ADR 0008) ----------------------------------------------------------------------------------------

import { GUESS_CAP, GUESS_REFILL_MS, clientKey } from '../../worker/src/handler.js';

const hexId = (n) => n.toString(16).padStart(64, '0');
/** A client with its own address and a controllable clock. */
function client(store, ip, clock) {
  return async (path, body) => {
    const res = await handle(post(path, body, ip ? { 'CF-Connecting-IP': ip } : {}), store, { origins, now: () => clock.t });
    return { status: res.status, json: await res.json(), res };
  };
}
const fresh = () => ({ store: createD1Store(fakeD1()), clock: { t: 1_700_000_000_000 } });

test('limiter: the 41st missed lookup from one address is refused with 429 + retry hint', async () => {
  const { store, clock } = fresh();
  const c = client(store, '203.0.113.7', clock);
  for (let i = 0; i < GUESS_CAP; i++) assert.deepEqual((await c('/player/get', { id: hexId(i) })).json, { found: false }, `miss ${i + 1}`);
  const blocked = await c('/player/get', { id: hexId(999) });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error, 'rate');
  assert.equal(blocked.json.retryAfter, GUESS_REFILL_MS / 1000);
  assert.equal(blocked.res.headers.get('Retry-After'), String(GUESS_REFILL_MS / 1000));
});

test('limiter: a blocked client learns nothing, not even from a CORRECT guess', async () => {
  const { store, clock } = fresh();
  await store.createPlayer(hexId(777), 'secret-save');
  const c = client(store, '203.0.113.7', clock);
  for (let i = 0; i < GUESS_CAP; i++) await c('/player/get', { id: hexId(i) });
  const r = await c('/player/get', { id: hexId(777) });
  assert.equal(r.status, 429);
  assert.equal(JSON.stringify(r.json).includes('secret-save'), false);
  assert.equal(r.json.found, undefined);
  // the create route is the other existence oracle (409 when the id exists): it is gated by the same bucket
  const cr = await c('/player/create', { id: hexId(777), save: 'x' });
  assert.equal(cr.status, 429, 'not 409');
  const cr2 = await c('/player/create', { id: hexId(778), save: 'x' });
  assert.equal(cr2.status, 429);
  assert.equal(await store.getPlayer(hexId(778)), null, 'a blocked create writes nothing');
});

test('limiter: hits are free, so a normal signed-in session is never throttled', async () => {
  const { store, clock } = fresh();
  await store.createPlayer(hexId(1), 's');
  const c = client(store, '203.0.113.7', clock);
  for (let i = 0; i < GUESS_CAP * 3; i++) assert.equal((await c('/player/get', { id: hexId(1) })).json.found, true);
  assert.equal((await c('/player/get', { id: hexId(2) })).status, 200, 'the budget is still full');
});

test('limiter: creates cost a token each, whatever the outcome; updates and the board are free', async () => {
  const { store, clock } = fresh();
  const c = client(store, '203.0.113.7', clock);
  for (let i = 0; i < GUESS_CAP; i++) {
    const r = await c('/player/create', { id: hexId(i), save: 's' });
    assert.equal(r.status, 200, `create ${i + 1}`);
  }
  assert.equal((await c('/player/create', { id: hexId(5000), save: 's' })).status, 429, 'creating accounts in bulk is limited too');
  // free while the bucket is empty: updates (no oracle: a missing id is a plain conflict) and leaderboard calls
  assert.equal((await c('/player/update', { id: hexId(0), save: 's2', updateTime: '1' })).status, 200);
  assert.equal((await c('/player/update', { id: hexId(5000), save: 's2', updateTime: '1' })).status, 409);
  assert.equal((await c('/board/put', { bid: hexId(1), row: row() })).status, 200);
  assert.equal((await c('/board/list', { orderBy: 'total', limit: 5 })).status, 200);
});

test('limiter: one token comes back every 20 s, up to the cap', async () => {
  const { store, clock } = fresh();
  const c = client(store, '203.0.113.7', clock);
  for (let i = 0; i < GUESS_CAP; i++) await c('/player/get', { id: hexId(i) });
  assert.equal((await c('/player/get', { id: hexId(100) })).status, 429);
  clock.t += GUESS_REFILL_MS - 1;
  const almost = await c('/player/get', { id: hexId(101) });
  assert.equal(almost.status, 429);
  assert.equal(almost.json.retryAfter, 1, 'the hint counts down');
  clock.t += 1;
  assert.equal((await c('/player/get', { id: hexId(102) })).status, 200, 'one token is back');
  assert.equal((await c('/player/get', { id: hexId(103) })).status, 429, 'and only one');
  clock.t += GUESS_REFILL_MS * 1000; // a very long pause never banks more than the cap
  for (let i = 0; i < GUESS_CAP; i++) assert.equal((await c('/player/get', { id: hexId(200 + i) })).status, 200);
  assert.equal((await c('/player/get', { id: hexId(999) })).status, 429);
});

test('limiter: addresses are separate; an IPv6 client is bucketed by its /64; raw addresses are never stored', async () => {
  const db = fakeD1();
  const store = createD1Store(db);
  const clock = { t: 1_700_000_000_000 };
  const a = client(store, '203.0.113.7', clock);
  const b = client(store, '203.0.113.8', clock);
  for (let i = 0; i < GUESS_CAP; i++) await a('/player/get', { id: hexId(i) });
  assert.equal((await a('/player/get', { id: hexId(900) })).status, 429);
  assert.equal((await b('/player/get', { id: hexId(900) })).status, 200, 'a neighbour is unaffected');

  const v6 = (suffix) => client(store, `2001:db8:1:2:${suffix}`, clock);
  for (let i = 0; i < GUESS_CAP; i++) await v6(`${i.toString(16)}::1`)('/player/get', { id: hexId(i) });
  assert.equal((await v6('ffff:ffff:ffff:ffff')('/player/get', { id: hexId(901) })).status, 429, 'rotating the low 64 bits does not help');
  assert.equal((await client(store, '2001:db8:1:3::1', clock)('/player/get', { id: hexId(901) })).status, 200, 'another /64 is another client');
  assert.equal(clientKey(post('/x', {}, { 'CF-Connecting-IP': '2001:db8:1:2:0:0:0:1' })), clientKey(post('/x', {}, { 'CF-Connecting-IP': '2001:DB8:1:2::9' })), 'compressed and expanded spellings agree');
  assert.match(clientKey(post('/x', {})), /^[0-9a-f]{32}$/);

  const keys = (await db.prepare('SELECT k FROM limits').all()).results.map((r) => r.k);
  assert.ok(keys.length >= 3);
  for (const k of keys) assert.match(k, /^[0-9a-f]{32}$/);
  assert.equal(keys.join('|').includes('203'), false, 'no address text in the table');
});

test('limiter SQL: spend floors at zero, refill is capped, and old rows are swept', async () => {
  const db = fakeD1();
  const store = createD1Store(db);
  const T = 1_700_000_000_000;
  await store.guessSpend('k', T);
  assert.equal((await db.prepare('SELECT tokens FROM limits WHERE k = ?1').bind('k').first()).tokens, GUESS_CAP - 1);
  for (let i = 0; i < GUESS_CAP + 10; i++) await store.guessSpend('k', T);
  assert.equal((await db.prepare('SELECT tokens FROM limits WHERE k = ?1').bind('k').first()).tokens, 0, 'never negative');
  assert.equal(await store.guessWait('k', T), GUESS_REFILL_MS / 1000);
  assert.equal(await store.guessWait('k', T + GUESS_REFILL_MS * 2.5), 0);
  assert.equal(await store.guessWait('never-seen', T), 0);
  await store.guessSpend('k', T + 10 * GUESS_REFILL_MS * GUESS_CAP);
  assert.equal((await db.prepare('SELECT tokens FROM limits WHERE k = ?1').bind('k').first()).tokens, GUESS_CAP - 1, 'a long pause refills to the cap, no further');

  const realRandom = Math.random;
  Math.random = () => 0; // force the sweep
  try {
    await store.guessSpend('other', T + 3 * 86400000);
  } finally {
    Math.random = realRandom;
  }
  const left = (await db.prepare('SELECT k FROM limits').all()).results.map((r) => r.k);
  assert.deepEqual(left, ['other'], 'rows untouched for a day are gone');
});

test('limiter: a limiter failure fails closed (503), never open', async () => {
  const { store, clock } = fresh();
  const broken = { ...store, guessWait: async () => { throw new Error('d1 down'); } };
  const r = await client(broken, '203.0.113.7', clock)('/player/get', { id: hexId(1) });
  assert.deepEqual([r.status, r.json], [503, { error: 'unavailable' }]);
});
