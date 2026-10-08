// Blood run: a 3:00 countdown shared by every puzzle in the run. DOM-free; clock, wall clock, seed source
// and run id are injected.
//
// The countdown is ONE number, `endsAt`, on the injected monotonic clock. Penalties move `endsAt` earlier.
// Every decision (accept a submit, end the run) reads the clock inside this module, never the UI timer, so
// a late tick or a throttled tab cannot let a late answer through. Displayed time is always derived from
// the clock, never decremented by counting ticks.

import { BLOOD, bloodDifficultyFor } from '../config.js';
import { generatePuzzle } from '../engine/generator.js';
import { puzzleScore } from '../engine/scoring.js';
import { randomSeed } from '../engine/rng.js';
import { checkGuess, guessKey, hasRepeat, parseGuessKey } from './guess.js';

/**
 * @typedef {Object} BloodOptions
 * @property {() => number} now monotonic ms
 * @property {() => number} [wall] epoch ms; only used to stamp entries and to persist wall-clock deadlines
 * @property {() => number} [newSeed]
 * @property {string} [runId]
 * @property {typeof generatePuzzle} [generate]
 * @property {(entry: object) => void} [onSolve] called once per solved puzzle, before submit() returns
 * @property {(summary: object) => void} [onFinish] called exactly once when the run ends, however it ends
 * @property {{runId: string, startedAt: number, remainingMs: number, solvedInRun: number, points: number,
 *   puzzle?: {seed: number, guesses?: string[], elapsedMs?: number}}} [restore]
 */

/** @param {BloodOptions} opts */
export function createBlood(opts) {
  const { now } = opts;
  if (typeof now !== 'function') throw new TypeError('createBlood: a `now` clock is required');
  const wall = opts.wall || (() => Date.now());
  const newSeed = opts.newSeed || randomSeed;
  const generate = opts.generate || generatePuzzle;
  const r = opts.restore || null;

  const t0 = now();
  const startedAtWall = r ? r.startedAt : wall();
  // Run ids must be unique across devices and stay within the save schema's 64-char id (entries add ":<n>").
  const runId = r ? r.runId : opts.runId || `b${startedAtWall.toString(36)}-${newSeed().toString(36)}`;
  let endsAt = r ? t0 + Math.max(0, Math.min(BLOOD.durationMs, r.remainingMs)) : t0 + BLOOD.durationMs;
  let solvedInRun = r ? r.solvedInRun : 0;
  let points = r ? r.points : 0;
  let penaltyMs = 0;
  /** @type {Readonly<{runId: string, solved: number, points: number, t: number}> | null} */
  let summary = null;
  /** @type {object[]} entries solved by THIS instance (a restored run's earlier ones live in the save) */
  const entries = [];

  /** @type {{puzzle: any, seed: number, startedAt: number, wrongKeys: string[], tried: Set<string>, answerKey: string}} */
  let cur = /** @type {any} */ (null);

  function startPuzzle(seed, elapsedMs = 0, restoredGuesses = []) {
    const difficulty = bloodDifficultyFor(solvedInRun);
    const puzzle = generate({ difficulty, seed });
    const answerKey = guessKey(puzzle.answer);
    const wrongKeys = [];
    const tried = new Set();
    for (const k of restoredGuesses) {
      if (!parseGuessKey(k, puzzle.length) || k === answerKey || tried.has(k)) continue;
      tried.add(k);
      wrongKeys.push(k);
    }
    cur = { puzzle, seed: puzzle.seed, startedAt: now() - Math.max(0, elapsedMs), wrongKeys, tried, answerKey };
  }

  const remaining = () => (summary ? 0 : Math.max(0, endsAt - now()));

  function finish() {
    if (summary) return summary;
    // Wall time of the true end: if we noticed the expiry late, stamp the deadline, not "now".
    // Floored: performance.now() is fractional and the save schema only accepts integer timestamps.
    const t = Math.floor(wall() + Math.min(0, endsAt - now()));
    summary = Object.freeze({ runId, solved: solvedInRun, points, t });
    cur = /** @type {any} */ (null); // the puzzle in play is forfeited: nothing of it survives
    if (typeof opts.onFinish === 'function') {
      try {
        opts.onFinish(summary);
      } catch {
        // A UI callback failing must not make finish() throw into a timer tick.
      }
    }
    return summary;
  }

  /** @returns {boolean} true if the run is over after the penalty */
  function penalise(ms) {
    penaltyMs += ms;
    endsAt -= ms;
    if (endsAt - now() <= 0) {
      finish();
      return true;
    }
    return false;
  }

  // The constructor is the only place a run can start with a puzzle; a restored run already knows its seed.
  if (r && r.puzzle) startPuzzle(r.puzzle.seed, r.puzzle.elapsedMs || 0, r.puzzle.guesses || []);
  else startPuzzle(newSeed());
  // A restored run that is already out of time ends right here, exactly once.
  if (endsAt - now() <= 0) finish();

  const ended = () => summary !== null;

  return {
    mode: 'blood',
    runId,
    isEnded: ended,
    remainingMs: remaining,
    /** Safe to call from any timer; ends the run when the clock says so. */
    tick() {
      if (!summary && now() >= endsAt) finish();
      return { ended: ended(), remainingMs: remaining() };
    },
    solvedInRun: () => solvedInRun,
    points: () => points,
    penaltyMs: () => penaltyMs,
    entries: () => entries.slice(),
    /** The puzzle in play WITHOUT its answer; null once the run is over. */
    puzzle() {
      if (!cur) return null;
      const p = cur.puzzle;
      return Object.freeze({
        id: p.id,
        difficulty: p.difficulty,
        seed: p.seed,
        length: p.length,
        repeats: p.repeats,
        clues: p.clues,
        n: solvedInRun + 1,
      });
    },
    wrong: () => (cur ? cur.wrongKeys.length : 0),
    wrongGuesses: () => (cur ? cur.wrongKeys.map((k) => /** @type {number[]} */ (parseGuessKey(k, cur.puzzle.length))) : []),
    /** Hints do not exist in Blood. */
    hint: () => ({ ok: false, reason: 'blood' }),

    /** @param {unknown} guess */
    submit(guess) {
      if (summary) return { ok: false, reason: 'ended', ended: true };
      const t = now();
      // The clock is read HERE. At or after the deadline even a correct answer is a forfeit.
      if (t >= endsAt) {
        finish();
        return { ok: false, reason: 'expired', ended: true };
      }
      const g = checkGuess(guess, cur.puzzle.length);
      if (!g.ok) return { ok: false, reason: g.reason };
      // Rejected free (no wrong++, no penalty, the clock is untouched): "all digits different" is a rule of the
      // puzzle, so a repeat is not a guess.
      if (!cur.puzzle.repeats && hasRepeat(g.digits)) return { ok: false, reason: 'repeat' };
      const key = guessKey(g.digits);
      if (key === cur.answerKey) {
        const secs = Math.floor((t - cur.startedAt) / 1000);
        const wrong = cur.wrongKeys.length;
        const d = cur.puzzle.difficulty;
        const pts = puzzleScore({ difficulty: d, secs, wrong, usedHint: false, blood: true });
        solvedInRun += 1;
        points += pts;
        const entry = { id: `${runId}:${solvedInRun}`, m: 'b', d, pts, s: secs, w: wrong, h: 0, t: wall(), r: runId };
        entries.push(entry);
        if (typeof opts.onSolve === 'function') {
          try {
            opts.onSolve(entry);
          } catch {
            // Recording is the caller's job; its failure must not corrupt the run state.
          }
        }
        startPuzzle(newSeed());
        return { ok: true, solved: true, points: pts, secs, wrong, entry, runPoints: points };
      }
      if (cur.tried.has(key)) return { ok: true, solved: false, dup: true, wrong: cur.wrongKeys.length };
      cur.tried.add(key);
      cur.wrongKeys.push(key);
      const wrong = cur.wrongKeys.length; // read before penalise(): ending the run forfeits (nulls) `cur`
      const over = penalise(BLOOD.wrongPenaltyMs);
      return { ok: true, solved: false, wrong, penaltyMs: BLOOD.wrongPenaltyMs, ended: over };
    },

    skip() {
      if (summary) return { ok: false, reason: 'ended', ended: true };
      if (now() >= endsAt) {
        finish();
        return { ok: false, reason: 'expired', ended: true };
      }
      const over = penalise(BLOOD.skipPenaltyMs);
      if (!over) startPuzzle(newSeed());
      return { ok: true, skipped: true, penaltyMs: BLOOD.skipPenaltyMs, ended: over };
    },

    /** Idempotent. Quit, expiry and the final wrong guess all end up here. */
    finish,

    /** Wall-clock deadlines, so a reload can continue the SAME run (see progress.js). */
    snapshot() {
      const w = wall();
      const rem = remaining();
      return {
        mode: 'blood',
        runId,
        startedAt: startedAtWall,
        endsAt: Math.floor(w + rem), // integers only: progress.js rejects fractional times as corruption
        // The monotonic remaining time at this instant: on restore it caps what a clock set BACK could refund.
        remainingMs: Math.floor(rem),
        solvedInRun,
        points,
        puzzle: cur ? { seed: cur.seed, startedAt: Math.floor(w - (now() - cur.startedAt)), guesses: cur.wrongKeys.slice() } : null,
      };
    },
  };
}

/** The `runs[]` entry for a finished run (merge.js sanitizeRunEntry shape). */
export function toRunEntry(summary) {
  return { id: summary.runId, t: summary.t, solved: summary.solved, pts: summary.points };
}
