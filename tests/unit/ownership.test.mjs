// The Blood-run ownership state machine, without a browser: heartbeat, pagehide release, reload, bfcache restore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnership } from '../../js/game/ownership.js';
import { sanitizeProgress, HEARTBEAT_STALE_MS } from '../../js/game/progress.js';

/** Two or more "tabs" sharing one stored record and one clock. */
function world() {
  let rec = null;
  let t = 1_700_000_000_000;
  const writes = [];
  const base = { v: 1, mode: 'blood', runId: 'run1', startedAt: t - 1000, endsAt: t + 170_000, solvedInRun: 0, points: 0 };
  const tab = (tabId) =>
    createOwnership({
      tabId,
      now: () => t,
      read: () => sanitizeProgress(rec),
      write: (r) => {
        rec = { ...base, ...r };
        writes.push([tabId, r.hb]);
      },
    });
  return { tab, advance: (ms) => (t += ms), writes, get rec() { return rec; } };
}
const snap = { mode: 'blood', runId: 'run1' };

test('F-04: pagehide releases, and the visibilitychange(hidden) that follows must NOT write a live heartbeat again', () => {
  const w = world();
  const A = w.tab('aaaaaaaaaaaa');
  assert.equal(A.beat(snap), 'ok');
  w.advance(1000);
  assert.equal(A.release(snap), 'ok'); // pagehide
  assert.equal(w.rec.hb, 0);
  const writesAfterRelease = w.writes.length;
  w.advance(5);
  assert.equal(A.beat(snap), 'released', 'visibilitychange -> persist() right after pagehide');
  assert.equal(A.beat(snap), 'released', 'and the next heartbeat tick');
  assert.equal(w.writes.length, writesAfterRelease, 'nothing was written');
  assert.equal(w.rec.hb, 0);
  // the reloaded page (new tab id) sees a run nobody owns and restores it at once, not 6 s later
  const reloaded = w.tab('bbbbbbbbbbbb');
  assert.equal(reloaded.foreignActive(), false);
  assert.equal(reloaded.beat(snap), 'ok');
});

test('F-04 regression guard: WITHOUT the released flag the old sequence would block the reload for 6 s', () => {
  const w = world();
  const A = w.tab('aaaaaaaaaaaa');
  A.beat(snap);
  A.release(snap);
  // emulate the old bug by writing a live heartbeat after the release
  const rec = w.rec;
  const live = { ...rec, hb: 1_700_000_000_000 + 10 };
  const other = createOwnership({ tabId: 'bbbbbbbbbbbb', now: () => 1_700_000_000_000 + 20, read: () => sanitizeProgress(live), write() {} });
  assert.equal(other.foreignActive(), true, 'this is the state the fix prevents');
});

test('bfcache: a released page that is restored (pageshow persisted) re-acquires and beats again', () => {
  const w = world();
  const A = w.tab('aaaaaaaaaaaa');
  A.beat(snap);
  A.release(snap); // entering the bfcache
  assert.equal(A.isReleased(), true);
  w.advance(30_000);
  A.reacquire(); // pageshow, persisted
  assert.equal(A.isReleased(), false);
  assert.equal(A.beat(snap), 'ok');
  assert.ok(w.rec.hb > 0);
  const B = w.tab('bbbbbbbbbbbb');
  assert.equal(B.foreignActive(), true, 'and it is a live run again');
});

test('if another tab took the run over while this page sat in the bfcache, re-acquiring does not steal it back', () => {
  const w = world();
  const A = w.tab('aaaaaaaaaaaa');
  const B = w.tab('bbbbbbbbbbbb');
  A.beat(snap);
  A.release(snap);
  w.advance(2000);
  assert.equal(B.beat(snap), 'ok', 'B takes over the released run');
  A.reacquire();
  assert.equal(A.beat(snap), 'foreign');
  assert.equal(w.rec.hb > 0 && w.writes.at(-1)[0], 'bbbbbbbbbbbb');
});

test('a fresh heartbeat from another tab blocks beat() and release(); a stale one does not', () => {
  const w = world();
  const A = w.tab('aaaaaaaaaaaa');
  const B = w.tab('bbbbbbbbbbbb');
  A.beat(snap);
  assert.equal(B.beat(snap), 'foreign');
  assert.equal(B.release(snap), 'foreign', 'a tab that does not own the run cannot release it either');
  assert.equal(w.rec.hb > 0, true);
  w.advance(HEARTBEAT_STALE_MS);
  assert.equal(B.beat(snap), 'ok', 'A stopped beating (closed or frozen): taken over');
});

test('heartbeats keep the owner fresh, so a second tab keeps being refused while the first plays', () => {
  const w = world();
  const A = w.tab('aaaaaaaaaaaa');
  const B = w.tab('bbbbbbbbbbbb');
  for (let i = 0; i < 20; i++) {
    assert.equal(A.beat(snap), 'ok');
    w.advance(2000);
    assert.equal(B.foreignActive(), true, `t+${(i + 1) * 2}s`);
  }
});
