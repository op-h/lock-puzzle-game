import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSaves, emptySave, derive, sanitizeSave, parseSave, sanitizeHistoryEntry } from '../../js/sync/merge.js';

/** Tiny seeded PRNG so a failing property test is reproducible from the printed seed. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIFFS = ['rookie', 'agent', 'hacker', 'master'];

function makeGen(seed) {
  const r = prng(seed);
  const int = (n) => Math.floor(r() * n);
  const pick = (xs) => xs[int(xs.length)];

  const junk = () =>
    pick([null, undefined, 'x', -1, 1.5, NaN, Infinity, {}, [], true, '12', 1e30, { id: 1 }, [1, 2], '__proto__']);

  // A tiny id pool guarantees duplicates both within and across saves.
  const entry = () => {
    const e = {
      id: 'h' + int(12),
      m: pick(['c', 'b']),
      d: pick(DIFFS),
      pts: int(900),
      s: int(300),
      w: int(5),
      h: int(2),
      t: 1000 + int(50),
    };
    if (r() < 0.2) e.r = 'run' + int(3);
    if (r() < 0.15) e.extra = 'ignored';
    if (r() < 0.1) e.pts = junk(); // corrupted points
    if (r() < 0.05) e.m = 'z'; // unknown mode
    if (r() < 0.05) e.d = 'impossible';
    if (r() < 0.05) delete e[pick(['id', 'pts', 's', 'w', 'h', 't', 'm', 'd'])];
    if (r() < 0.05) return junk();
    return e;
  };
  const run = () => {
    const e = { id: 'r' + int(6), t: 2000 + int(20), solved: int(10), pts: int(5000) };
    if (r() < 0.1) e.pts = junk();
    if (r() < 0.05) delete e.id;
    return e;
  };
  const list = (f) => Array.from({ length: int(8) }, f);

  return () => {
    if (r() < 0.04) return junk(); // not even an object
    const s = { v: 1 };
    if (r() < 0.9) s.name = pick(['Ali', 'ali', 'Sara', 'حسين', '']);
    if (r() < 0.9) s.createdAt = pick([500, 1000, 1500, 1500]);
    if (r() < 0.9) s.updatedAt = 1000 + int(100);
    if (r() < 0.9) s.history = list(entry);
    if (r() < 0.9) s.runs = list(run);
    if (r() < 0.85) s.settings = { lang: pick(['en', 'ar']), sound: r() < 0.5, at: pick([0, 5, 5, 9]) };
    if (r() < 0.05) s.settings = junk();
    if (r() < 0.03) s.history = junk();
    if (r() < 0.03) s.v = 2;
    return s;
  };
}

const merged = (a, b) => mergeSaves(a, b).save;

test('mergeSaves laws hold over 3000 random (and corrupt) saves', () => {
  const gen = makeGen(0xc0ffee);
  for (let i = 0; i < 3000; i++) {
    const a = gen();
    const b = gen();
    const c = gen();
    const ctx = `case ${i}`;
    assert.deepEqual(merged(a, b), merged(b, a), `commutative, ${ctx}`);
    assert.deepEqual(merged(merged(a, b), c), merged(a, merged(b, c)), `associative, ${ctx}`);
    assert.deepEqual(merged(a, a), sanitizeSave(a).save, `idempotent, ${ctx}`);
    const ab = merged(a, b);
    assert.deepEqual(merged(ab, a), ab, `absorbs its inputs, ${ctx}`);
    assert.deepEqual(merged(ab, ab), ab, `idempotent on results, ${ctx}`);
    // The output is always itself a valid canonical save: re-sanitising drops nothing and changes nothing.
    const again = sanitizeSave(ab);
    assert.equal(again.dropped, 0, `output is clean, ${ctx}`);
    assert.deepEqual(again.save, ab, `output is canonical, ${ctx}`);
  }
});

test('merging with empty/undefined/null is the identity', () => {
  const gen = makeGen(7);
  for (let i = 0; i < 200; i++) {
    const a = gen();
    const s = sanitizeSave(a).save;
    for (const z of [undefined, null, {}, emptySave('', 0)]) {
      const m = merged(a, z);
      assert.deepEqual(m.history, s.history);
      assert.deepEqual(m.runs, s.runs);
    }
    assert.deepEqual(merged(a, undefined), s);
  }
});

test('never throws on arbitrary input', () => {
  const weird = [
    undefined, null, 0, 1, 'str', true, [], [1], {}, { history: 'no' }, { history: [null, 1, 'x', [], {}] },
    { runs: { a: 1 } }, { settings: [] }, { v: 'one' }, { name: {} }, { createdAt: -5 }, Object.create(null),
    JSON.parse('{"__proto__": {"polluted": 1}, "history": [{"id":"a","m":"c","d":"constructor","pts":1,"s":1,"w":0,"h":0,"t":1}]}'),
  ];
  for (const a of weird) for (const b of weird) assert.doesNotThrow(() => mergeSaves(a, b));
  assert.equal({}.polluted, undefined, 'no prototype pollution');
  assert.doesNotThrow(() => derive(null));
  assert.doesNotThrow(() => derive({ history: [null, 5, { pts: 'x' }], runs: [null, 3] }));
});

test('derive survives a hostile difficulty id without touching prototypes', () => {
  const d = derive({ history: [{ m: 'c', d: 'constructor', pts: 5 }, { m: 'c', d: '__proto__', pts: 5 }] });
  assert.equal(d.total, 10);
  assert.equal(Function.prototype.solved, undefined);
  assert.equal(Object.prototype.solved, undefined);
});

test('invalid entries are dropped and counted, valid ones kept', () => {
  const good = { id: 'ok', m: 'c', d: 'rookie', pts: 10, s: 5, w: 0, h: 0, t: 1 };
  const bads = [
    { ...good, id: 'a', pts: -1 },
    { ...good, id: 'b', pts: 1.5 },
    { ...good, id: 'c', pts: '10' },
    { ...good, id: 'd', pts: NaN },
    { ...good, id: 'e', m: 'x' },
    { ...good, id: 'f', d: 'nightmare' },
    { ...good, id: '', },
    { ...good, id: 'g', h: 2 },
    { ...good, id: 'h', t: -3 },
    { ...good, id: 'i', s: 0.5 },
    { ...good, id: 'j', r: 7 },
    { ...good, id: 'k', pts: 1e12 },
    null,
    'x',
  ];
  const { save, dropped } = sanitizeSave({ v: 1, name: 'A', createdAt: 1, history: [good, ...bads] });
  assert.equal(dropped, bads.length);
  assert.deepEqual(save.history.map((e) => e.id), ['ok']);
  assert.equal(mergeSaves({ history: bads }, { history: [good, null] }).dropped, bads.length + 1);
});

test('missing fields are not "dropped"; wrong-typed ones are', () => {
  assert.equal(sanitizeSave({}).dropped, 0);
  assert.equal(sanitizeSave(undefined).dropped, 0);
  assert.equal(sanitizeSave({ history: 'x', runs: 5, settings: 'y', name: 3, createdAt: 'z' }).dropped, 5);
  assert.equal(sanitizeSave('nope').dropped, 1);
  assert.equal(sanitizeSave({ v: 2, history: [] }).dropped, 1, 'unknown schema version is ignored, not guessed at');
});

test('union by id: same solve on two devices counts once', () => {
  const e = { id: 's1', m: 'c', d: 'agent', pts: 120, s: 40, w: 1, h: 0, t: 10 };
  const a = { ...emptySave('Ali', 5), history: [e] };
  const b = { ...emptySave('Ali', 5), history: [e, { ...e, id: 's2', pts: 80, t: 11 }] };
  const m = merged(a, b);
  assert.equal(m.history.length, 2);
  assert.equal(derive(m).total, 200);
  assert.equal(derive(m).solved, 2);
});

test('conflicting entries with one id resolve identically in both orders', () => {
  const x = { id: 's1', m: 'c', d: 'agent', pts: 120, s: 40, w: 1, h: 0, t: 10 };
  const y = { ...x, pts: 121 };
  assert.deepEqual(merged({ history: [x] }, { history: [y] }), merged({ history: [y] }, { history: [x] }));
  assert.equal(merged({ history: [x] }, { history: [y] }).history.length, 1);
});

test('settings: last writer wins by `at`; name/createdAt come from the earliest account copy', () => {
  const a = { ...emptySave('Ali', 100), settings: { lang: 'ar', sound: false, at: 50 } };
  const b = { ...emptySave('ALI', 200), settings: { lang: 'en', sound: true, at: 60 } };
  const m = merged(a, b);
  assert.deepEqual(m.settings, { lang: 'en', sound: true, at: 60 });
  assert.equal(m.name, 'Ali');
  assert.equal(m.createdAt, 100);
  assert.equal(m.updatedAt, 200);
});

test('a damaged copy cannot overwrite a healthy copy\'s identity', () => {
  const healthy = emptySave('Ali', 100);
  const damaged = { v: 1, name: 7, createdAt: 'x', history: [] };
  const m = merged(damaged, healthy);
  assert.equal(m.name, 'Ali');
  assert.equal(m.createdAt, 100);
});

test('derive: classic/blood/total/solved/bestRun/byDifficulty', () => {
  const h = (id, m, d, pts) => ({ id, m, d, pts, s: 1, w: 0, h: 0, t: 1 });
  const save = {
    ...emptySave('A', 1),
    history: [h('1', 'c', 'rookie', 100), h('2', 'c', 'agent', 50), h('3', 'b', 'hacker', 300), h('4', 'b', 'rookie', 40)],
    runs: [
      { id: 'r1', t: 1, solved: 2, pts: 340 },
      { id: 'r2', t: 2, solved: 1, pts: 500 },
    ],
  };
  const d = derive(save);
  assert.equal(d.classic, 150);
  assert.equal(d.blood, 340);
  assert.equal(d.total, 490);
  assert.equal(d.solved, 4);
  assert.equal(d.bestRun, 500);
  assert.deepEqual(d.byDifficulty.rookie, { solved: 2, pts: 140 });
  assert.deepEqual(d.byDifficulty.master, { solved: 0, pts: 0 });
  assert.deepEqual(derive(emptySave('x', 1)), {
    classic: 0, blood: 0, total: 0, solved: 0, bestRun: 0,
    byDifficulty: { rookie: { solved: 0, pts: 0 }, agent: { solved: 0, pts: 0 }, hacker: { solved: 0, pts: 0 }, master: { solved: 0, pts: 0 } },
  });
});

test('totals are additive over disjoint logs (no double count, no loss)', () => {
  const gen = makeGen(99);
  for (let i = 0; i < 300; i++) {
    const a = sanitizeSave(gen()).save;
    // rename b's ids so the two logs are disjoint
    const b0 = sanitizeSave(gen()).save;
    const b = { ...b0, history: b0.history.map((e) => ({ ...e, id: 'B' + e.id })) };
    assert.equal(derive(merged(a, b)).total, derive(a).total + derive(b).total);
  }
});

test('parseSave: JSON text in, never throws', () => {
  assert.equal(parseSave('{not json').ok, false);
  assert.equal(parseSave('[1]').ok, false);
  assert.equal(parseSave('null').ok, false);
  assert.equal(parseSave(undefined).ok, false);
  const ok = parseSave(JSON.stringify(emptySave('A', 5)));
  assert.equal(ok.ok, true);
  assert.equal(ok.dropped, 0);
});

test('emptySave is canonical and valid', () => {
  const s = emptySave('Ali', 1234);
  assert.deepEqual(s, {
    v: 1, name: 'Ali', createdAt: 1234, updatedAt: 1234, history: [], runs: [],
    settings: { lang: 'en', sound: true, at: 0 },
  });
  assert.deepEqual(sanitizeSave(s), { save: s, dropped: 0 });
  assert.equal(sanitizeHistoryEntry(null), null);
});
