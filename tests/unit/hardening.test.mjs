// Regression tests for the hostile-review findings: board key, no-leak sign-up, cross-tab, newer saves, storage failure.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createSync } from '../../js/sync/sync.js';
import { createLocal, createMemoryStorage } from '../../js/sync/local.js';
import { mergeSaves, emptySave, sanitizeSave, sanitizeHistoryEntry, sanitizeRunEntry, derive, parseSave, MAX_ENTRY_PTS } from '../../js/sync/merge.js';
import { playerId, boardId, generateBoardKey, normalizeName } from '../../js/sync/identity.js';
import { watchTabs } from '../../js/sync/tabs.js';
import { sanitizeProgress, isForeignActive, HEARTBEAT_STALE_MS } from '../../js/game/progress.js';
import { asciiDigit } from '../../js/ui/dom.js';
import { createFakeFirestore } from './helpers/fake-firestore.mjs';
import { createDevice, guardGlobalFetch, solve } from './helpers/harness.mjs';

let guard;
before(() => {
  guard = guardGlobalFetch();
});
after(() => {
  guard.restore();
  assert.equal(guard.calls, 0);
});

const sha = (s) => createHash('sha256').update(s).digest('hex');
const keysOf = (storage) => Array.from({ length: storage.length }, (_, i) => storage.key(i)).sort();
const BK1 = '0123456789abcdef0123456789abcdef';
const BK2 = '00ffeeddccbbaa998877665544332211';
const BK3 = 'ffffffffffffffffffffffffffffffff';

async function signUp(dev, name = 'Ali', ack = true) {
  const r = await dev.sync.signUp(name);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (ack) assert.equal(dev.sync.acknowledge().ok, true);
  return r;
}

// ================= Finding 1: the board key =================

test('bk: merge keeps the lexicographically smaller VALID key; commutative, associative, idempotent', () => {
  const mk = (bk) => ({ ...emptySave('Ali', 5), ...(bk === undefined ? {} : { bk }) });
  const pick = (...bks) => bks.map(mk).reduce((a, b) => mergeSaves(a, b).save).bk;
  assert.equal(pick(BK1, BK2), BK2);
  assert.equal(pick(BK2, BK1), BK2);
  assert.equal(pick(BK1, undefined), BK1);
  assert.equal(pick(undefined, BK1), BK1);
  assert.equal(pick(undefined, undefined), undefined);
  assert.equal(pick(BK1, BK2, BK3), BK2);
  assert.equal(pick(BK3, BK1, BK2), BK2);
  const a = mk(BK1), b = mk(BK2), c = mk(BK3);
  const L = mergeSaves(mergeSaves(a, b).save, c).save;
  const R = mergeSaves(a, mergeSaves(b, c).save).save;
  assert.deepEqual(L, R, 'associative');
  assert.deepEqual(mergeSaves(a, b).save, mergeSaves(b, a).save, 'commutative');
  assert.deepEqual(mergeSaves(a, a).save, a, 'idempotent');
});

test('bk: invalid candidates are ignored (never win, never crash); a save without one serialises exactly as before', () => {
  for (const bad of ['', 'abc', BK1.toUpperCase(), BK1 + '0', BK1.slice(1), 'g'.repeat(32), 42, null, {}, ['a']]) {
    const s = sanitizeSave({ ...emptySave('Ali', 5), bk: bad });
    assert.equal('bk' in s.save, false, JSON.stringify(bad));
    assert.equal(mergeSaves({ ...emptySave('Ali', 5), bk: BK1 }, { ...emptySave('Ali', 5), bk: bad }).save.bk, BK1);
  }
  const plain = emptySave('Ali', 5);
  assert.equal('bk' in plain, false);
  assert.equal(JSON.stringify(Object.keys(plain)), '["v","name","createdAt","updatedAt","history","runs","settings"]');
  assert.equal(parseSave(JSON.stringify({ ...plain, bk: BK1 })).save.bk, BK1);
});

test('bk: sign-up creates one; the board row id is H("lp1-board:"+bk), not derivable from name+code', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const { code, id } = await signUp(A, 'Ali');
  const bk = A.sync.getSave().bk;
  assert.match(bk, /^[0-9a-f]{32}$/);
  A.sync.recordSolve(solve('s1', 100, { t: 5 }));
  await A.sync.flush();
  const bid = await boardId(bk);
  assert.equal(bid, sha('lp1-board:' + bk));
  const row = backend.get('board/' + bid);
  assert.ok(row);
  // What an attacker can compute from (name, code): none of it is the row id.
  const key = normalizeName('Ali');
  assert.notEqual(bid, sha('lp1-board:' + id));
  assert.notEqual(bid, sha('lp1-board:' + (await playerId('Ali', code))));
  assert.notEqual(bid, sha('lp1-board:' + code));
  assert.deepEqual(
    [...backend.docs.keys()].filter((k) => k.startsWith('board/')),
    ['board/' + bid],
  );
  assert.ok(!JSON.stringify(row.fields).includes(code));
  assert.ok(!JSON.stringify(row.fields).includes(id));
  assert.ok(!JSON.stringify(row.fields).includes(bk), 'the key itself is never published, only its hash');
  void key;
});

test('bk: a save that predates the field gets one lazily at its first push; two devices converge on the smaller', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const B = createDevice(backend);
  const { code, id } = await signUp(A, 'Ali');
  // simulate an old account: strip bk from the cloud copy and from A's disk
  const old = { ...A.sync.getSave() };
  delete old.bk;
  backend.put('players/' + id, { v: { integerValue: '1' }, save: { stringValue: JSON.stringify(old) } });
  A.local.storeSave(id, old); // read-merge-write keeps the existing bk, so wipe through the raw key
  A.storage.setItem('lp1.save.' + id, JSON.stringify(old));
  assert.equal(parseSave(A.storage.getItem('lp1.save.' + id)).save.bk, undefined);

  // two fresh devices each sign in to the bk-less account while offline-ish: each generates its own key
  const A2 = createDevice(backend, { start: 2_000_000 });
  await A2.sync.signIn('Ali', code);
  await B.sync.signIn('Ali', code);
  assert.equal(A2.sync.getSave().bk, undefined);
  A2.sync.recordSolve(solve('x1', 10, { t: 6 }));
  await A2.sync.flush();
  const k2 = A2.sync.getSave().bk;
  assert.match(k2, /^[0-9a-f]{32}$/, 'created before the first push');
  const stored = parseSave(backend.get('players/' + id).fields.save.stringValue).save;
  assert.equal(stored.bk, k2, 'and pushed with it');
  // B pulls and adopts the same key (the smaller of what it has and what is in the cloud)
  B.sync.recordSolve(solve('x2', 10, { t: 7 }));
  await B.sync.flush();
  assert.equal(B.sync.getSave().bk, k2 < (B.sync.getSave().bk) ? k2 : B.sync.getSave().bk);
  await A2.sync.pull();
  assert.equal(A2.sync.getSave().bk, B.sync.getSave().bk, 'both devices agree');
});

test('merge caps: one solve is at most 5000 points; a run at most 5000 per solved puzzle', () => {
  const good = { id: 'a', m: 'c', d: 'master', pts: MAX_ENTRY_PTS, s: 1, w: 0, h: 0, t: 1 };
  assert.ok(sanitizeHistoryEntry(good));
  assert.equal(sanitizeHistoryEntry({ ...good, pts: MAX_ENTRY_PTS + 1 }), null);
  assert.equal(sanitizeHistoryEntry({ ...good, pts: 1_000_000 }), null);
  assert.ok(sanitizeHistoryEntry({ ...good, pts: 2400 }), 'the legitimate maximum is far below the cap');
  assert.ok(sanitizeRunEntry({ id: 'r', t: 1, solved: 2, pts: 10000 }));
  assert.equal(sanitizeRunEntry({ id: 'r', t: 1, solved: 2, pts: 10001 }), null);
  assert.equal(sanitizeRunEntry({ id: 'r', t: 1, solved: 0, pts: 1 }), null);
  assert.ok(sanitizeRunEntry({ id: 'r', t: 1, solved: 0, pts: 0 }));
  const forged = { ...emptySave('Evil', 1), history: [{ ...good, id: 'f', pts: 999_999 }], runs: [{ id: 'fr', t: 1, solved: 1, pts: 999_999 }] };
  const { save, dropped } = mergeSaves(emptySave('Evil', 1), forged);
  assert.equal(dropped, 2);
  assert.equal(derive(save).total, 0);
});

// ================= Finding 6: no session until the code is acknowledged =================

test('sign-up writes NOTHING to storage until the code is acknowledged; then session + save appear', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const r = await signUp(A, 'Ali', false);
  assert.equal(A.sync.isPending(), true);
  A.sync.updateSettings({ lang: 'ar', sound: false });
  A.sync.recordSolve(solve('s1', 5));
  assert.deepEqual(keysOf(A.storage).filter((k) => k !== 'lp1.lang'), [], 'no session, save or dirty flag');
  assert.equal(A.local.getSession(), null);
  assert.equal(A.sync.acknowledge().ok, true);
  assert.equal(A.sync.isPending(), false);
  assert.equal(A.local.getSession().id, r.id);
  const saved = A.local.loadSave(r.id);
  assert.equal(saved.history.length, 1);
  assert.equal(saved.settings.lang, 'ar');
  assert.equal(A.sync.acknowledge().ok, false, 'second acknowledge is a no-op');
});

test('reload with the code dialog still open (never acknowledged) resumes to NO session', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  await signUp(A, 'Ali', false);
  // "reload": a brand new sync on the same storage
  const local = createLocal({ storage: A.storage });
  const sync = createSync({ remote: A.remote, local, clock: () => 5, timers: A.timers, events: new EventTarget(), isHidden: () => false });
  const r = await sync.resume();
  assert.equal(r.session, null);
  assert.equal(sync.getSession(), null);
});

test('boot sweep: with no session, orphan save/dirty/run keys are removed; language and prefs survive', () => {
  const storage = createMemoryStorage();
  const local = createLocal({ storage });
  const id = 'c'.repeat(64);
  storage.setItem('lp1.save.' + id, JSON.stringify(emptySave('Ghost', 1)));
  storage.setItem('lp1.dirty.' + id, '1');
  storage.setItem('lp1.run.' + id, '{}');
  storage.setItem('lp1.lang', 'ar');
  local.storePref({ difficulty: 'agent' });
  assert.equal(local.getSession(), null);
  local.clearAccount(); // what main.js does at boot when there is no session
  assert.deepEqual(keysOf(storage), ['lp1.lang', 'lp1.pref']);
});

// ================= Finding 4: cross-tab =================

function tabsOn(storage, backend, start = 3_000_000) {
  const dev = createDevice(backend, { start });
  const local = createLocal({ storage });
  const events = new EventTarget();
  const sync = createSync({ remote: dev.remote, local, clock: () => dev.now, timers: dev.timers, events, isHidden: () => false });
  const handlers = [];
  const win = { addEventListener: (t, f) => t === 'storage' && handlers.push(f), removeEventListener: (t, f) => handlers.splice(handlers.indexOf(f), 1) };
  return { dev, local, sync, win, fire: (key, newValue) => handlers.slice().forEach((h) => h({ key, newValue })) };
}

async function twoTabs() {
  const backend = createFakeFirestore();
  const storage = createMemoryStorage();
  const t1 = tabsOn(storage, backend);
  await t1.sync.signUp('Ali');
  t1.sync.acknowledge();
  const t2 = tabsOn(storage, backend);
  const r = await t2.sync.resume();
  assert.equal(r.session.name, 'Ali');
  const id = t1.sync.getSession().id;
  return { backend, storage, t1, t2, id };
}

test('storage layer: every save write is a read-MERGE-write (another tab\'s solves survive)', async () => {
  const { storage, t1, t2, id } = await twoTabs();
  t1.sync.recordSolve(solve('from-tab-1', 100, { t: 10 }));
  // tab 2 has not heard about it (no storage event delivered), and now writes its own solve
  assert.equal(t2.sync.getSave().history.length, 0);
  t2.sync.recordSolve(solve('from-tab-2', 50, { t: 11 }));
  const onDisk = parseSave(storage.getItem('lp1.save.' + id)).save;
  assert.deepEqual(onDisk.history.map((e) => e.id).sort(), ['from-tab-1', 'from-tab-2'], 'neither write clobbered the other');
  assert.equal(t2.sync.getSave().history.length, 2, 'and tab 2 adopted what it merged');
});

test('storage event: a save change in another tab is merged into memory and re-renders totals', async () => {
  const { t1, t2, id } = await twoTabs();
  let renders = 0;
  t2.sync.subscribeSave(() => renders++);
  watchTabs({ win: t2.win, sync: t2.sync, onSignedOut: () => assert.fail('must not sign out') });
  t1.sync.recordSolve(solve('s1', 120, { t: 10 }));
  t2.fire('lp1.save.' + id, 'whatever');
  assert.equal(derive(t2.sync.getSave()).classic, 120);
  assert.ok(renders >= 1);
  const before = renders;
  t2.fire('lp1.save.' + id, 'again'); // nothing new: no churn
  assert.equal(renders, before);
  t2.fire('lp1.save.' + 'f'.repeat(64), 'x'); // another account's key: ignored
  t2.fire('lp1.lang', 'ar');
  assert.equal(renders, before);
});

test('storage event: logout in one tab signs the other out and NOTHING can resurrect lp1.save.<id>', async () => {
  const { storage, t1, t2, id } = await twoTabs();
  let out = 0;
  watchTabs({ win: t2.win, sync: t2.sync, onSignedOut: () => out++ });
  // tab 2 has a push pending when the logout happens
  t2.sync.recordSolve(solve('late', 10, { t: 9 }));
  assert.equal((await t1.sync.signOut({ force: true })).ok, true);
  // (until the storage event arrives tab 2 still believes in the account, so its in-flight resume-pull may legitimately
  // touch the dirty flag; that is exactly the window the event closes)
  t2.fire('lp1.session', null);
  assert.equal(out, 1);
  assert.equal(t2.sync.getSession(), null);
  assert.equal(t2.sync.getSave(), null);
  // every kind of late write is refused: timers, flushes, direct adapter calls, settings
  t2.dev.timers.advance(120_000);
  await t2.sync.flush();
  t2.sync.recordSolve(solve('later', 10, { t: 99 }));
  t2.sync.updateSettings({ lang: 'ar' });
  assert.deepEqual(t2.local.storeSave(id, emptySave('Ali', 1)), { ok: false, reason: 'closed' });
  assert.equal(t2.local.storeRun(id, { v: 1 }), false);
  t2.local.setDirty(id, true);
  assert.equal(keysOf(storage).some((k) => k.includes(id)), false, 'no lp1.save/dirty/run key came back');
  assert.equal(keysOf(storage).includes('lp1.session'), false);
});

test('storage event: session replaced by ANOTHER account signs this tab out; the same account is ignored; clear() signs out', async () => {
  for (const [key, val, expectOut] of [
    ['lp1.session', JSON.stringify({ name: 'Bob', id: 'd'.repeat(64) }), true],
    ['lp1.session', null, true],
    [null, null, true],
    ['lp1.session', 'SAME', false],
    ['lp1.session', '{not json', false],
  ]) {
    const { t1, t2, id } = await twoTabs();
    let out = 0;
    watchTabs({ win: t2.win, sync: t2.sync, onSignedOut: () => out++ });
    t2.fire(key, val === 'SAME' ? JSON.stringify({ name: 'Ali', id }) : val);
    assert.equal(out, expectOut ? 1 : 0, String(key) + String(val));
    void t1;
  }
});

test('storage event: a tab with an UNACKNOWLEDGED sign-up ignores other tabs\' session changes (its code dialog must survive)', async () => {
  const backend = createFakeFirestore();
  const storage = createMemoryStorage();
  const t = tabsOn(storage, backend);
  await t.sync.signUp('Ali');
  let out = 0;
  watchTabs({ win: t.win, sync: t.sync, onSignedOut: () => out++ });
  t.fire('lp1.session', null);
  t.fire(null, null);
  assert.equal(out, 0);
  assert.ok(t.sync.getSession());
});

test('Blood run ownership: fresh heartbeat of ANOTHER tab blocks restore; stale, own, absent or released can be taken over', () => {
  const rec = (over = {}) =>
    sanitizeProgress({ v: 1, mode: 'blood', runId: 'r1', startedAt: 1000, endsAt: 100000, solvedInRun: 0, points: 0, owner: 'aaaaaaaaaaaa', hb: 50000, ...over });
  const now = 50000 + 1000;
  assert.equal(isForeignActive(rec(), 'bbbbbbbbbbbb', now), true, 'fresh heartbeat, other tab');
  assert.equal(isForeignActive(rec(), 'aaaaaaaaaaaa', now), false, 'my own run');
  assert.equal(isForeignActive(rec(), 'bbbbbbbbbbbb', 50000 + HEARTBEAT_STALE_MS), false, 'exactly stale');
  assert.equal(isForeignActive(rec(), 'bbbbbbbbbbbb', 50000 + HEARTBEAT_STALE_MS - 1), true, 'one ms before stale');
  assert.equal(isForeignActive(rec(), 'bbbbbbbbbbbb', 50000 + 60000), false, 'tab closed long ago: taken over');
  assert.equal(isForeignActive(rec({ hb: 0 }), 'bbbbbbbbbbbb', 1000), false, 'released on pagehide (hb 0)');
  assert.equal(isForeignActive(rec({ owner: undefined, hb: undefined }), 'bbbbbbbbbbbb', now), false, 'legacy record without an owner');
  assert.equal(isForeignActive(rec({ owner: 'NOT-HEX!' }), 'bbbbbbbbbbbb', now), false, 'garbage owner is dropped by sanitize');
  assert.equal(isForeignActive(rec({ hb: 50000 + 10 * 3600_000 }), 'bbbbbbbbbbbb', now), false, 'a heartbeat far in the future cannot block forever');
  assert.equal(isForeignActive(null, 'x', now), false);
  assert.equal(isForeignActive(sanitizeProgress({ v: 1, mode: 'classic', difficulty: 'rookie', seed: 1 }), 'x', now), false, 'classic has no owner');
});

// ================= Finding 8d/8e: newer saves, storage failure =================

test('a cloud save written by a NEWER app (save.v != 1) is never overwritten: sign-in refuses, sync stays local with an issue', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const B = createDevice(backend);
  const { code, id } = await signUp(A, 'Ali');
  await A.sync.flush();
  const future = JSON.stringify({ v: 2, name: 'Ali', createdAt: 1, updatedAt: 9, history: [], runs: [], settings: { lang: 'en', sound: true, at: 0 }, brandNewField: [1, 2, 3] });
  backend.put('players/' + id, { v: { integerValue: '1' }, save: { stringValue: future } });
  const writesBefore = backend.log.filter((r) => r.method === 'PATCH' && r.path.includes('/players/')).length;

  assert.deepEqual(await B.sync.signIn('Ali', code), { ok: false, reason: 'newer' });
  assert.equal(B.sync.getSession(), null, 'no half-signed-in state');

  const issues = [];
  A.sync.subscribeIssue((k) => issues.push(k));
  A.sync.recordSolve(solve('s1', 10, { t: 5 }));
  const r = await A.sync.flush();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'newer');
  assert.equal(A.sync.getStatus(), 'local');
  assert.equal(A.sync.getIssue(), 'newer');
  assert.deepEqual(issues, ['newer']);
  await A.sync.pull();
  A.dev?.tick?.();
  assert.equal(backend.log.filter((r2) => r2.method === 'PATCH' && r2.path.includes('/players/')).length, writesBefore, 'the cloud copy was never touched');
  assert.equal(backend.get('players/' + id).fields.save.stringValue, future);
  assert.equal(A.sync.getSave().history.length, 1, 'play continues locally');
});

test('storeSave failing (quota) or falling back to memory is never silent: issue "storage" and status "local"', async () => {
  const backend = createFakeFirestore();
  const dev = createDevice(backend);
  const inner = createMemoryStorage();
  const f = { fail: false };
  const storage = { ...inner, getItem: (k) => inner.getItem(k), removeItem: (k) => inner.removeItem(k), key: (i) => inner.key(i), get length() { return inner.length; }, setItem(k, v) { if (f.fail && k.startsWith('lp1.save.')) throw new DOMException('full', 'QuotaExceededError'); inner.setItem(k, v); } };
  const local = createLocal({ storage });
  const sync = createSync({ remote: dev.remote, local, clock: () => dev.now, timers: dev.timers, events: new EventTarget(), isHidden: () => false });
  await sync.signUp('Ali');
  sync.acknowledge();
  await sync.flush();
  assert.equal(sync.getStatus(), 'synced');
  const issues = [];
  sync.subscribeIssue((k) => issues.push(k));
  f.fail = true;
  sync.recordSolve(solve('s1', 5));
  assert.equal(sync.getIssue(), 'storage');
  assert.equal(sync.getStatus(), 'local');
  assert.deepEqual(issues, ['storage']);
  // the next successful sync shows the truth again (the cloud has it), and a healthy write clears the notice
  f.fail = false;
  sync.recordSolve(solve('s2', 5, { t: 2_000_000 }));
  assert.equal(sync.getIssue(), null);
  assert.deepEqual(issues, ['storage', null]);
});

// ================= Minors =================

test('hardware digits: ASCII, Arabic-Indic and Eastern Arabic digits map to 0-9; nothing else does', () => {
  for (let d = 0; d < 10; d++) {
    assert.equal(asciiDigit(String(d)), d);
    assert.equal(asciiDigit(String.fromCharCode(0x660 + d)), d);
    assert.equal(asciiDigit(String.fromCharCode(0x6f0 + d)), d);
  }
  for (const k of ['a', 'Enter', '', '٣٣', undefined, null, 5, '-', ' ', 'ٰ']) assert.equal(asciiDigit(k), null, String(k));
});

// ================= F-01: no 404 on any legitimate flow =================

test('sign-up (id-collision probe), wrong-code sign-in, unknown-name sign-in and pull never cause an HTTP 404', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const B = createDevice(backend);
  const { code } = await signUp(A, 'Ali');
  await A.sync.flush();
  assert.deepEqual(await B.sync.signIn('Ali', code === '000000' ? '000001' : '000000'), { ok: false, reason: 'invalid' });
  assert.deepEqual(await B.sync.signIn('Nobody', '123456'), { ok: false, reason: 'invalid' });
  assert.equal((await B.sync.signIn('Ali', code)).ok, true);
  await B.sync.pull();
  await A.sync.pull();
  assert.equal(backend.notFound, 0, 'zero 404 responses over a whole sign-up / sign-in / pull session');
  assert.equal(backend.log.filter((e) => e.method === 'GET').length, 0);
});

test('offline sign-up that later creates the remote doc still never sees a 404', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  A.net.offline = true;
  await signUp(A, 'Ali');
  A.net.offline = false;
  A.events.dispatchEvent(new Event('online'));
  await A.sync.flush();
  assert.equal(A.sync.getStatus(), 'synced');
  assert.equal(backend.notFound, 0);
});
