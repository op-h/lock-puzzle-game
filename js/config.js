// Tunable constants (ADR 0003). Everything a designer may want to rebalance lives here so the
// engine and scoring modules stay free of magic numbers.

/** @typedef {'feedback'|'sum'|'parity'|'compare'|'evenCount'} ClueKind */
/** @typedef {'rookie'|'agent'|'hacker'|'master'} DifficultyId */
/**
 * @typedef {Object} DifficultyConfig
 */

// Frozen so a stray write in UI code cannot silently re-balance the game for the whole session.
function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

const ALL_KINDS = ['feedback', 'sum', 'parity', 'compare', 'evenCount'];

export const DIFFICULTIES = deepFreeze({
  rookie: { length: 3, repeats: false, kinds: ['feedback'], par: 45, base: 100, clues: [3, 5] },
  agent: { length: 3, repeats: true, kinds: ['feedback', 'parity', 'sum'], par: 75, base: 200, clues: [4, 6] },
  hacker: { length: 4, repeats: false, kinds: ALL_KINDS.slice(), par: 120, base: 350, clues: [4, 7] },
  master: { length: 5, repeats: false, kinds: ALL_KINDS.slice(), par: 180, base: 600, clues: [5, 8] },
});

/** Display / progression order, easiest first. */
export const DIFFICULTY_ORDER = Object.freeze(['rookie', 'agent', 'hacker', 'master']);

/**
 * Speed/accuracy/hint constants consumed by scoring.js. speedMax and speedFloor give
 * 2.0 at t=0 and 1.25 at t=par (0.5 + 1.5 * 0.5), decaying toward the floor.
 */
export const SCORING = deepFreeze({
  speedMax: 2.0,
  speedFloor: 0.5,
  accuracyStep: 0.08,
  accuracyFloor: 0.4,
  hintFactor: 0.5,
});

/**
 * Blood Point mode. `ramp` rows are matched from the end: the last row whose `from` is <= solves wins.
 */
export const BLOOD = deepFreeze({
  durationMs: 180000,
  wrongPenaltyMs: 5000,
  skipPenaltyMs: 10000,
  mult: 2,
  ramp: [
    { from: 0, difficulty: 'rookie' },
    { from: 2, difficulty: 'agent' },
    { from: 4, difficulty: 'hacker' },
    { from: 7, difficulty: 'master' },
  ],
});

/**
 * Difficulty for the next Blood puzzle given puzzles already solved in this run.
 * Garbage input is clamped (NaN/negative -> start of ramp, Infinity -> top) so a UI bug cannot
 * crash the run or serve an undefined difficulty.
 */
export function bloodDifficultyFor(solvedInRun) {
  let n = Number(solvedInRun);
  if (Number.isNaN(n) || n < 0) n = 0;
  n = Math.floor(n);
  let pick = BLOOD.ramp[0].difficulty;
  for (const row of BLOOD.ramp) if (n >= row.from) pick = row.difficulty;
  return /** @type {DifficultyId} */ (pick);
}

// ADR 0002: this is the Firebase *Web* API key, an identifier rather than a secret (authorization is
// enforced by firestore.rules). It is already public in the repository history. Restrict it to the
// site's HTTP referrer in Google Cloud Console. Never add any other key or token to client code.
export const CLOUD = Object.freeze({
  projectId: 'lock-puzzle-game',
  apiKey: 'AIzaSyAHXQMCBK6NdEdBO4-msM7M0Mm6x-cDxNY',
  enabled: true,
});
