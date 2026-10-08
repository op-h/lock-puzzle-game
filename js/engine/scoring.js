// Scoring (ADR 0003): pure, integer, deterministic, monotone.
//   points = round(base * speed * accuracy * hint), then x BLOOD.mult in Blood mode.

import { BLOOD, DIFFICULTIES, SCORING, bloodDifficultyFor } from '../config.js';

export { bloodDifficultyFor };

// Rounding the factors to 1e-9 absorbs the last-ulp differences Math.pow may have between JS engines.
// Rounding is monotone, so it cannot break the "faster never scores less" guarantee.
const settle = (x) => Math.round(x * 1e9) / 1e9;

// Only real numbers (or numeric strings) count. Number(null), Number('') and Number([]) are all 0, which
// would turn a missing value into the best possible score; everything else is NaN and handled as "worst".
const num = (x) => (typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN);

/**
 * Time multiplier: speedMax at 0 s, halving its excess over the floor every `par` seconds.
 * Hostile input is resolved conservatively so a bug can never inflate a score: NaN time counts as
 * infinitely slow, negative time as 0, and an unusable `par` (<= 0, NaN) yields the floor.
 */
export function speedFactor(secs, par) {
  const { speedMax, speedFloor } = SCORING;
  const p = num(par);
  if (!(p > 0)) return speedFloor;
  const s = num(secs);
  const t = Number.isNaN(s) ? Infinity : Math.max(0, s);
  let x = -t / p;
  if (Number.isNaN(x)) x = -Infinity; // Infinity / Infinity: still "as slow as possible"
  return settle(speedFloor + (speedMax - speedFloor) * Math.pow(2, x));
}

/**
 * Accuracy multiplier: loses accuracyStep per wrong guess, never below accuracyFloor.
 * NaN wrong-count is treated as "very many" (floor); negative as 0; fractions are floored.
 */
export function accuracyFactor(wrong) {
  const n = num(wrong);
  const w = Number.isNaN(n) ? Infinity : Math.floor(Math.max(0, n));
  return Math.max(SCORING.accuracyFloor, settle(1 - SCORING.accuracyStep * w));
}

export function puzzleScore({ difficulty, secs, wrong, usedHint, blood }) {
  if (!Object.hasOwn(DIFFICULTIES, difficulty)) throw new RangeError(`unknown difficulty "${difficulty}"`);
  const { base, par } = DIFFICULTIES[difficulty];
  const hint = usedHint ? SCORING.hintFactor : 1;
  const classic = Math.round(base * speedFactor(secs, par) * accuracyFactor(wrong) * hint);
  // Multiply the rounded value: Blood is then exactly 2x Classic, which is what the UI promises
  // ("Blood points are double"), instead of off by one on .5 boundaries.
  return blood ? classic * BLOOD.mult : classic;
}
