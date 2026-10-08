// Clues are plain data so they can be serialised, tested and rendered in any language.
//
// Positions (pos/a/b) are 0-based. A feedback clue's guess always has distinct digits; see generator.js.

import { feedbackPacked } from './feedback.js';

/** @typedef {{kind:'feedback', guess:number[], bulls:number, cows:number}} FeedbackClue */
/** @typedef {{kind:'sum', value:number}} SumClue */
/** @typedef {{kind:'parity', pos:number, parity:'even'|'odd'}} ParityClue */
/** @typedef {{kind:'compare', a:number, b:number, rel:'gt'|'lt'}} CompareClue */
/** @typedef {{kind:'evenCount', value:number}} EvenCountClue */
/** @typedef {FeedbackClue|SumClue|ParityClue|CompareClue|EvenCountClue} Clue */

export const CLUE_KINDS = Object.freeze(['feedback', 'sum', 'parity', 'compare', 'evenCount']);

/**
 * Does `code` agree with `clue`? Throws on an unknown kind: returning false would make a typo in a
 * clue silently "eliminate every code" and the solver would report an impossible puzzle as unsolvable.
 * Structural validity (positions in range etc.) is checked once by validateClue, not here, because
 * this runs in the solver's inner loop.
 * @param {Clue} clue
 * @param {ArrayLike<number>} code
 * @returns {boolean}
 */
export function satisfies(clue, code) {
  switch (clue.kind) {
    case 'feedback':
      return feedbackPacked(clue.guess, code) === ((clue.bulls << 4) | clue.cows);
    case 'sum': {
      let s = 0;
      for (let i = 0; i < code.length; i++) s += code[i];
      return s === clue.value;
    }
    case 'parity':
      return (code[clue.pos] % 2 === 0) === (clue.parity === 'even');
    case 'compare':
      // Strict on purpose: equal digits satisfy neither 'gt' nor 'lt'.
      return clue.rel === 'gt' ? code[clue.a] > code[clue.b] : code[clue.a] < code[clue.b];
    case 'evenCount': {
      let e = 0;
      for (let i = 0; i < code.length; i++) if (code[i] % 2 === 0) e++;
      return e === clue.value;
    }
    default:
      throw new TypeError(`satisfies: unknown clue kind "${clue.kind}"`);
  }
}

const isInt = (x) => Number.isInteger(x);
const isDigit = (x) => isInt(x) && x >= 0 && x <= 9;

/**
 * Throws if a clue is malformed for codes of `length`. Called at the boundary (solver entry,
 * generator output) so the hot path can stay branch-light.
 * @param {Clue} clue
 * @param {number} length
 */
export function validateClue(clue, length) {
  const bad = (why) => {
    throw new TypeError(`invalid ${clue && clue.kind} clue: ${why}`);
  };
  if (!clue || typeof clue !== 'object') bad('not an object');
  const posOk = (p) => isInt(p) && p >= 0 && p < length;
  switch (clue.kind) {
    case 'feedback':
      if (!Array.isArray(clue.guess) || clue.guess.length !== length || !clue.guess.every(isDigit)) bad('guess');
      if (!isInt(clue.bulls) || !isInt(clue.cows) || clue.bulls < 0 || clue.cows < 0) bad('bulls/cows');
      if (clue.bulls + clue.cows > length) bad('bulls + cows exceeds length');
      break;
    case 'sum':
      if (!isInt(clue.value) || clue.value < 0 || clue.value > 9 * length) bad('value');
      break;
    case 'parity':
      if (!posOk(clue.pos)) bad('pos');
      if (clue.parity !== 'even' && clue.parity !== 'odd') bad('parity');
      break;
    case 'compare':
      if (!posOk(clue.a) || !posOk(clue.b) || clue.a === clue.b) bad('a/b');
      if (clue.rel !== 'gt' && clue.rel !== 'lt') bad('rel');
      break;
    case 'evenCount':
      if (!isInt(clue.value) || clue.value < 0 || clue.value > length) bad('value');
      break;
    default:
      throw new TypeError(`unknown clue kind "${clue.kind}"`);
  }
}

/**
 * Canonical identity string, used to reject duplicates. `compare` is normalised so that
 * "pos0 > pos2" and "pos2 < pos0", which say the same thing, share one key.
 * @param {Clue} clue
 * @returns {string}
 */
export function clueKey(clue) {
  switch (clue.kind) {
    case 'feedback':
      return `f:${clue.guess.join('')}:${clue.bulls}:${clue.cows}`;
    case 'sum':
      return `s:${clue.value}`;
    case 'parity':
      return `p:${clue.pos}:${clue.parity}`;
    case 'compare': {
      let { a, b, rel } = clue;
      if (a > b) {
        [a, b] = [b, a];
        rel = rel === 'gt' ? 'lt' : 'gt';
      }
      return `c:${a}:${b}:${rel}`;
    }
    case 'evenCount':
      return `e:${clue.value}`;
    default:
      throw new TypeError(`clueKey: unknown clue kind "${clue.kind}"`);
  }
}
