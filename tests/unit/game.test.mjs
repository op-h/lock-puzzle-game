// Game state machines under a fake clock. Nothing here touches the DOM, the network or real time.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BLOOD, bloodDifficultyFor } from '../../js/config.js';
import { generatePuzzle } from '../../js/engine/generator.js';
import { puzzleScore } from '../../js/engine/scoring.js';
import { mulberry32 } from '../../js/engine/rng.js';
import { createClassic } from '../../js/game/classic.js';
import { createBlood, toRunEntry } from '../../js/game/blood.js';
import { chooseHintPosition } from '../../js/game/hint.js';
import { createClock } from '../../js/game/clock.js';
import { DEADLINE_TOLERANCE_MS, sanitizeProgress, restoreClassic, restoreBlood, reconcileRunSummary, createProgress } from '../../js/game/progress.js';
import { createLocal, createMemoryStorage } from '../../js/sync/local.js';
import { mergeSaves, emptySave, derive } from '../../js/sync/merge.js';

// ---- helpers ---------------------------------------------------------------------------------

/** Monotonic + wall clocks that only move when the test says so. */
function fakeClocks(wallStart = 1_700_000_000_000) {
  let t = 1000; // deliberately not 0: a bug that treats 0 as "unset" must show up
  let w = wallStart;
  return {
    now: () => t,
    wall: () => w,
    advance(ms) {
      t += ms;
      w += ms;
    },
    /** wall moves, monotonic does not (system clock changed / sleep) */
    skewWall(ms) {
      w += ms;
    },
  };
}

/** Deterministic seed stream. */
function seeds(start = 1000) {
  let s = start;
  return () => s++;
}

const answerOf = (difficulty, seed) => generatePuzzle({ difficulty, seed }).answer;
const wrongGuessFor = (answer, variant = 0) => {
  // A guaranteed-wrong guess that is also VALID on no-repeat puzzles: a swap of two answer digits (a permutation
  // has no repeats). Different `variant`s give different guesses.
  const n = answer.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (answer[i] === answer[j]) continue;
      const g = answer.slice();
      [g[i], g[j]] = [g[j], g[i]];
      out.push(g);
    }
  }
  return out[variant % out.length];
};

function newClassic(extra = {}) {
  const c = fakeClocks();
  const seed = extra.seed ?? 4242;
  const difficulty = extra.difficulty ?? 'rookie';
  const s = createClassic({ difficulty, seed, now: c.now, wall: c.wall, ...extra });
  return { c, s, answer: answerOf(difficulty, seed), difficulty, seed };
}

function newBlood(extra = {}) {
  const c = fakeClocks();
  const log = { solves: [], finishes: [] };
  const b = createBlood({
    now: c.now,
    wall: c.wall,
    newSeed: seeds(),
    runId: 'run-A',
    onSolve: (e) => log.solves.push(e),
    onFinish: (s) => log.finishes.push(s),
    ...extra,
  });
  const answer = () => {
    const p = b.puzzle();
    return answerOf(p.difficulty, p.seed);
  };
  return { c, b, log, answer };
}

// ---- Classic ---------------------------------------------------------------------------------

test('classic: a fresh puzzle comes from the injected seed and does not expose its answer', () => {
  const { s, seed, difficulty } = newClassic();
  assert.equal(s.puzzle.seed, seed);
  assert.equal(s.puzzle.id, generatePuzzle({ difficulty, seed }).id);
  assert.equal('answer' in s.puzzle, false);
  assert.equal(JSON.stringify(s.snapshot()).includes('answer'), false);
  assert.equal(s.answerIfSolved(), null, 'no answer before the solve');
});

test('classic: score is exactly scoring.js for the same inputs', () => {
  for (const difficulty of ['rookie', 'agent', 'hacker', 'master']) {
    const { c, s, answer } = newClassic({ difficulty, seed: 77 });
    c.advance(12_345);
    const r = s.submit(answer);
    assert.equal(r.solved, true);
    assert.equal(r.secs, 12);
    assert.equal(r.wrong, 0);
    assert.equal(r.usedHint, false);
    assert.equal(r.points, puzzleScore({ difficulty, secs: 12, wrong: 0, usedHint: false, blood: false }));
  }
});

test('classic: the clock NEVER stops: elapsed is time since first shown, whatever the tab does', () => {
  const { c, s, answer } = newClassic();
  c.advance(5000);
  assert.equal(s.elapsedMs(), 5000);
  c.advance(100_000); // tab hidden, device asleep, page throttled: no API can pause it
  assert.equal(s.elapsedMs(), 105_000);
  assert.equal(typeof s.pause, 'undefined', 'there is no pause to call');
  assert.equal(typeof s.resume, 'undefined');
  c.advance(3000);
  const r = s.submit(answer);
  assert.equal(r.secs, 108);
  assert.equal(r.points, puzzleScore({ difficulty: 'rookie', secs: 108, wrong: 0, usedHint: false, blood: false }));
});

test('classic: elapsed is frozen at the instant of the correct submit', () => {
  const { c, s, answer } = newClassic();
  c.advance(7900);
  const r = s.submit(answer);
  assert.equal(r.secs, 7);
  c.advance(60_000);
  assert.equal(s.elapsedMs(), 7900);
});

test('classic: the score gets slower with every second of wall time (monotone), hidden or not', () => {
  const pts = (ms) => {
    const { c, s, answer } = newClassic({ difficulty: 'hacker', seed: 12 });
    c.advance(ms);
    return s.submit(answer).points;
  };
  assert.ok(pts(1000) >= pts(60_000) && pts(60_000) > pts(600_000));
});

test('classic: incomplete / invalid / wrong-length guesses are rejected with a typed reason and cost nothing', () => {
  const { s } = newClassic();
  assert.deepEqual(s.submit([1, 2]), { ok: false, solved: false, reason: 'length' });
  assert.deepEqual(s.submit([1, 2, 3, 4]), { ok: false, solved: false, reason: 'length' });
  assert.equal(s.submit([1, null, 3]).reason, 'incomplete');
  assert.equal(s.submit([1, undefined, 3]).reason, 'incomplete');
  assert.equal(s.submit([1, -1, 3]).reason, 'incomplete');
  assert.equal(s.submit([1, '2', 3]).reason, 'invalid');
  assert.equal(s.submit([1, 2, 10]).reason, 'invalid');
  assert.equal(s.submit([1, 2, 1.5]).reason, 'invalid');
  assert.equal(s.submit('123').reason, 'invalid');
  assert.equal(s.submit(null).reason, 'invalid');
  assert.equal(s.wrong(), 0);
  assert.equal(s.wrongGuesses().length, 0);
});

test('classic: wrong guesses count, history is kept, an identical wrong guess is free', () => {
  const { s, answer } = newClassic();
  const w0 = wrongGuessFor(answer, 0);
  const w1 = wrongGuessFor(answer, 1);
  assert.deepEqual(s.submit(w0), { ok: true, solved: false, wrong: 1 });
  assert.deepEqual(s.submit(w0), { ok: true, solved: false, dup: true, wrong: 1 });
  assert.deepEqual(s.submit(w1), { ok: true, solved: false, wrong: 2 });
  assert.deepEqual(s.wrongGuesses(), [w0, w1]);
  const r = s.submit(answer);
  assert.equal(r.wrong, 2);
  assert.equal(r.points, puzzleScore({ difficulty: 'rookie', secs: 0, wrong: 2, usedHint: false, blood: false }));
});

test('classic: a second submit after the solve is a no-op returning the very same result', () => {
  const { c, s, answer } = newClassic();
  c.advance(3000);
  const first = s.submit(answer);
  c.advance(9000);
  assert.equal(s.submit(answer), first);
  assert.equal(s.submit(wrongGuessFor(answer)), first, 'not a wrong guess either');
  assert.equal(s.submit([1]), first);
  assert.equal(s.wrong(), 0);
  assert.deepEqual(s.answerIfSolved(), answer);
});

test('classic: hint is once per puzzle, idempotent, halves the score, never picks a position already right', () => {
  const { c, s, answer } = newClassic({ difficulty: 'hacker', seed: 9 });
  const current = [answer[0], answer[1], null, null];
  const h = s.hint(current);
  assert.equal(h.ok, true);
  assert.equal(h.already, false);
  assert.ok(h.pos === 2 || h.pos === 3, 'only positions not already correct-looking');
  assert.equal(h.digit, answer[h.pos]);
  assert.equal(s.usedHint(), true);
  const again = s.hint([null, null, null, null]);
  assert.deepEqual({ pos: again.pos, digit: again.digit }, { pos: h.pos, digit: h.digit });
  assert.equal(again.already, true);
  assert.deepEqual(s.revealed(), { pos: h.pos, digit: h.digit });
  c.advance(1000);
  const r = s.submit(answer);
  assert.equal(r.usedHint, true);
  assert.equal(r.points, puzzleScore({ difficulty: 'hacker', secs: 1, wrong: 0, usedHint: true, blood: false }));
  assert.deepEqual(s.hint(), { ok: false, reason: 'solved' });
});

test('classic: hint position is seeded (same rng stream, same pick) and falls back when every dial looks right', () => {
  const answer = [3, 1, 4, 5, 9];
  const a = chooseHintPosition(answer, null, mulberry32(5));
  const b = chooseHintPosition(answer, null, mulberry32(5));
  assert.equal(a, b);
  for (let seed = 0; seed < 50; seed++) {
    const p = chooseHintPosition(answer, [3, 1, 4, 0, 0], mulberry32(seed));
    assert.ok(p === 3 || p === 4);
  }
  const p = chooseHintPosition(answer, answer, mulberry32(1));
  assert.ok(p >= 0 && p < 5);
});

test('blood: hint is unavailable', () => {
  const { b } = newBlood();
  assert.deepEqual(b.hint(), { ok: false, reason: 'blood' });
});

// ---- Blood -----------------------------------------------------------------------------------

test('blood: endsAt is start + duration on the injected clock; remaining derives from the clock, never negative', () => {
  const { c, b } = newBlood();
  assert.equal(b.remainingMs(), BLOOD.durationMs);
  c.advance(100_000); // a throttled tab: no ticks at all, the clock jumps
  assert.equal(b.remainingMs(), BLOOD.durationMs - 100_000);
  c.advance(10_000_000);
  assert.equal(b.remainingMs(), 0);
  assert.deepEqual(b.tick(), { ended: true, remainingMs: 0 });
});

test('blood: a correct submit while time remains is scored blood:true and counted; difficulty follows the ramp', () => {
  const { c, b, log, answer } = newBlood();
  const difficulties = [];
  for (let n = 0; n < 8; n++) {
    assert.equal(b.puzzle().difficulty, bloodDifficultyFor(n));
    difficulties.push(b.puzzle().difficulty);
    c.advance(4000);
    const d = b.puzzle().difficulty;
    const r = b.submit(answer());
    assert.equal(r.solved, true);
    assert.equal(r.points, puzzleScore({ difficulty: d, secs: 4, wrong: 0, usedHint: false, blood: true }));
    assert.equal(r.entry.id, `run-A:${n + 1}`);
  }
  assert.deepEqual(difficulties, ['rookie', 'rookie', 'agent', 'agent', 'hacker', 'hacker', 'hacker', 'master']);
  assert.equal(b.solvedInRun(), 8);
  assert.equal(b.points(), log.solves.reduce((s, e) => s + e.pts, 0));
});

test('blood: wrong guess costs 5 s; skip costs 10 s and serves a fresh puzzle', () => {
  const { b, answer } = newBlood();
  const before = b.puzzle().seed;
  const w = b.submit(wrongGuessFor(answer()));
  assert.equal(w.penaltyMs, 5000);
  assert.equal(b.remainingMs(), BLOOD.durationMs - 5000);
  const s = b.skip();
  assert.equal(s.skipped, true);
  assert.equal(b.remainingMs(), BLOOD.durationMs - 15_000);
  assert.notEqual(b.puzzle().seed, before);
  assert.equal(b.solvedInRun(), 0, 'a skip is not a solve');
  assert.equal(b.wrong(), 0, 'wrong count is per puzzle');
});

test('blood: an identical wrong guess is free; invalid input is free', () => {
  const { b, answer } = newBlood();
  const w = wrongGuessFor(answer());
  b.submit(w);
  const r = b.remainingMs();
  assert.deepEqual(b.submit(w), { ok: true, solved: false, dup: true, wrong: 1 });
  assert.equal(b.remainingMs(), r);
  assert.equal(b.submit([1, null, 2]).reason, 'incomplete');
  assert.equal(b.remainingMs(), r);
});

test('blood: a wrong guess accumulates into the puzzle accuracy factor', () => {
  const { c, b, answer } = newBlood();
  b.submit(wrongGuessFor(answer(), 0));
  b.submit(wrongGuessFor(answer(), 1));
  c.advance(2000);
  const d = b.puzzle().difficulty;
  const r = b.submit(answer());
  assert.equal(r.wrong, 2);
  assert.equal(r.points, puzzleScore({ difficulty: d, secs: 2, wrong: 2, usedHint: false, blood: true }));
});

test('blood: expiry race. At endsAt a correct answer is rejected; one ms earlier it is accepted', () => {
  {
    const { c, b, log, answer } = newBlood();
    c.advance(BLOOD.durationMs - 1);
    const r = b.submit(answer());
    assert.equal(r.solved, true, 'endsAt - 1 ms still counts');
    assert.equal(log.solves.length, 1);
  }
  {
    const { c, b, log, answer } = newBlood();
    c.advance(BLOOD.durationMs);
    const r = b.submit(answer());
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'expired');
    assert.equal(log.solves.length, 0, 'no points for a submit at the deadline');
    assert.equal(log.finishes.length, 1);
    assert.equal(log.finishes[0].points, 0);
  }
  {
    const { c, b, answer } = newBlood();
    c.advance(BLOOD.durationMs + 5000);
    assert.equal(b.submit(answer()).reason, 'expired');
  }
});

test('blood: submit decides by the clock even if no tick ever noticed the expiry', () => {
  const { c, b, log, answer } = newBlood();
  const ans = answer();
  c.advance(BLOOD.durationMs + 1);
  assert.equal(b.isEnded(), false, 'nothing has looked at the clock yet');
  assert.equal(b.submit(ans).solved, undefined);
  assert.equal(b.isEnded(), true);
  assert.equal(log.finishes.length, 1);
});

test('blood: a wrong guess that reaches the deadline ends the run at once and forfeits the puzzle', () => {
  const { c, b, log, answer } = newBlood();
  const ok = b.submit(answer());
  assert.equal(ok.solved, true);
  c.advance(BLOOD.durationMs - 4000); // 4 s left, wrong costs 5 s
  const r = b.submit(wrongGuessFor(answer()));
  assert.equal(r.ended, true);
  assert.equal(b.isEnded(), true);
  assert.equal(b.remainingMs(), 0);
  assert.equal(b.puzzle(), null, 'forfeited puzzle is gone');
  assert.equal(log.finishes.length, 1);
  assert.equal(log.finishes[0].solved, 1);
  assert.equal(log.finishes[0].points, ok.points, 'earlier solves are kept, the forfeit adds nothing');
  assert.equal(b.submit([0, 0, 0]).reason, 'ended');
});

test('blood: a wrong guess with exactly 5 s left ends the run (<= 0), with 5001 ms it does not', () => {
  {
    const { c, b } = newBlood();
    c.advance(BLOOD.durationMs - 5000);
    assert.equal(b.submit(wrongGuessFor(answerOf(b.puzzle().difficulty, b.puzzle().seed))).ended, true);
  }
  {
    const { c, b } = newBlood();
    c.advance(BLOOD.durationMs - 5001);
    const r = b.submit(wrongGuessFor(answerOf(b.puzzle().difficulty, b.puzzle().seed)));
    assert.equal(r.ended, false);
    assert.equal(b.remainingMs(), 1);
  }
});

test('blood: a skip that reaches the deadline ends the run and serves no new puzzle', () => {
  const { c, b, log } = newBlood();
  c.advance(BLOOD.durationMs - 9000);
  const r = b.skip();
  assert.equal(r.ended, true);
  assert.equal(b.puzzle(), null);
  assert.equal(b.remainingMs(), 0);
  assert.equal(log.finishes.length, 1);
  assert.equal(b.skip().reason, 'ended');
});

test('blood: finish() is idempotent: same summary, one onFinish, whatever ends the run first', () => {
  const { c, b, log, answer } = newBlood();
  b.submit(answer());
  c.advance(10_000);
  const a = b.finish();
  const again = b.finish();
  assert.equal(a, again);
  assert.equal(a.runId, 'run-A');
  assert.equal(a.solved, 1);
  assert.equal(log.finishes.length, 1);
  c.advance(BLOOD.durationMs);
  b.tick();
  b.skip();
  b.submit([0, 0, 0]);
  assert.equal(log.finishes.length, 1);
  assert.equal(b.finish(), a);
});

test('blood: summary time is the wall instant of the deadline when noticed late, "now" when quit early', () => {
  const late = newBlood();
  const start = late.c.wall();
  late.c.advance(BLOOD.durationMs + 50_000);
  assert.equal(late.b.finish().t, start + BLOOD.durationMs);
  const early = newBlood();
  early.c.advance(30_000);
  assert.equal(early.b.finish().t, early.c.wall());
});

test('blood: history entries and run summary are accepted by sync merge with nothing dropped', () => {
  const { c, b, log, answer } = newBlood();
  for (let i = 0; i < 5; i++) {
    c.advance(3000);
    b.submit(wrongGuessFor(answer()));
    b.submit(answer());
  }
  const summary = b.finish();
  const ids = log.solves.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  assert.deepEqual(ids, ['run-A:1', 'run-A:2', 'run-A:3', 'run-A:4', 'run-A:5']);
  for (const e of log.solves) {
    assert.equal(e.m, 'b');
    assert.equal(e.h, 0);
    assert.equal(e.r, 'run-A');
    assert.ok(e.id.length <= 64);
  }
  const base = emptySave('Ali', 1);
  const save = { ...base, history: log.solves, runs: [toRunEntry(summary)] };
  const { save: merged, dropped } = mergeSaves(base, save);
  assert.equal(dropped, 0);
  assert.equal(merged.history.length, 5);
  assert.equal(merged.runs.length, 1);
  const d = derive(merged);
  assert.equal(d.blood, summary.points);
  assert.equal(d.bestRun, summary.points);
  assert.equal(d.classic, 0);
  // Re-merging the same events is a no-op: no double count.
  assert.deepEqual(mergeSaves(merged, save).save, merged);
});

test('blood: classic solve entry shape is accepted by sync merge too', () => {
  const { s, answer } = newClassic();
  const r = s.submit(answer);
  const entry = { id: r.id, m: 'c', d: r.difficulty, pts: r.points, s: r.secs, w: r.wrong, h: r.usedHint ? 1 : 0, t: 5 };
  const { dropped, save } = mergeSaves(emptySave('Ali', 1), { ...emptySave('Ali', 1), history: [entry] });
  assert.equal(dropped, 0);
  assert.equal(save.history.length, 1);
});

test('blood: default run ids are unique across runs started at the same instant', () => {
  const c = fakeClocks();
  const a = createBlood({ now: c.now, wall: c.wall, newSeed: seeds(1) });
  const b = createBlood({ now: c.now, wall: c.wall, newSeed: seeds(500) });
  assert.notEqual(a.runId, b.runId);
  assert.match(a.runId, /^[A-Za-z0-9_-]{1,40}$/);
});

// ---- Persistence -----------------------------------------------------------------------------

const PID = 'a'.repeat(64);

test('progress: classic survives reload; the clock kept running while the page was closed', () => {
  const store = createMemoryStorage();
  const local = createLocal({ storage: store });
  const progress = createProgress(local, PID);

  const a = newClassic({ difficulty: 'hacker', seed: 31337 });
  a.c.advance(9000);
  a.s.submit(wrongGuessFor(a.answer, 0));
  a.s.submit(wrongGuessFor(a.answer, 1));
  const h = a.s.hint();
  a.c.advance(2500);
  assert.equal(progress.save(a.s.snapshot()), true);
  assert.equal(JSON.stringify(store.getItem(`lp1.run.${PID}`)).includes('answer'), false);
  const wallAtSave = a.c.wall();

  // "reload" 30 s of wall time later with a fresh monotonic clock
  const c2 = fakeClocks(wallAtSave + 30_000);
  const rec = createProgress(createLocal({ storage: store }), PID).load();
  const s2 = restoreClassic(rec, { now: c2.now, wall: c2.wall });
  assert.ok(s2);
  assert.equal(s2.puzzle.id, a.s.puzzle.id);
  assert.equal(s2.wrong(), 2);
  assert.equal(s2.usedHint(), true);
  assert.deepEqual(s2.revealed(), { pos: h.pos, digit: h.digit });
  assert.equal(s2.elapsedMs(), 11_500 + 30_000, 'closed-tab time counts');
  c2.advance(500);
  assert.deepEqual(s2.wrongGuesses(), a.s.wrongGuesses());
  const r = s2.submit(a.answer);
  assert.equal(r.secs, 42);
  assert.equal(r.wrong, 2);
  assert.equal(r.points, puzzleScore({ difficulty: 'hacker', secs: 42, wrong: 2, usedHint: true, blood: false }));
});

test('progress: setting the system clock BACK cannot refund more than the time since the last save (classic)', () => {
  const a = newClassic({ difficulty: 'hacker', seed: 5 });
  a.c.advance(20_000);
  const rec = sanitizeProgress({ v: 1, ...a.s.snapshot() });
  const back = fakeClocks(a.c.wall() - 3_600_000); // an hour earlier
  const s2 = restoreClassic(rec, { now: back.now, wall: back.wall });
  assert.equal(s2.elapsedMs(), 20_000, 'the stored monotonic elapsed is a floor');
  const fwd = fakeClocks(a.c.wall() + 10_000);
  assert.equal(restoreClassic(rec, { now: fwd.now, wall: fwd.wall }).elapsedMs(), 30_000);
});

test('progress: restored classic that is already in history is discarded (no replaying a solved seed)', () => {
  const a = newClassic({ seed: 5 });
  const rec = sanitizeProgress({ v: 1, ...a.s.snapshot() });
  assert.equal(restoreClassic(rec, { now: a.c.now, isSolved: (id) => id === a.s.puzzle.id }), null);
  assert.ok(restoreClassic(rec, { now: a.c.now, isSolved: () => false }));
});

test('progress: restore ignores forged extras (answer-equal guess, duplicates, wrong length, wrong count)', () => {
  const { answer } = newClassic({ seed: 8 });
  const rec = sanitizeProgress({
    v: 1,
    mode: 'classic',
    difficulty: 'rookie',
    seed: 8,
    wrong: 99,
    usedHint: false,
    guesses: [answer.join(''), '111', '111', '22', 'abc', '112'],
    elapsedMs: -5,
  });
  const s = restoreClassic(rec, { now: fakeClocks().now });
  assert.equal(s.wrong(), 2, 'count is derived from the valid distinct guesses: 111, 112');
  assert.equal(s.elapsedMs(), 0);
});

test('progress: blood run restored while live continues on WALL-clock time', () => {
  const store = createMemoryStorage();
  const progress = createProgress(createLocal({ storage: store }), PID);

  const a = newBlood();
  a.c.advance(20_000);
  const first = a.b.submit(a.answer());
  assert.equal(first.solved, true);
  a.c.advance(5000);
  a.b.submit(wrongGuessFor(a.answer())); // -5 s
  const snap = a.b.snapshot();
  progress.save(snap);
  const wallAtSave = a.c.wall();
  const wrongBefore = a.b.wrongGuesses();

  // tab closed for 40 s of wall time, then reopened with a fresh monotonic clock
  const c2 = fakeClocks(wallAtSave + 40_000);
  const log = { solves: [], finishes: [] };
  const rec = progress.load();
  assert.equal(rec.remainingMs, a.b.remainingMs(), 'monotonic remaining time is stored with the record');
  const out = restoreBlood(rec, {
    now: c2.now,
    wall: c2.wall,
    newSeed: seeds(9000),
    onSolve: (e) => log.solves.push(e),
    onFinish: (s) => log.finishes.push(s),
  });
  assert.equal(out.expired, false);
  const b2 = out.session;
  assert.equal(b2.runId, 'run-A');
  assert.equal(b2.solvedInRun(), 1);
  assert.equal(b2.points(), first.points);
  const expectedRemaining = BLOOD.durationMs - 20_000 - 5000 - 5000 - 40_000;
  assert.equal(b2.remainingMs(), expectedRemaining);
  assert.equal(b2.puzzle().seed, a.b.puzzle().seed);
  assert.equal(b2.puzzle().difficulty, bloodDifficultyFor(1));
  assert.deepEqual(b2.wrongGuesses(), wrongBefore);
  // the next solve continues the numbering, so ids never collide with the earlier entry
  const r = b2.submit(answerOf(b2.puzzle().difficulty, b2.puzzle().seed));
  assert.equal(r.entry.id, 'run-A:2');
  assert.equal(log.finishes.length, 0);
});

test('progress: blood run restored after its wall deadline is finalised exactly once (idempotent record)', () => {
  const a = newBlood();
  a.c.advance(30_000);
  a.b.submit(a.answer());
  const rec = sanitizeProgress({ v: 1, ...a.b.snapshot() });
  const c2 = fakeClocks(rec.endsAt + 1);
  const out = restoreBlood(rec, { now: c2.now, wall: c2.wall });
  assert.equal(out.expired, true);
  assert.equal(out.summary.runId, 'run-A');
  assert.equal(out.summary.solved, 1);
  assert.equal(out.summary.t, rec.endsAt);

  // The save already holds the per-solve entry; the summary reconciles with it and merges once.
  const save = { ...emptySave('Ali', 1), history: a.log.solves };
  const run = reconcileRunSummary(out.summary, save);
  assert.deepEqual(run, { id: 'run-A', t: rec.endsAt, solved: 1, pts: a.b.points() });
  const once = mergeSaves(save, { ...save, runs: [run] }).save;
  const twice = mergeSaves(once, { ...save, runs: [run] }).save;
  assert.equal(twice.runs.length, 1);
  assert.deepEqual(once, twice);

  // exactly at the deadline counts as expired too
  const edge = fakeClocks(rec.endsAt);
  assert.equal(restoreBlood(rec, { now: edge.now, wall: edge.wall }).expired, true);
  const justBefore = fakeClocks(rec.endsAt - 1);
  assert.equal(restoreBlood(rec, { now: justBefore.now, wall: justBefore.wall }).expired, false);
});

test('progress: reconcile prefers what was really recorded per solve over a stale snapshot', () => {
  const save = {
    history: [
      { r: 'x', pts: 100 },
      { r: 'x', pts: 50 },
      { r: 'other', pts: 999 },
    ],
  };
  assert.deepEqual(reconcileRunSummary({ runId: 'x', t: 5, solved: 1, pts: 100 }, save), { id: 'x', t: 5, solved: 2, pts: 150 });
  assert.deepEqual(reconcileRunSummary({ runId: 'x', t: 5, solved: 3, pts: 400 }, null), { id: 'x', t: 5, solved: 3, pts: 400 });
});

test('progress: corrupt or unknown data is discarded safely', () => {
  const good = { v: 1, mode: 'classic', difficulty: 'rookie', seed: 1, guesses: [], usedHint: false, hintPos: null, elapsedMs: 0 };
  assert.ok(sanitizeProgress(good));
  const bad = [
    undefined,
    null,
    42,
    'x',
    [],
    {},
    { ...good, v: 2 },
    { ...good, mode: 'daily' },
    { ...good, difficulty: 'constructor' },
    { ...good, difficulty: 'nightmare' },
    { ...good, seed: -1 },
    { ...good, seed: 1.5 },
    { ...good, seed: 2 ** 32 },
    { ...good, seed: '5' },
    { v: 1, mode: 'blood' },
    { v: 1, mode: 'blood', runId: '../x', startedAt: 1, endsAt: 2, solvedInRun: 0, points: 0 },
    { v: 1, mode: 'blood', runId: 'r', startedAt: 1, endsAt: 1 + BLOOD.durationMs + DEADLINE_TOLERANCE_MS + 1, solvedInRun: 0, points: 0 }, // extended deadline
    { v: 1, mode: 'blood', runId: 'r', startedAt: 1, endsAt: 2, solvedInRun: -1, points: 0 },
    { v: 1, mode: 'blood', runId: 'r', startedAt: 1, endsAt: 2, solvedInRun: 0, points: 1e12 },
    { v: 1, mode: 'blood', runId: 'r', startedAt: NaN, endsAt: 2, solvedInRun: 0, points: 0 },
  ];
  for (const b of bad) assert.equal(sanitizeProgress(b), null, JSON.stringify(b));
  // junk inside an otherwise valid record is dropped, not trusted
  const s = sanitizeProgress({ ...good, guesses: ['12', 5, null, {}, '1'.repeat(40)], usedHint: 'yes' });
  assert.deepEqual(s.guesses, ['12']);
  assert.equal(s.usedHint, false);
});

test('progress: storage-level corruption reads as "no progress"; logout wipes it', () => {
  const store = createMemoryStorage();
  const local = createLocal({ storage: store });
  const progress = createProgress(local, PID);
  assert.equal(progress.load(), null);
  store.setItem(`lp1.run.${PID}`, '{not json');
  assert.equal(progress.load(), null);
  store.setItem(`lp1.run.${PID}`, 'x'.repeat(30000));
  assert.equal(progress.load(), null, 'oversized blob is ignored');
  const a = newClassic();
  progress.save(a.s.snapshot());
  assert.ok(progress.load());
  local.clearAccount();
  assert.equal(progress.load(), null, 'logout removes in-progress rounds');
  assert.equal(local.loadRun('not-an-id'), null);
  assert.equal(local.storeRun('not-an-id', {}), false);
});

test('local: preferences persist and survive logout; junk reads as empty', () => {
  const store = createMemoryStorage();
  const local = createLocal({ storage: store });
  assert.deepEqual(local.loadPref(), {});
  local.storePref({ difficulty: 'agent' });
  assert.deepEqual(local.loadPref(), { difficulty: 'agent' });
  local.clearAccount();
  assert.deepEqual(local.loadPref(), { difficulty: 'agent' });
  store.setItem('lp1.pref', '[1,2]');
  assert.deepEqual(local.loadPref(), {});
  store.setItem('lp1.pref', 'nope');
  assert.deepEqual(local.loadPref(), {});
});

// ---- Clock -----------------------------------------------------------------------------------

test('clock: strictly monotonic. A wall clock jumped +1h or -1h NEVER changes now(), so a Blood run cannot end early', () => {
  let p = 100;
  let w = 5_000_000;
  const clock = createClock({ perf: () => p, wall: () => w });
  const t0 = clock.now();
  p += 1000;
  w += 1000;
  assert.equal(clock.resync(), 0, 'no drift');
  w += 3_600_000; // user (or a buggy NTP) sets the clock forward an hour
  assert.equal(clock.resync(), 3_600_000, 'drift is reported');
  assert.equal(clock.now() - t0, 1000, '...but never applied');
  w -= 7_200_000;
  assert.equal(clock.resync(), -7_200_000);
  assert.equal(clock.now() - t0, 1000);
  p += 500;
  assert.equal(clock.now() - t0, 1500);
});

test('clock: beat() reports the gap between timer callbacks (throttled/frozen page detection)', () => {
  let p = 0;
  const clock = createClock({ perf: () => p, wall: () => 0 });
  p += 250;
  assert.equal(clock.beat(), 250);
  p += 250;
  assert.equal(clock.beat(), 250);
  p += 61_000;
  assert.equal(clock.beat(), 61_000);
});

test('blood: a run is NOT shortened by a wall clock jump within the session (monotonic only)', () => {
  let t = 1000;
  let w = 1_700_000_000_000;
  const b = createBlood({ now: () => t, wall: () => w, newSeed: seeds(), runId: 'mono' });
  t += 10_000;
  w += 10_000 + 3_600_000;
  assert.equal(b.remainingMs(), BLOOD.durationMs - 10_000);
  assert.equal(b.tick().ended, false);
  w -= 7_200_000;
  assert.equal(b.remainingMs(), BLOOD.durationMs - 10_000);
});

test('progress: blood restore after the system clock was set BACK is capped by the stored monotonic remaining time', () => {
  const a = newBlood();
  a.c.advance(60_000);
  const rec = sanitizeProgress({ v: 1, ...a.b.snapshot() });
  const rem = BLOOD.durationMs - 60_000;
  assert.equal(rec.remainingMs, rem);
  const back = fakeClocks(a.c.wall() - 3_600_000);
  const out = restoreBlood(rec, { now: back.now, wall: back.wall });
  assert.equal(out.expired, false);
  assert.equal(out.session.remainingMs(), rem, 'never more than was left at the last save');
  const later = fakeClocks(a.c.wall() + 30_000);
  assert.equal(restoreBlood(rec, { now: later.now, wall: later.wall }).session.remainingMs(), rem - 30_000, 'wall time closed still counts');
});

// ---- Fractional clocks (performance.now() is fractional; the save schema is integer-only) ------------------

test('blood: with a fractional monotonic clock, snapshot, run summary and entries are still integers the sync layer accepts', () => {
  let t = 5000.4375;
  let w = 1_700_000_000_123;
  const now = () => t;
  const wall = () => w;
  const adv = (ms) => {
    t += ms;
    w += Math.round(ms);
  };
  const b = createBlood({ now, wall, newSeed: seeds(), runId: 'frac-1' });
  adv(1234.567);
  const p = b.puzzle();
  const r = b.submit(answerOf(p.difficulty, p.seed));
  assert.equal(r.solved, true);
  const snap = b.snapshot();
  for (const v of [snap.startedAt, snap.endsAt, snap.puzzle.startedAt]) assert.ok(Number.isSafeInteger(v), String(v));
  assert.ok(sanitizeProgress({ v: 1, ...snap }), 'a freshly written snapshot must read back as valid');
  adv(BLOOD.durationMs);
  const summary = b.finish();
  assert.ok(Number.isSafeInteger(summary.t));
  const base = emptySave('Ali', 1);
  const run = toRunEntry(summary);
  const { dropped, save } = mergeSaves(base, { ...base, history: [r.entry], runs: [run] });
  assert.equal(dropped, 0);
  assert.equal(save.runs.length, 1);
  assert.equal(save.history.length, 1);
});

test('classic: a fractional clock snapshot is valid progress', () => {
  let t = 10.25;
  const s = createClassic({ difficulty: 'rookie', seed: 3, now: () => t });
  t += 1500.75;
  assert.ok(sanitizeProgress({ v: 1, ...s.snapshot() }));
  assert.equal(s.snapshot().elapsedMs, 1500);
});

// ---- "All digits different" (Rookie/Hacker/Master) ---------------------------------------------------------

test('no-repeat puzzles: a guess with a repeated digit is rejected FREE with reason "repeat" (classic)', () => {
  for (const difficulty of ['rookie', 'hacker', 'master']) {
    const { c, s, answer } = newClassic({ difficulty, seed: 21 });
    const rep = answer.slice();
    rep[1] = rep[0];
    c.advance(1500);
    assert.deepEqual(s.submit(rep), { ok: false, solved: false, reason: 'repeat' }, difficulty);
    assert.equal(s.wrong(), 0, 'not a wrong guess');
    assert.deepEqual(s.wrongGuesses(), [], 'not in the attempts list');
    assert.equal(s.submit(rep).reason, 'repeat', 'and it stays free however often it is tried');
    const r = s.submit(answer);
    assert.equal(r.wrong, 0);
    assert.equal(r.points, puzzleScore({ difficulty, secs: 1, wrong: 0, usedHint: false, blood: false }));
  }
});

test('Agent may repeat digits: a repeated guess is a normal (counted) guess there', () => {
  const { s, answer } = newClassic({ difficulty: 'agent', seed: 21 });
  const rep = [(answer[0] + 1) % 10, (answer[0] + 1) % 10, (answer[0] + 1) % 10];
  const r = s.submit(rep);
  assert.equal(r.ok, true);
  assert.equal(r.wrong, 1);
});

test('blood: a repeated-digit guess on a no-repeat puzzle is rejected free and the clock is untouched', () => {
  const { c, b, log, answer } = newBlood();
  const ans = answer();
  const rep = ans.slice();
  rep[2] = rep[0];
  c.advance(12_000);
  const before = b.remainingMs();
  const r = b.submit(rep);
  assert.deepEqual(r, { ok: false, reason: 'repeat' });
  assert.equal(b.remainingMs(), before, 'no -5 s');
  assert.equal(b.wrong(), 0);
  assert.deepEqual(b.wrongGuesses(), []);
  assert.equal(log.solves.length, 0);
  assert.equal(b.penaltyMs(), 0);
  assert.equal(b.submit(ans).solved, true, 'the same puzzle is still in play');
});

test('blood: even a repeat sent at/after the deadline is a forfeit by the clock, not a rejection', () => {
  const { c, b, answer } = newBlood();
  const rep = answer().slice();
  rep[1] = rep[0];
  c.advance(BLOOD.durationMs);
  assert.equal(b.submit(rep).reason, 'expired');
});

test('blood: Agent puzzles in a run accept repeats and charge the normal penalty', () => {
  const { b, answer } = newBlood();
  b.submit(answer());
  b.submit(answer()); // two solves -> Agent
  assert.equal(b.puzzle().difficulty, 'agent');
  const ans = answer();
  const rep = [(ans[0] + 1) % 10, (ans[0] + 1) % 10, (ans[0] + 1) % 10];
  const before = b.remainingMs();
  const r = b.submit(rep);
  assert.equal(r.ok, true);
  assert.equal(r.penaltyMs, BLOOD.wrongPenaltyMs);
  assert.equal(b.remainingMs(), before - BLOOD.wrongPenaltyMs);
});

test('progress: a fresh honest record whose wall and monotonic clocks disagree by a few ms is NOT rejected as "edited"', () => {
  // startedAt is wall time, endsAt = wall + monotonic remaining: independent roundings can put endsAt 1-2 ms past
  // startedAt + duration. Rejecting that made a live run vanish (and a second tab wipe the first tab's record).
  const base = { v: 1, mode: 'blood', runId: 'r', startedAt: 1_700_000_000_000, solvedInRun: 0, points: 0 };
  for (const over of [0, 1, 2, 500, DEADLINE_TOLERANCE_MS]) {
    assert.ok(sanitizeProgress({ ...base, endsAt: base.startedAt + BLOOD.durationMs + over }), `+${over} ms`);
  }
  assert.equal(sanitizeProgress({ ...base, endsAt: base.startedAt + BLOOD.durationMs + DEADLINE_TOLERANCE_MS + 1 }), null);
  // and restoring such a record can never hand back more than the countdown
  const rec = sanitizeProgress({ ...base, endsAt: base.startedAt + BLOOD.durationMs + 2 });
  const c = fakeClocks(base.startedAt + 10);
  assert.ok(restoreBlood(rec, { now: c.now, wall: c.wall }).session.remainingMs() <= BLOOD.durationMs);
});

test('progress: snapshots taken with independent, jittery wall and monotonic clocks always sanitize', () => {
  for (let jitter = -3; jitter <= 3; jitter++) {
    let t = 1000.4;
    let w = 1_700_000_000_000;
    const b = createBlood({ now: () => t, wall: () => w, newSeed: seeds(), runId: 'j' });
    for (let i = 0; i < 20; i++) {
      t += 137.31;
      w += 137 + (i % 2 ? jitter : -jitter); // the wall clock rounds differently from the monotonic one
      assert.ok(sanitizeProgress({ v: 1, ...b.snapshot() }), `jitter ${jitter}, beat ${i}`);
    }
  }
});
