import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../../js/sync/sync.js';
import { createRemote } from '../../js/sync/remote.js';
import { createLocal } from '../../js/sync/local.js';
import { derive, parseSave, emptySave } from '../../js/sync/merge.js';
import { playerId, boardId } from '../../js/sync/identity.js';
import { createFakeFirestore, PROJECT, API_KEY } from './helpers/fake-firestore.mjs';
import { createDevice, guardGlobalFetch, solve, throwingFetch } from './helpers/harness.mjs';

let guard;
before(() => {
  guard = guardGlobalFetch();
});
after(() => {
  guard.restore();
  assert.equal(guard.calls, 0, 'the real global fetch must never be used by tests');
});

const online = (dev) => dev.events.dispatchEvent(new Event('online'));
const remoteSaveOf = (backend, id) => parseSave(backend.get('players/' + id).fields.save.stringValue).save;
const writes = (backend) => backend.log.filter((r) => r.method === 'PATCH' && r.path.includes('/players/'));
const keysOf = (storage) => Array.from({ length: storage.length }, (_, i) => storage.key(i)).sort();

/** Sign up on a device and return {code, id}. */
async function signUp(dev, name = 'Ali') {
  const r = await dev.sync.signUp(name);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(dev.sync.acknowledge().ok, true); // the player ticked "I saved my code"
  return r;
}

test('(1) device A signs up, device B signs in with name+code and sees A\'s progress', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const B = createDevice(backend);

  const { code, id } = await signUp(A, 'Ali');
  assert.match(code, /^[0-9]{6}$/);
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(A.sync.getStatus(), 'synced');

  assert.equal(A.sync.recordSolve(solve('s1', 120, { t: 5 })).ok, true);
  assert.equal(A.sync.recordSolve(solve('s2', 80, { m: 'b', t: 6, r: 'run1' })).ok, true);
  assert.equal(A.sync.recordRun({ id: 'run1', t: 7, solved: 1, pts: 80 }).ok, true);
  await A.sync.flush();
  assert.equal(A.sync.hasPending(), false);

  // different casing / spacing / digit script of the same credentials
  const r = await B.sync.signIn('  ALI ', code.slice(0, 3) + ' ' + code.slice(3));
  assert.deepEqual(r, { ok: true, id, name: 'Ali' });
  assert.deepEqual(B.sync.getDerived(), A.sync.getDerived());
  assert.equal(B.sync.getDerived().total, 200);
  assert.equal(B.sync.getDerived().classic, 120);
  assert.equal(B.sync.getDerived().blood, 80);
  assert.equal(B.sync.getDerived().bestRun, 80);
  assert.equal(B.sync.getStatus(), 'synced');
  assert.deepEqual(B.local.getSession(), { name: 'Ali', id });
  assert.equal(B.sync.getSave().history.length, 2);
});

test('the code never reaches storage or the cloud document', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend, { rngValues: [482915] });
  const { code } = await signUp(A);
  assert.equal(code, '482915');
  A.sync.recordSolve(solve('s1', 10));
  await A.sync.flush();
  const everything = keysOf(A.storage).map((k) => k + A.storage.getItem(k)).join('|') + JSON.stringify([...backend.docs.values()]);
  assert.ok(!everything.includes('482915'));
  assert.ok(!everything.includes('4829'));
});

test('(2) both devices play offline, reconnect: union, no double count, no lost points, identical totals', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const B = createDevice(backend);
  const { code } = await signUp(A);
  await B.sync.signIn('Ali', code);

  A.net.offline = true;
  B.net.offline = true;
  A.sync.recordSolve(solve('a1', 100, { t: 10 }));
  A.sync.recordSolve(solve('a2', 50, { t: 11 }));
  A.sync.recordSolve(solve('shared', 30, { t: 12 })); // same event recorded on both (e.g. a retried submit)
  B.sync.recordSolve(solve('b1', 70, { t: 20, m: 'b', r: 'rb' }));
  B.sync.recordRun({ id: 'rb', t: 21, solved: 1, pts: 70 });
  B.sync.recordSolve(solve('shared', 30, { t: 12 }));

  // while offline: pushes fail, nothing is lost, status says so
  await A.sync.flush();
  await B.sync.flush();
  assert.equal(A.sync.getStatus(), 'offline');
  assert.equal(A.sync.hasPending(), true);
  assert.equal(A.sync.getDerived().total, 180);
  assert.equal(B.sync.getDerived().total, 100);

  A.net.offline = false;
  B.net.offline = false;
  online(A);
  await A.sync.idle();
  online(B);
  await B.sync.idle();
  assert.equal(A.sync.hasPending(), false);
  assert.equal(B.sync.hasPending(), false);
  online(A); // A is clean, so this is a pull
  await new Promise((r) => setImmediate(r));
  await A.sync.pull();

  const expected = 100 + 50 + 30 + 70;
  assert.equal(A.sync.getDerived().total, expected);
  assert.equal(B.sync.getDerived().total, expected);
  assert.equal(A.sync.getDerived().solved, 4);
  assert.deepEqual(A.sync.getSave(), B.sync.getSave());
  assert.equal(A.sync.getDerived().bestRun, 70);
  assert.equal(A.sync.getStatus(), 'synced');
  assert.equal(B.sync.getStatus(), 'synced');
});

test('(2b) randomised two-device schedules always converge to the union', async () => {
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
  for (let seed = 1; seed <= 25; seed++) {
    const r = prng(seed);
    const backend = createFakeFirestore();
    const A = createDevice(backend, { rngValues: [100000 + seed] });
    const B = createDevice(backend);
    const { code } = await signUp(A);
    await B.sync.signIn('Ali', code);
    const devs = [A, B];
    const pts = new Map();
    let n = 0;
    for (let step = 0; step < 24; step++) {
      const d = devs[Math.floor(r() * 2)];
      const op = Math.floor(r() * 5);
      if (op === 0 || op === 1) {
        // sometimes reuse an existing id to exercise cross-device duplicates
        const reuse = pts.size > 0 && r() < 0.25;
        const id = reuse ? [...pts.keys()][Math.floor(r() * pts.size)] : 'e' + n++;
        const p = reuse ? pts.get(id) : 1 + Math.floor(r() * 500);
        pts.set(id, p);
        d.sync.recordSolve(solve(id, p, { t: 100 + step }));
      } else if (op === 2) d.net.offline = !d.net.offline;
      else if (op === 3) await d.sync.flush();
      else await d.sync.pull();
    }
    for (const d of devs) d.net.offline = false;
    await A.sync.flush();
    await B.sync.flush();
    await A.sync.pull();
    await B.sync.pull();
    await A.sync.flush();
    const want = [...pts.values()].reduce((a, b) => a + b, 0);
    assert.equal(A.sync.getDerived().total, want, `seed ${seed}`);
    assert.equal(B.sync.getDerived().total, want, `seed ${seed}`);
    assert.deepEqual(A.sync.getSave().history, B.sync.getSave().history, `seed ${seed}`);
    assert.equal(derive(remoteSaveOf(backend, A.sync.getSession().id)).total, want, `seed ${seed}: cloud agrees`);
  }
});

test('(3) wrong code -> generic `invalid`, indistinguishable from an unknown name', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const B = createDevice(backend);
  const { code } = await signUp(A, 'Ali');
  const wrong = code === '000000' ? '000001' : '000000';

  const wrongCode = await B.sync.signIn('Ali', wrong);
  const unknownName = await B.sync.signIn('Nobody', code);
  assert.deepEqual(wrongCode, { ok: false, reason: 'invalid' });
  assert.deepEqual(unknownName, wrongCode, 'same shape: the UI cannot tell which half was wrong');
  assert.equal(B.sync.getSession(), null);
  assert.deepEqual(keysOf(B.storage), [], 'a failed sign-in leaves nothing behind');

  assert.equal((await B.sync.signIn('Ali', '12345')).reason, 'invalid_code');
  assert.equal((await B.sync.signIn('', code)).reason, 'invalid_name');
  assert.equal((await B.sync.signIn('x'.repeat(21), code)).detail, 'too_long');
});

test('signIn: offline, denied, quota surface their own reasons', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const B = createDevice(backend);
  const { code } = await signUp(A);
  B.net.offline = true;
  assert.deepEqual(await B.sync.signIn('Ali', code), { ok: false, reason: 'offline' });
  B.net.offline = false;
  backend.faults.deny = true;
  assert.equal((await B.sync.signIn('Ali', code)).reason, 'denied');
  backend.faults.deny = false;
  backend.faults.quota = true;
  assert.equal((await B.sync.signIn('Ali', code)).reason, 'quota');
  backend.faults.quota = false;
  assert.equal((await B.sync.signIn('Ali', code)).ok, true);
});

test('(4) logout wipes local data; the account survives in the cloud', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const { code, id } = await signUp(A);
  A.local.setLang('ar');
  A.sync.recordSolve(solve('s1', 40));
  assert.deepEqual(await A.sync.signOut(), { ok: true });
  assert.equal(A.sync.getSession(), null);
  assert.equal(A.sync.getSave(), null);
  assert.deepEqual(keysOf(A.storage), ['lp1.lang'], 'only the language preference remains');
  assert.equal(A.sync.getDerived().total, 0);
  assert.equal(A.sync.recordSolve(solve('x', 1)).reason, 'nosession');
  assert.equal(derive(remoteSaveOf(backend, id)).total, 40, 'logout flushed first');
  assert.equal(A.timers.pending, 0);

  const back = await A.sync.signIn('Ali', code);
  assert.equal(back.ok, true);
  assert.equal(A.sync.getDerived().total, 40);
});

test('(4b) logout offline with unsynced data returns pending:true and keeps everything; force wipes', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const { id } = await signUp(A);
  A.net.offline = true;
  A.sync.recordSolve(solve('s1', 40));

  const r = await A.sync.signOut();
  assert.equal(r.ok, false);
  assert.equal(r.pending, true);
  assert.equal(A.sync.getSession().id, id);
  assert.equal(A.sync.getDerived().total, 40);
  assert.equal(A.local.isDirty(id), true);

  const forced = await A.sync.signOut({ force: true });
  assert.deepEqual(forced, { ok: true });
  assert.deepEqual(keysOf(A.storage), []);
  assert.equal(A.sync.getSession(), null);
  assert.equal(A.timers.pending, 0, 'no timer survives logout');
});

test('(4c) logout offline with nothing unsynced does not need the network', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  await signUp(A);
  A.net.offline = true;
  assert.deepEqual(await A.sync.signOut(), { ok: true });
});

test('(5) duplicate recordSolve/recordRun ids are idempotent', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  await signUp(A);
  const first = A.sync.recordSolve(solve('same', 100));
  const second = A.sync.recordSolve(solve('same', 100));
  const third = A.sync.recordSolve(solve('same', 999)); // same id, different payload: first write wins locally
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(third.duplicate, true);
  assert.equal(A.sync.getDerived().total, 100);
  assert.equal(A.sync.getSave().history.length, 1);
  assert.equal(A.sync.recordRun({ id: 'r', t: 1, solved: 1, pts: 5 }).duplicate, false);
  assert.equal(A.sync.recordRun({ id: 'r', t: 1, solved: 1, pts: 5 }).duplicate, true);
  assert.equal(A.sync.getSave().runs.length, 1);
  await A.sync.flush();
  await A.sync.flush();
  assert.equal(derive(remoteSaveOf(backend, A.sync.getSession().id)).total, 100);
});

test('recordSolve/recordRun reject malformed entries and fill in a missing timestamp', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  await signUp(A);
  for (const bad of [null, undefined, 5, {}, solve('a', -1), solve('a', 1.5), solve('a', 1, { m: 'x' }), solve('a', 1, { d: 'zzz' })]) {
    assert.deepEqual(A.sync.recordSolve(bad), { ok: false, reason: 'invalid' });
  }
  assert.equal(A.sync.recordRun({ id: 'r', pts: -3 }).reason, 'invalid');
  assert.equal(A.sync.getSave().history.length, 0);
  A.now = 777000;
  const { t: _omit, ...noT } = solve('nt', 5);
  const r = A.sync.recordSolve(noT);
  assert.equal(r.ok, true);
  assert.equal(r.entry.t, 777000);
});

test('(6) a conflicting write is re-read, re-merged and retried', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const { id } = await signUp(A);
  A.sync.recordSolve(solve('mine', 100, { t: 5 }));

  // Another device sneaks a write in between our read and our write.
  backend.beforeWrite = () => {
    const theirs = emptySave('Ali', A.now);
    theirs.history = [solve('theirs', 55, { t: 6 })];
    backend.put('players/' + id, {
      v: { integerValue: '1' },
      save: { stringValue: JSON.stringify(theirs) },
    });
  };
  const r = await A.sync.flush();
  assert.equal(r.ok, true);
  assert.equal(A.sync.getDerived().total, 155, 'their solve was merged in, ours was not lost');
  assert.equal(derive(remoteSaveOf(backend, id)).total, 155);
  assert.equal(A.sync.hasPending(), false);
  assert.equal(writes(backend).filter((w) => w.query['currentDocument.updateTime']).length, 2, 'first write lost the race, second won');
});

test('(6b) injected 409 on the first write retries and succeeds; four in a row give up and back off', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const { id } = await signUp(A);
  A.sync.recordSolve(solve('s1', 10));
  backend.failWrites.push({ status: 409, code: 'ABORTED' });
  assert.equal((await A.sync.flush()).ok, true);
  assert.equal(derive(remoteSaveOf(backend, id)).total, 10);

  A.sync.recordSolve(solve('s2', 20));
  for (let i = 0; i < 4; i++) backend.failWrites.push({ status: 409, code: 'ABORTED' });
  const before = writes(backend).length;
  const r = await A.sync.flush();
  assert.deepEqual(r, { ok: false, reason: 'conflict' });
  assert.equal(writes(backend).length - before, 4, 'initial attempt + 3 retries');
  assert.equal(A.sync.hasPending(), true, 'still dirty, nothing lost');
  assert.deepEqual(A.timers.delays(), [2000], 'a backoff retry is scheduled');

  A.timers.advance(2000);
  await A.sync.idle();
  assert.equal(A.sync.hasPending(), false);
  assert.equal(derive(remoteSaveOf(backend, id)).total, 30);
  assert.equal(A.sync.getStatus(), 'synced');
});

test('(7) sign-up while offline works locally, then the first online sync creates the remote doc', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  A.net.offline = true;
  const up = await A.sync.signUp('Ali');
  A.sync.acknowledge();
  assert.equal(up.ok, true);
  assert.equal(up.local, true);
  assert.equal(A.sync.getStatus(), 'local');
  assert.equal(A.local.isDirty(up.id), true);
  assert.equal(backend.docs.size, 0);
  A.sync.recordSolve(solve('s1', 90));

  A.net.offline = false;
  online(A);
  await A.sync.idle();
  assert.equal(A.sync.getStatus(), 'synced');
  assert.equal(A.sync.hasPending(), false);
  assert.equal(derive(remoteSaveOf(backend, up.id)).total, 90);
  assert.equal(backend.get('players/' + up.id).fields.v.integerValue, '1');
  assert.ok(writes(backend).some((w) => w.query['currentDocument.exists'] === 'false'), 'created with exists=false');

  const B = createDevice(backend);
  assert.equal((await B.sync.signIn('ali', up.code)).ok, true);
  assert.equal(B.sync.getDerived().total, 90);
});

test('sign-up offline also recovers through the debounce/backoff timer, without any event', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  A.net.offline = true;
  const up = await A.sync.signUp('Ali');
  A.sync.acknowledge();
  A.net.offline = false;
  A.timers.advance(1500);
  await A.sync.idle();
  assert.equal(A.sync.getStatus(), 'synced');
  assert.ok(backend.get('players/' + up.id));
});

test('sign-up when the cloud refuses (rules not published) degrades to device-only without retry storms', async () => {
  const backend = createFakeFirestore();
  backend.faults.deny = true;
  const A = createDevice(backend);
  const up = await A.sync.signUp('Ali');
  A.sync.acknowledge();
  assert.equal(up.ok, true);
  assert.equal(up.local, true);
  assert.equal(up.cause, 'denied');
  assert.equal(A.sync.getStatus(), 'local');
  assert.equal(A.timers.pending, 0, 'no automatic retry on a permanent refusal');
  A.sync.recordSolve(solve('s1', 5));
  await A.sync.flush();
  assert.equal(A.sync.getStatus(), 'local');
  assert.equal(A.sync.hasPending(), true);
  backend.faults.deny = false;
  online(A);
  await A.sync.idle();
  assert.equal(A.sync.getStatus(), 'synced');
});

test('sign-up re-rolls the code when the id already exists', async () => {
  const backend = createFakeFirestore();
  const taken = await playerId('Ali', '123456');
  backend.put('players/' + taken, { v: { integerValue: '1' }, save: { stringValue: JSON.stringify(emptySave('Ali', 1)) } });
  const A = createDevice(backend, { rngValues: [123456, 654321] });
  const up = await A.sync.signUp('Ali');
  A.sync.acknowledge();
  assert.equal(up.code, '654321');
  assert.notEqual(up.id, taken);
  assert.equal(derive(remoteSaveOf(backend, taken)).total, 0, 'the existing account was not touched');
});

test('sign-up validates the name and refuses while signed in', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  assert.deepEqual(await A.sync.signUp(''), { ok: false, reason: 'invalid_name', detail: 'empty' });
  assert.equal((await A.sync.signUp('a\u0000')).detail, 'control_chars');
  assert.equal(backend.log.length, 0, 'invalid input never reaches the network');
  await signUp(A);
  assert.equal((await A.sync.signUp('Other')).reason, 'already_signed_in');
  assert.equal((await A.sync.signIn('Ali', '123456')).reason, 'already_signed_in');
});

test('Arabic names work end to end', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const B = createDevice(backend);
  const { code } = await signUp(A, 'حسين');
  A.sync.recordSolve(solve('s1', 25));
  await A.sync.flush();
  const toArabicDigits = (s) => s.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));
  const r = await B.sync.signIn('  حسين ', toArabicDigits(code));
  assert.equal(r.ok, true);
  assert.equal(r.name, 'حسين');
  assert.equal(B.sync.getDerived().total, 25);
});

test('debounce: a burst of solves produces one write after 1500 ms, not before', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const { id } = await signUp(A);
  const base = writes(backend).length;
  A.sync.recordSolve(solve('s1', 10));
  A.timers.advance(1000);
  A.sync.recordSolve(solve('s2', 10));
  A.timers.advance(1000); // 2000 ms since the first solve, but only 1000 since the second
  await A.sync.idle();
  assert.equal(writes(backend).length, base, 'timer restarted by the second solve');
  assert.equal(A.sync.getStatus(), 'saving');
  A.timers.advance(500);
  await A.sync.idle();
  assert.equal(writes(backend).length - base, 1);
  assert.equal(derive(remoteSaveOf(backend, id)).total, 20);
  assert.equal(A.sync.getStatus(), 'synced');
});

test('writes go to local storage before any network call', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const { id } = await signUp(A);
  A.sync.recordSolve(solve('s1', 10));
  assert.equal(A.local.isDirty(id), true);
  assert.equal(A.local.loadSave(id).history.length, 1);
  assert.equal(derive(remoteSaveOf(backend, id)).total, 0, 'cloud has not seen it yet');
});

test('offline pushes back off exponentially (2s, 4s, 8s ... capped at 60s) and recover on the next try', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const { id } = await signUp(A);
  A.net.offline = true;
  A.sync.recordSolve(solve('s1', 10));
  const seen = [];
  A.timers.advance(1500); // debounce fires, push fails
  for (let i = 0; i < 8; i++) {
    await A.sync.idle();
    const [d] = A.timers.delays();
    seen.push(d);
    A.timers.advance(d);
  }
  await A.sync.idle();
  assert.deepEqual(seen, [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  assert.equal(A.sync.getStatus(), 'offline');
  A.net.offline = false;
  A.timers.advance(60000);
  await A.sync.idle();
  assert.equal(A.sync.getStatus(), 'synced');
  assert.equal(derive(remoteSaveOf(backend, id)).total, 10);
});

test('the online event resets backoff and pushes immediately; visibility hidden flushes dirty data', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const { id } = await signUp(A);
  A.net.offline = true;
  A.sync.recordSolve(solve('s1', 10));
  await A.sync.flush();
  A.net.offline = false;
  online(A);
  await A.sync.idle();
  assert.equal(derive(remoteSaveOf(backend, id)).total, 10);

  A.sync.recordSolve(solve('s2', 5));
  A.events.dispatchEvent(new Event('visibilitychange')); // no debounce wait
  await A.sync.idle();
  assert.equal(derive(remoteSaveOf(backend, id)).total, 15);
});

test('visibility pulls are throttled; online pulls are not', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const B = createDevice(backend);
  const { code } = await signUp(A);
  await B.sync.signIn('Ali', code);
  B.sync.recordSolve(solve('b1', 33));
  await B.sync.flush();

  A.events.dispatchEvent(new Event('visibilitychange'));
  await new Promise((r) => setImmediate(r));
  assert.equal(A.sync.getDerived().total, 0, 'within 10 s of the last pull: skipped');
  A.tick(11000);
  A.events.dispatchEvent(new Event('visibilitychange'));
  await new Promise((r) => setImmediate(r));
  await A.sync.idle();
  assert.equal(A.sync.getDerived().total, 33);
});

test('pull merges the cloud copy into a clean device and notifies save subscribers', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const B = createDevice(backend);
  const { code } = await signUp(A);
  await B.sync.signIn('Ali', code);
  let notified = 0;
  A.sync.subscribeSave(() => notified++);
  B.sync.recordSolve(solve('b1', 44));
  await B.sync.flush();
  assert.deepEqual(await A.sync.pull(), { ok: true });
  assert.equal(A.sync.getDerived().total, 44);
  assert.ok(notified >= 1);
});

test('resume: cached save is available immediately, background pull reconciles', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const B = createDevice(backend);
  const { code } = await signUp(A);
  A.sync.recordSolve(solve('a1', 10));
  await A.sync.flush();
  await B.sync.signIn('Ali', code);
  B.sync.recordSolve(solve('b1', 90));
  await B.sync.flush();

  // "reload" device A: a brand-new sync over the same storage
  const reloaded = createSync({
    remote: A.remote,
    local: createLocal({ storage: A.storage }),
    clock: () => A.now,
    timers: A.timers,
    events: A.events,
    isHidden: () => false,
  });
  const res = await reloaded.resume();
  assert.equal(res.ok, true);
  assert.equal(res.session.name, 'Ali');
  assert.equal(res.save.history.length, 1, 'cache shown before the network answers');
  assert.equal(reloaded.getDerived().total, 10);
  assert.equal(reloaded.getStatus(), 'saving');
  await res.pulled;
  assert.equal(reloaded.getDerived().total, 100);
  assert.equal(reloaded.getStatus(), 'synced');
  reloaded.dispose();
});

test('resume with unsynced cached data pushes it; with no session it makes no request', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const { id } = await signUp(A);
  A.net.offline = true;
  A.sync.recordSolve(solve('a1', 10));
  A.sync.dispose();

  A.net.offline = false;
  const reloaded = createSync({ remote: A.remote, local: createLocal({ storage: A.storage }), clock: () => A.now, timers: A.timers, events: A.events });
  const res = await reloaded.resume();
  await res.pulled;
  assert.equal(derive(remoteSaveOf(backend, id)).total, 10);
  reloaded.dispose();

  const idle = createSync({
    remote: createRemote({ projectId: PROJECT, apiKey: API_KEY, fetch: throwingFetch }),
    local: createLocal({ storage: null }),
    clock: () => 1,
    timers: A.timers,
  });
  const none = await idle.resume();
  assert.equal(none.session, null);
  assert.equal(idle.getStatus(), 'local');
});

test('resume offline: shows the cache and reports offline', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  await signUp(A);
  A.sync.recordSolve(solve('a1', 10));
  await A.sync.flush();
  A.sync.dispose();
  A.net.offline = true;
  const reloaded = createSync({ remote: A.remote, local: createLocal({ storage: A.storage }), clock: () => A.now, timers: A.timers });
  const res = await reloaded.resume();
  await res.pulled;
  assert.equal(reloaded.getDerived().total, 10);
  assert.equal(reloaded.getStatus(), 'offline');
});

test('resume with a corrupted cache does not crash and recovers from the cloud', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const { id } = await signUp(A);
  A.sync.recordSolve(solve('a1', 10));
  await A.sync.flush();
  A.sync.dispose();
  A.storage.setItem('lp1.save.' + id, '{broken');
  const reloaded = createSync({ remote: A.remote, local: createLocal({ storage: A.storage }), clock: () => A.now, timers: A.timers });
  const res = await reloaded.resume();
  await res.pulled;
  assert.equal(reloaded.getDerived().total, 10);
  assert.equal(reloaded.getSave().name, 'Ali');
});

test('status stream: saving -> synced, offline on failure, immediate first callback, unsubscribe', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const seen = [];
  const off = A.sync.subscribe((s) => seen.push(s));
  assert.deepEqual(seen, ['local'], 'subscribe reports the current status at once');
  await signUp(A);
  A.sync.recordSolve(solve('s1', 1));
  await A.sync.flush();
  A.net.offline = true;
  A.sync.recordSolve(solve('s2', 1));
  await A.sync.flush();
  assert.deepEqual(seen, ['local', 'synced', 'saving', 'synced', 'saving', 'offline']);
  off();
  A.sync.recordSolve(solve('s3', 1));
  assert.equal(seen.length, 6);
  A.sync.subscribe(() => {
    throw new Error('bad subscriber');
  });
  assert.doesNotThrow(() => A.sync.recordSolve(solve('s4', 1)));
});

test('the public board row is published after a push, best-effort, and never for a score-less account', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const { id } = await signUp(A, 'Ali');
  await A.sync.flush();
  assert.equal([...backend.docs.keys()].filter((k) => k.startsWith('board/')).length, 0);

  A.sync.recordSolve(solve('s1', 100, { t: 5 }));
  A.sync.recordSolve(solve('s2', 40, { m: 'b', t: 6, r: 'r1' }));
  A.sync.recordRun({ id: 'r1', t: 7, solved: 1, pts: 40 });
  await A.sync.flush();
  const bk = A.sync.getSave().bk;
  assert.match(bk, /^[0-9a-f]{32}$/);
  const bid = await boardId(bk);
  const row = backend.get('board/' + bid);
  assert.ok(row, 'row id is the hash of the save id, not the save id');
  assert.ok(!backend.docs.has('board/' + id));
  assert.deepEqual(Object.keys(row.fields).sort(), ['bestRun', 'blood', 'name', 'solved', 'total', 'updatedAt']);
  assert.equal(row.fields.total.integerValue, '140');
  assert.equal(row.fields.blood.integerValue, '40');
  assert.equal(row.fields.solved.integerValue, '2');
  assert.equal(row.fields.bestRun.integerValue, '40');
  assert.equal(row.fields.name.stringValue, 'Ali');

  const board = await A.remote.listBoard({ orderBy: 'total', limit: 10 });
  assert.equal(board.data[0].bid, bid);

  // a refused board write must not fail the save sync
  A.sync.recordSolve(solve('s3', 1, { t: 8 }));
  const orig = A.remote.putBoard;
  A.remote.putBoard = async () => {
    throw new Error('board down');
  };
  const r = await A.sync.flush();
  A.remote.putBoard = orig;
  assert.equal(r.ok, true);
  assert.equal(A.sync.getStatus(), 'synced');
});

test('long names are truncated for the board by code points without breaking the rules', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  await signUp(A, '😀'.repeat(20)); // 20 code points = 40 UTF-16 units = 80 UTF-8 bytes
  A.sync.recordSolve(solve('s1', 5));
  await A.sync.flush();
  const row = backend.get('board/' + (await boardId(A.sync.getSave().bk)));
  assert.ok(row, 'row was accepted by the rules-mirroring fake');
  assert.equal(Array.from(row.fields.name.stringValue).length, 20, 'cut by code points, never mid-emoji');
  assert.ok(Buffer.byteLength(row.fields.name.stringValue) <= 96);
});

test('settings: last writer wins across devices; language is mirrored locally', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const B = createDevice(backend);
  const { code } = await signUp(A);
  await B.sync.signIn('Ali', code);

  A.tick(10);
  assert.equal(A.sync.updateSettings({ lang: 'ar' }).ok, true);
  assert.equal(A.local.getLang(), 'ar');
  await A.sync.flush();
  B.tick(100);
  assert.equal(B.sync.updateSettings({ sound: false }).ok, true);
  await B.sync.flush();
  await A.sync.pull();
  assert.deepEqual(A.sync.getSave().settings.sound, false);
  assert.deepEqual(A.sync.getSave().settings, B.sync.getSave().settings);
  assert.equal(A.sync.updateSettings({ lang: 'fr' }).reason, 'invalid');
  assert.equal(A.sync.updateSettings({ sound: 'yes' }).reason, 'invalid');
});

test('settings edits always beat the device\'s own previous edit, even if the clock goes backwards', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  await signUp(A);
  A.now = 5000;
  A.sync.updateSettings({ lang: 'ar' });
  A.now = 1000;
  A.sync.updateSettings({ lang: 'en' });
  assert.equal(A.sync.getSave().settings.lang, 'en');
});

test('getSave returns a copy: mutating it cannot corrupt sync state', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  await signUp(A);
  A.sync.recordSolve(solve('s1', 10));
  const s = A.sync.getSave();
  s.history.length = 0;
  s.history.push({ evil: true });
  assert.equal(A.sync.getDerived().total, 10);
  assert.equal(A.sync.getSave().history.length, 1);
});

test('a corrupt cloud document is repaired by the next write rather than crashing sign-in', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const B = createDevice(backend);
  const { code, id } = await signUp(A);
  backend.put('players/' + id, { v: { integerValue: '1' }, save: { stringValue: '{definitely not json' } });
  const r = await B.sync.signIn('Ali', code);
  assert.equal(r.ok, true);
  assert.equal(B.sync.getSave().name, 'Ali', 'name falls back to what the player typed');
  B.sync.recordSolve(solve('s1', 10));
  await B.sync.flush();
  assert.equal(derive(remoteSaveOf(backend, id)).total, 10);
});

test('sign-in with data cached for the same account merges it (no loss on re-login)', async () => {
  const backend = createFakeFirestore();
  const A = createDevice(backend);
  const { code, id } = await signUp(A);
  A.sync.recordSolve(solve('s1', 10));
  A.sync.dispose();
  // simulate: local cache exists but the session key was lost
  A.storage.removeItem('lp1.session');
  const again = createSync({ remote: A.remote, local: createLocal({ storage: A.storage }), clock: () => A.now, timers: A.timers });
  A.net.offline = false;
  const r = await again.signIn('Ali', code);
  assert.equal(r.ok, true);
  assert.equal(again.getDerived().total, 10, 'unsynced cached solve survived');
  await again.flush();
  assert.equal(derive(remoteSaveOf(backend, id)).total, 10);
  again.dispose();
});

test('no real network in this file: every remote in use was the fake', () => {
  assert.equal(guard.calls, 0);
});
