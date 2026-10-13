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
