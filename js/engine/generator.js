// Puzzle generator. Contract (ADR 0003): a pure function of (difficulty, seed) that returns a puzzle
// whose clues leave exactly one solution and none of whose clues is redundant.
//
// Strategy: draw the answer from the seed, add random clues that are true of it until the solver says
// "unique", then delete every clue the solution does not need (one random-order pass is enough to reach
// a minimal set, because a clue that was needed against a larger set is still needed against a subset).
// Reject the attempt if the clue count lands outside the difficulty's range and retry with the same
// seeded stream. After MAX_ATTEMPTS a deterministic greedy fallback still guarantees uniqueness.
//
// Decision: feedback-clue guesses always use DISTINCT digits, even when the answer may repeat (Agent).
// A repeated-digit guess makes players ask "does my 1 count twice?"; the answer's own repeats are
// still handled exactly by the two-pass rule, so no information is lost, only ambiguity.

import { DIFFICULTIES } from '../config.js';
import { feedback } from './feedback.js';
import { clueKey, validateClue, satisfies } from './clues.js';
import { codeSpace, solutions } from './solver.js';
import { mulberry32, pick, randInt, shuffled } from './rng.js';

/** @typedef {import('./clues.js').Clue} Clue */
/**
 * @typedef {Object} Puzzle
 * @property {string} id difficulty + "-" + seed in base36
 * @property {import('../config.js').DifficultyId} difficulty
 * @property {number} seed uint32
 * @property {number} length
 * @property {boolean} repeats
 * @property {number[]} answer
 * @property {Clue[]} clues
 */

export const MAX_ATTEMPTS = 60;
// Some answers are inherently too easy for a difficulty (Agent: 100 or 998 fall to a sum clue plus one
// more), so a stuck answer is redrawn from the same seeded stream instead of retried forever.
const ATTEMPTS_PER_ANSWER = 10;
const MAX_STEPS = 20; // clues added before an attempt is abandoned
const FALLBACK_MAX_STEPS = 40;
const PROPOSALS_PER_STEP = 24;

/**
 * @param {unknown} seed
 * @returns {number} uint32
 */
function normalizeSeed(seed) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) throw new TypeError('seed must be a finite number');
  return seed >>> 0;
}

/** Distinct-digit code of `length` (partial Fisher-Yates over 0..9). */
function randomDistinctDigits(rng, length) {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = 0; i < length; i++) {
    const j = i + randInt(rng, 10 - i);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, length);
}

function randomAnswer(rng, spec) {
  if (!spec.repeats) return randomDistinctDigits(rng, spec.length);
  return Array.from({ length: spec.length }, () => randInt(rng, 10));
}

/**
 * A random clue of an allowed kind that is true of `answer`, or null when the draw was unusable
 * (a compare between equal digits). Callers simply draw again.
 * @returns {Clue|null}
 */
function proposeClue(rng, kinds, answer) {
  const n = answer.length;
  switch (pick(rng, kinds)) {
    case 'feedback': {
      const guess = randomDistinctDigits(rng, n);
      // A guess equal to the answer would hand it over.
      if (guess.every((d, i) => d === answer[i])) return null;
      const { bulls, cows } = feedback(guess, answer);
      return { kind: 'feedback', guess, bulls, cows };
    }
    case 'sum':
      return { kind: 'sum', value: answer.reduce((s, d) => s + d, 0) };
    case 'parity': {
      const pos = randInt(rng, n);
      return { kind: 'parity', pos, parity: answer[pos] % 2 === 0 ? 'even' : 'odd' };
    }
    case 'compare': {
      // a < b is always generated; clueKey would normalise the mirror form anyway.
      const a = randInt(rng, n - 1);
      const b = a + 1 + randInt(rng, n - 1 - a);
      if (answer[a] === answer[b]) return null;
      return { kind: 'compare', a, b, rel: answer[a] > answer[b] ? 'gt' : 'lt' };
    }
    case 'evenCount':
      return { kind: 'evenCount', value: answer.filter((d) => d % 2 === 0).length };
    default:
      return null;
  }
}

/** Indices of `alive` whose code satisfies `clue`. `alive === null` means the whole space. */
function narrow(space, alive, clue, scratch) {
  const { length, count, flat } = space;
  const out = [];
  const total = alive ? alive.length : count;
  for (let k = 0; k < total; k++) {
    const idx = alive ? alive[k] : k;
    const base = idx * length;
    for (let i = 0; i < length; i++) scratch[i] = flat[base + i];
    if (satisfies(clue, scratch)) out.push(idx);
  }
  return out;
}

/**
 * Add true clues until only the answer is left. `greedy` picks the most eliminating of several
 * proposals (used by the fallback); otherwise the first proposal that eliminates anything.
 * @returns {Clue[]|null} null when the attempt got stuck
 */
function growClues(rng, spec, kinds, answer, space, greedy) {
  const scratch = new Array(spec.length).fill(0);
  const maxSteps = greedy ? FALLBACK_MAX_STEPS : MAX_STEPS;
  const clues = [];
  const seen = new Set();
  let alive = null;
  let aliveCount = space.count;

  for (let step = 0; step < maxSteps && aliveCount > 1; step++) {
    let best = null;
    let bestAlive = null;
    for (let t = 0; t < PROPOSALS_PER_STEP; t++) {
      const c = proposeClue(rng, kinds, answer);
      if (!c || seen.has(clueKey(c))) continue;
      const next = narrow(space, alive, c, scratch);
      if (next.length === aliveCount) continue; // tells the player nothing new
      if (!best || next.length < bestAlive.length) {
        best = c;
        bestAlive = next;
      }
      if (!greedy) break;
    }
    if (!best) return null;
    clues.push(best);
    seen.add(clueKey(best));
    alive = bestAlive;
    aliveCount = alive.length;
  }
  return aliveCount === 1 ? clues : null;
}

/** Drop every clue the solution does not need, in a seeded random order. */
function minimise(rng, spec, clues) {
  let kept = clues.slice();
  for (const j of shuffled(rng, clues.map((_, i) => i))) {
    const c = clues[j];
    const without = kept.filter((x) => x !== c);
    if (solutions(spec, without, 2).length === 1) kept = without;
  }
  return kept;
}

function isUniqueAnswer(spec, clues, answer) {
  const s = solutions(spec, clues, 2);
  return s.length === 1 && s[0].every((d, i) => d === answer[i]);
}

/**
 * Same as generatePuzzle but also reports how it got there. Tests use `opts.maxAttempts = 0` to force
 * the fallback path; production code should call generatePuzzle.
 * @param {{difficulty: string, seed: number}} input
 * @param {{maxAttempts?: number}} [opts]
 * @returns {{puzzle: Puzzle, attempts: number, fallback: boolean}}
 */
export function generatePuzzleDetailed({ difficulty, seed }, opts = {}) {
  if (!Object.hasOwn(DIFFICULTIES, difficulty)) throw new RangeError(`unknown difficulty "${difficulty}"`);
  const cfg = DIFFICULTIES[difficulty];
  const s = normalizeSeed(seed);
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const spec = { length: cfg.length, repeats: cfg.repeats };
  const space = codeSpace(spec);
  const [min, max] = cfg.clues;

  const rng = mulberry32(s);
  let answer = randomAnswer(rng, spec);

  const finish = (clues, attempts, fallback) => {
    for (const c of clues) validateClue(c, spec.length);
    // Belt and braces: whatever path produced the clues, a non-unique puzzle never leaves this function.
    if (!isUniqueAnswer(spec, clues, answer)) return null;
    return {
      puzzle: {
        id: `${difficulty}-${s.toString(36)}`,
        difficulty,
        seed: s,
        length: spec.length,
        repeats: spec.repeats,
        answer: answer.slice(),
        clues,
      },
      attempts,
      fallback,
    };
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1 && (attempt - 1) % ATTEMPTS_PER_ANSWER === 0) answer = randomAnswer(rng, spec);
    const grown = growClues(rng, spec, cfg.kinds, answer, space, false);
    if (!grown) continue;
    const clues = minimise(rng, spec, grown);
    if (clues.length < min || clues.length > max) continue;
    const done = finish(clues, attempt, false);
    if (done) return done;
  }

  // Fallback: own stream so the result does not depend on how many attempts were burned above.
  const fb = mulberry32((s ^ 0x9e3779b9) >>> 0);
  for (let attempt = 1; attempt <= 20; attempt++) {
    const grown = growClues(fb, spec, cfg.kinds, answer, space, true);
    if (!grown) continue;
    const done = finish(minimise(fb, spec, grown), maxAttempts + attempt, true);
    if (done) return done;
  }
  // Unreachable in practice (tests force this path); failing loudly beats shipping an ambiguous lock.
  throw new Error(`generatePuzzle: could not build a unique puzzle for ${difficulty}-${s}`);
}

/**
 * @param {{difficulty: import('../config.js').DifficultyId, seed: number}} input
 * @returns {Puzzle}
 */
export function generatePuzzle(input) {
  return generatePuzzleDetailed(input).puzzle;
}
