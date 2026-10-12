// Clue sentences ("Guess 3 1 7: 1 digit is correct ..."), composed from data so every (bulls, cows) combination is covered.
// Split from index.js: only the Play screen and the legend need them, so they stay out of the first-load graph.

import { getLang, tFor, formatNumber } from './index.js';


const isCount = (x) => Number.isInteger(x) && x >= 0;

/**
 * Sentence describing a feedback result, composed from the two counts so every (bulls, cows)
 * combination is covered by construction, including mixed ones like (1, 2).
 */
export function feedbackText(bulls, cows, lang = getLang()) {
  if (!isCount(bulls) || !isCount(cows)) throw new RangeError('feedbackText: bulls and cows must be non-negative integers');
  if (bulls === 0 && cows === 0) return tFor(lang, 'clue.fb.none');
  const right = bulls > 0 ? tFor(lang, 'clue.fb.right', { count: bulls }) : '';
  const wrong = cows > 0 ? tFor(lang, 'clue.fb.wrong', { count: cows }) : '';
  if (bulls > 0 && cows > 0) return tFor(lang, 'clue.fb.both', { right, wrong });
  return tFor(lang, 'clue.fb.single', { part: bulls > 0 ? right : wrong });
}

function ordinal(lang, pos) {
  if (!Number.isInteger(pos) || pos < 0 || pos > 9) throw new RangeError('clue position out of range');
  return tFor(lang, `clue.pos.${pos + 1}`);
}

/**
 * Plain-string description of a clue, self-contained (a feedback clue includes its guess) so it is
 * usable as an aria-label. The Arabic guess is wrapped in LTR isolates: without them the bidi
 * algorithm would display the digits of "3 1 7" in reverse order inside an RTL sentence.
 */
export function clueText(clue, lang = getLang()) {
  switch (clue.kind) {
    case 'feedback': {
      if (!Array.isArray(clue.guess) || !clue.guess.every((d) => Number.isInteger(d) && d >= 0 && d <= 9)) {
        throw new TypeError('clueText: malformed guess');
      }
      const digits = clue.guess.join(' ');
      const guess = lang === 'ar' ? `⁦${digits}⁩` : digits;
      return tFor(lang, 'clue.fb.full', { guess, result: feedbackText(clue.bulls, clue.cows, lang) });
    }
    case 'sum':
      return tFor(lang, 'clue.sum', { value: formatNumber(clue.value, lang) });
    case 'parity':
      return tFor(lang, clue.parity === 'even' ? 'clue.parity.even' : 'clue.parity.odd', {
        pos: ordinal(lang, clue.pos),
      });
    case 'compare':
      return tFor(lang, clue.rel === 'gt' ? 'clue.compare.gt' : 'clue.compare.lt', {
        a: ordinal(lang, clue.a),
        b: ordinal(lang, clue.b),
      });
    case 'evenCount':
      if (!isCount(clue.value)) throw new RangeError('clueText: evenCount value');
      return tFor(lang, 'clue.evenCount', { count: clue.value });
    default:
      throw new TypeError(`clueText: unknown clue kind "${clue.kind}"`);
  }
}
