// Guess validation shared by Classic and Blood. Kept separate so both modes reject exactly the same input
// and a typed reason (not a thrown error) reaches the UI.

/**
 * @typedef {{ok: true, digits: number[]} | {ok: false, reason: 'length'|'incomplete'|'invalid'}} GuessCheck
 * A guess that repeats a digit on a no-repeat puzzle is rejected by the sessions with reason 'repeat' (free).
 */

const isEmpty = (d) => d === null || d === undefined || d === '' || d === -1;

/**
 * 'length': not an array of the right size. 'incomplete': right size but a dial is empty.
 * 'invalid': something that is not an integer digit. Strings are rejected on purpose: the UI owns the
 * conversion, and "7" === 7 bugs belong at that boundary, not here.
 * @param {unknown} guess
 * @param {number} length
 * @returns {GuessCheck}
 */
export function checkGuess(guess, length) {
  if (!Array.isArray(guess)) return { ok: false, reason: 'invalid' };
  if (guess.length !== length) return { ok: false, reason: 'length' };
  if (guess.some(isEmpty)) return { ok: false, reason: 'incomplete' };
  if (!guess.every((d) => Number.isInteger(d) && d >= 0 && d <= 9)) return { ok: false, reason: 'invalid' };
  return { ok: true, digits: guess.slice() };
}

/** True if any digit appears twice. @param {readonly number[]} digits */
export const hasRepeat = (digits) => new Set(digits).size !== digits.length;

/** @param {number[]} digits @returns {string} */
export const guessKey = (digits) => digits.join('');

/** @param {string} key @param {number} length @returns {number[] | null} */
export function parseGuessKey(key, length) {
  if (typeof key !== 'string' || key.length !== length || !/^[0-9]+$/.test(key)) return null;
  return Array.from(key, Number);
}
