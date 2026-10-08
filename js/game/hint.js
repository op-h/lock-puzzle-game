// Classic-only hint: reveals ONE answer digit, once per puzzle (it halves the score, see scoring.js).
// The position comes from a seeded rng so a test (or a replay of the same seed) is deterministic.

import { randInt } from '../engine/rng.js';

/**
 * Prefer positions the player has not already got right; if every dial already looks right (they are
 * one tap from solving) fall back to all positions so the hint still has something to say.
 * @param {readonly number[]} answer
 * @param {ArrayLike<number|null|undefined> | null | undefined} current what is on the dials now
 * @param {() => number} rng
 * @returns {number}
 */
export function chooseHintPosition(answer, current, rng) {
  const open = [];
  for (let i = 0; i < answer.length; i++) if (!current || current[i] !== answer[i]) open.push(i);
  const pool = open.length > 0 ? open : answer.map((_, i) => i);
  return pool[randInt(rng, pool.length)];
}

/**
 * @param {{answer: readonly number[], rng: () => number, restoredPos?: number | null}} o
 */
export function createHint({ answer, rng, restoredPos = null }) {
  /** @type {number | null} */
  let pos = Number.isInteger(restoredPos) && restoredPos >= 0 && restoredPos < answer.length ? restoredPos : null;
  return {
    used: () => pos !== null,
    position: () => pos,
    /**
     * Idempotent: the second call returns the same reveal and changes nothing.
     * @param {ArrayLike<number|null|undefined>} [current]
     * @returns {{pos: number, digit: number, already: boolean}}
     */
    use(current) {
      const already = pos !== null;
      if (pos === null) pos = chooseHintPosition(answer, current, rng);
      return { pos, digit: answer[pos], already };
    },
  };
}
