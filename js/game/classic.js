// Classic session: one puzzle, no time limit, DOM-free. The clock and the seed source are injected so the
// whole state machine runs under a fake clock in Node.
//
// Invariants (tested): the clock NEVER stops (hiding the tab, sleeping or closing the page does not pause it:
// elapsed is the time since the puzzle was first shown) and is frozen only at the instant of the correct
// submit; a solve scores exactly once; an identical wrong guess costs nothing; the answer is never part
// of anything this module hands out before the puzzle is solved.

import { generatePuzzle } from '../engine/generator.js';
import { puzzleScore } from '../engine/scoring.js';
import { mulberry32, randomSeed } from '../engine/rng.js';
import { checkGuess, guessKey, hasRepeat, parseGuessKey } from './guess.js';
import { createHint } from './hint.js';

const MAX_ELAPSED_MS = 24 * 3600 * 1000;

/**
 * @typedef {Object} ClassicOptions
 * @property {import('../config.js').DifficultyId} difficulty
 * @property {() => number} now monotonic ms (see clock.js)
 * @property {() => number} [wall] epoch ms; only used to persist the start so a reload can continue the same clock
 * @property {number} [seed] explicit seed (restore, tests); otherwise drawn from `newSeed`
 * @property {() => number} [newSeed] fresh uint32 source; defaults to crypto-backed randomSeed
 * @property {() => number} [hintRng] defaults to a stream derived from the puzzle seed
 * @property {typeof generatePuzzle} [generate]
 * @property {{guesses?: string[], usedHint?: boolean, hintPos?: number|null, elapsedMs?: number}} [restore] elapsedMs is already
 *   reconciled with wall time by progress.js (it includes the time the page was closed)
 */

/** @param {ClassicOptions} opts */
export function createClassic(opts) {
  const { difficulty, now } = opts;
  if (typeof now !== 'function') throw new TypeError('createClassic: a `now` clock is required');
  const seed = (opts.seed !== undefined ? opts.seed : (opts.newSeed || randomSeed)()) >>> 0;
  const puzzle = (opts.generate || generatePuzzle)({ difficulty, seed });
  const answer = puzzle.answer; // closure-private from here on
  const length = puzzle.length;
  const hint = createHint({
    answer,
    rng: opts.hintRng || mulberry32((seed ^ 0x48494e54) >>> 0),
    restoredPos: opts.restore && opts.restore.usedHint ? opts.restore.hintPos : null,
  });

  /** @type {string[]} distinct wrong guesses, oldest first */
  const wrongKeys = [];
  const tried = new Set();
  const answerKey = guessKey(answer);
  if (opts.restore && Array.isArray(opts.restore.guesses)) {
    for (const k of opts.restore.guesses) {
      // Re-validated: a stored record is untrusted input. Wrong count is DERIVED from the list so the two can never disagree.
      if (!parseGuessKey(k, length) || k === answerKey || tried.has(k)) continue;
      tried.add(k);
      wrongKeys.push(k);
    }
  }

  const wall = opts.wall || (() => Date.now());
  let carried = 0;
  if (opts.restore && Number.isFinite(opts.restore.elapsedMs)) {
    carried = Math.min(MAX_ELAPSED_MS, Math.max(0, Math.floor(opts.restore.elapsedMs)));
  }
  // One monotonic origin: elapsed = now() - t0. Nothing ever adjusts it (no pause, no resync).
  const t0 = now() - carried;
  /** @type {number | null} */
  let frozen = null;
  /** @type {Readonly<Record<string, any>> | null} */
  let result = null;

  const elapsed = () => (frozen !== null ? frozen : Math.max(0, now() - t0));

  const wrongCount = () => wrongKeys.length;

  return {
    /** The puzzle WITHOUT its answer. */
    puzzle: Object.freeze({
      id: puzzle.id,
      difficulty: puzzle.difficulty,
      seed: puzzle.seed,
      length,
      repeats: puzzle.repeats,
      clues: puzzle.clues,
    }),
    mode: 'classic',
    isSolved: () => result !== null,
    wrong: wrongCount,
    usedHint: () => hint.used(),
    /** @returns {number[][]} wrong guesses, oldest first */
    wrongGuesses: () => wrongKeys.map((k) => /** @type {number[]} */ (parseGuessKey(k, length))),
    /** The revealed digit, or null. Position is where the UI locks it. */
    revealed() {
      const p = hint.position();
      return p === null ? null : { pos: p, digit: answer[p] };
    },
    /** Only after the solve: the UI shows "the code was ...". */
    answerIfSolved: () => (result ? answer.slice() : null),

    elapsedMs: elapsed,

    /**
     * @param {unknown} guess int[] of exactly `length` digits
     */
    submit(guess) {
      if (result) return result; // no double score, however the UI got here
      const t = now();
      const g = checkGuess(guess, length);
      if (!g.ok) return { ok: false, solved: false, reason: g.reason };
      // The puzzle says "all digits different": a repeat cannot be the answer, so it is not a guess at all.
      if (!puzzle.repeats && hasRepeat(g.digits)) return { ok: false, solved: false, reason: 'repeat' };
      const key = guessKey(g.digits);
      if (key === answerKey) {
        frozen = Math.max(0, t - t0);
        const secs = Math.floor(frozen / 1000);
        const wrong = wrongCount();
        const usedHint = hint.used();
        const points = puzzleScore({ difficulty, secs, wrong, usedHint, blood: false });
        result = Object.freeze({ ok: true, solved: true, secs, wrong, usedHint, points, id: puzzle.id, difficulty });
        return result;
      }
      if (tried.has(key)) return { ok: true, solved: false, dup: true, wrong: wrongCount() };
      tried.add(key);
      wrongKeys.push(key);
      return { ok: true, solved: false, wrong: wrongCount() };
    },

    /**
     * @param {ArrayLike<number|null|undefined>} [current] dial contents, so a digit already right is not "revealed"
     * @returns {{ok: true, pos: number, digit: number, already: boolean} | {ok: false, reason: 'solved'}}
     */
    hint(current) {
      if (result) return { ok: false, reason: 'solved' };
      const h = hint.use(current);
      return { ok: true, ...h };
    },

    /** Everything needed to rebuild this session; the puzzle itself is rebuilt from (difficulty, seed). */
    snapshot() {
      return {
        mode: 'classic',
        difficulty,
        seed,
        wrong: wrongCount(),
        usedHint: hint.used(),
        hintPos: hint.position(),
        guesses: wrongKeys.slice(),
        // The start as wall time: a reload continues the SAME clock (elapsed = now - start), nothing pauses it.
        startedAt: Math.floor(wall() - elapsed()),
        elapsedMs: Math.floor(elapsed()),
      };
    },
  };
}
