// Clue rows (design-v2 section 5, amended: the sentence is back on screen). Feedback = the guess digits plus pips (filled =
// right place, hollow = wrong place, the `none` glyph for zero); the other kinds = a 16 px kind icon. Every row then
// reads its sentence (feedback: just the result, the guess digits are beside it); symbols are aria-hidden, so a screen
// reader hears exactly one full sentence per clue.
// The pure parts (symbol text, pip model, diff plan) are tested in Node; only buildRow touches the DOM.

import { tFor } from '../i18n/index.js';
import { clueText, feedbackText } from '../i18n/clue-text.js';

const SPRITES = './assets/sprites.svg#lp-';
const KIND_ICON = { sum: 'sum', parity: 'parity', compare: 'compare', evenCount: 'even-count' };
const SVG_NS = 'http://www.w3.org/2000/svg';
/** The entrance stagger only has this many steps; later rows share the last delay. */
export const STAGGER_STEPS = 5;

/**
 * Short symbol text of a non-feedback clue (sum "= 12", parity "2nd: even", compare "1st > 2nd", even-count "even: 2").
 * The relation is an ASCII character from the string: CSS isolates the symbol LTR so it is never mirrored.
 * @param {import('../engine/clues.js').Clue} clue @param {'en'|'ar'} lang
 * @returns {string | null} null for feedback clues (they have no symbol text)
 */
export function symbolText(clue, lang) {
  const pos = (i) => tFor(lang, `clue.sym.pos.${i + 1}`);
  switch (clue.kind) {
    case 'sum':
      return tFor(lang, 'clue.sym.sum', { value: clue.value });
    case 'parity':
      return tFor(lang, clue.parity === 'even' ? 'clue.sym.parity.even' : 'clue.sym.parity.odd', { pos: pos(clue.pos) });
    case 'compare':
      return tFor(lang, clue.rel === 'gt' ? 'clue.sym.compare.gt' : 'clue.sym.compare.lt', { a: pos(clue.a), b: pos(clue.b) });
    case 'evenCount':
      return tFor(lang, 'clue.sym.evenCount', { count: String(clue.value) });
    default:
      return null;
  }
}

/**
 * Pips of a feedback clue: one per right-place digit first, then one per wrong-place digit. Count = bulls + cows (not
 * the guess length); nothing is drawn for digits that do not match, and zero matches means the `none` glyph.
 * @param {{bulls: number, cows: number}} clue
 * @returns {{pips: Array<'right'|'wrong'>, none: boolean}}
 */
export function pipsModel({ bulls, cows }) {
  const pips = [...Array(Math.max(0, bulls)).fill('right'), ...Array(Math.max(0, cows)).fill('wrong')];
  return { pips, none: pips.length === 0 };
}

/** `--i` of row i: 0..4 then stays at 4 (CSS staggers at most 5 steps, 40 ms apart). */
export const staggerIndex = (i) => Math.min(Math.max(0, i), STAGGER_STEPS - 1);

/**
 * How to bring an existing list in line with the clues of the puzzle now in play, without rebuilding rows that are
 * already there (a rebuild would replay the entrance animation on every guess).
 * @param {{key: string|null, count: number}} have what the list currently shows
 * @param {{key: string, count: number}} want
 * @returns {{rebuild: boolean, appendFrom: number}} rebuild = start from scratch (different puzzle or fewer rows);
 *   otherwise append rows [appendFrom, want.count)
 */
export function planClueSync(have, want) {
  if (have.key !== want.key || have.count > want.count) return { rebuild: true, appendFrom: 0 };
  return { rebuild: false, appendFrom: have.count };
}

function icon(doc, name, size) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', size === 16 ? 'lp-icon-sm' : 'lp-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  const use = doc.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', SPRITES + name);
  svg.append(use);
  return svg;
}

function span(doc, cls, text, hidden) {
  const s = doc.createElement('span');
  if (cls) s.className = cls;
  if (text !== undefined) s.textContent = text;
  if (hidden) s.setAttribute('aria-hidden', 'true');
  return s;
}

/**
 * One clue row. Children are flat (no wrappers): digits, pips / none glyph, hidden sentence; or icon, symbol, hidden sentence.
 * @param {Document} doc @param {import('../engine/clues.js').Clue} clue @param {number} index @param {'en'|'ar'} lang
 */
export function buildRow(doc, clue, index, lang) {
  const li = doc.createElement('li');
  li.setAttribute('data-kind', clue.kind);
  if (clue.kind === 'compare') li.setAttribute('data-rel', clue.rel);
  // CSSOM only (a style attribute would break the CSP).
  li.style.setProperty('--i', String(staggerIndex(index)));
  if (clue.kind === 'feedback') {
    for (const d of clue.guess) li.append(span(doc, 'digit', String(d), true));
    const { pips, none } = pipsModel(clue);
    for (const p of pips) {
      const el = span(doc, '', undefined, true);
      el.setAttribute('data-pip', p);
      li.append(el);
    }
    if (none) li.append(icon(doc, 'none', 16));
  } else {
    li.append(icon(doc, KIND_ICON[clue.kind], 16));
    li.append(span(doc, 'sym', symbolText(clue, lang) || '', true));
  }
  if (clue.kind === 'feedback') {
    // On screen: just the result (the digits are right there). For assistive tech: the full sentence, once.
    li.append(span(doc, 'clue-text', feedbackText(clue.bulls, clue.cows, lang), true));
    li.append(span(doc, 'clue-text visually-hidden', clueText(clue, lang)));
  } else {
    li.append(span(doc, 'clue-text', clueText(clue, lang)));
  }
  return li;
}

/** Re-write the language-dependent text of an existing row (language switch) without touching its structure. */
export function refreshRow(li, clue, lang) {
  const sym = li.querySelector('.sym');
  if (sym) sym.textContent = symbolText(clue, lang) || '';
  const shown = li.querySelector('.clue-text');
  if (clue.kind === 'feedback') {
    shown.textContent = feedbackText(clue.bulls, clue.cows, lang);
    li.querySelector('.visually-hidden').textContent = clueText(clue, lang);
  } else shown.textContent = clueText(clue, lang);
}

/**
 * Keep `list` showing exactly `clues`: rebuild for a different puzzle, otherwise append what is missing (and, when only
 * the language changed, rewrite text in place). Rows that exist are never replaced.
 * @param {HTMLElement} list @param {readonly any[]} clues @param {string} key identity of the puzzle
 * @param {'en'|'ar'} lang
 */
export function syncClues(list, clues, key, lang) {
  const doc = list.ownerDocument;
  const plan = planClueSync({ key: list.dataset.puzzle ?? null, count: list.children.length }, { key, count: clues.length });
  if (plan.rebuild) list.replaceChildren();
  list.dataset.puzzle = key;
  if (!plan.rebuild && list.dataset.lang !== lang) Array.from(list.children).forEach((li, i) => refreshRow(li, clues[i], lang));
  list.dataset.lang = lang;
  for (let i = plan.appendFrom; i < clues.length; i++) list.append(buildRow(doc, clues[i], i, lang));
}
