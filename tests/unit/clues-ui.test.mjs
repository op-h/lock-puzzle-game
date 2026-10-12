// Clue rows as symbols: pure formatters, the pips model, and the diff-append plan (no rebuild per guess).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLang } from '../../js/i18n/index.js';
import { symbolText, pipsModel, staggerIndex, planClueSync, buildRow, syncClues, STAGGER_STEPS } from '../../js/ui/clues.js';
import { createFakeDocument } from './helpers/fake-dom.mjs';

await Promise.all([loadLang('en'), loadLang('ar')]);

test('symbol text, English: sum, parity, compare, even-count', () => {
  assert.equal(symbolText({ kind: 'sum', value: 12 }, 'en'), '= 12');
  assert.equal(symbolText({ kind: 'parity', pos: 1, parity: 'even' }, 'en'), '2nd: even');
  assert.equal(symbolText({ kind: 'parity', pos: 0, parity: 'odd' }, 'en'), '1st: odd');
  assert.equal(symbolText({ kind: 'compare', a: 0, b: 1, rel: 'gt' }, 'en'), '1st > 2nd');
  assert.equal(symbolText({ kind: 'compare', a: 2, b: 4, rel: 'lt' }, 'en'), '3rd < 5th');
  assert.equal(symbolText({ kind: 'evenCount', value: 2 }, 'en'), 'even: 2');
  assert.equal(symbolText({ kind: 'evenCount', value: 0 }, 'en'), 'even: 0');
});

test('symbol text, Arabic: Western digits, ASCII operators, the words are the only translated pieces', () => {
  assert.equal(symbolText({ kind: 'sum', value: 12 }, 'ar'), '= 12');
  assert.equal(symbolText({ kind: 'parity', pos: 1, parity: 'even' }, 'ar'), '2: زوجي');
  assert.equal(symbolText({ kind: 'parity', pos: 3, parity: 'odd' }, 'ar'), '4: فردي');
  assert.equal(symbolText({ kind: 'compare', a: 0, b: 1, rel: 'gt' }, 'ar'), '1 > 2');
  assert.equal(symbolText({ kind: 'compare', a: 0, b: 1, rel: 'lt' }, 'ar'), '1 < 2');
  assert.equal(symbolText({ kind: 'evenCount', value: 3 }, 'ar'), 'زوجي: 3');
  for (const c of [{ kind: 'sum', value: 7 }, { kind: 'compare', a: 0, b: 2, rel: 'gt' }, { kind: 'evenCount', value: 1 }]) {
    assert.ok(!/[٠-٩۰-۹]/.test(symbolText(c, 'ar')), 'no non-Latin digits');
  }
});

test('symbol text: positions up to 10th exist in both languages; a feedback clue has no symbol text', () => {
  for (const lang of ['en', 'ar']) for (let i = 0; i < 10; i++) assert.ok(symbolText({ kind: 'parity', pos: i, parity: 'even' }, lang).length > 3);
  assert.equal(symbolText({ kind: 'feedback', guess: [1, 2, 3], bulls: 1, cows: 0 }, 'en'), null);
});

test('pips model: right-place pips first, then wrong-place; count = bulls + cows; zero = the none glyph', () => {
  assert.deepEqual(pipsModel({ bulls: 2, cows: 1 }), { pips: ['right', 'right', 'wrong'], none: false });
  assert.deepEqual(pipsModel({ bulls: 0, cows: 3 }), { pips: ['wrong', 'wrong', 'wrong'], none: false });
  assert.deepEqual(pipsModel({ bulls: 1, cows: 0 }), { pips: ['right'], none: false });
  assert.deepEqual(pipsModel({ bulls: 0, cows: 0 }), { pips: [], none: true });
  assert.equal(pipsModel({ bulls: 5, cows: 0 }).pips.length, 5);
  assert.deepEqual(pipsModel({ bulls: -1, cows: 0 }), { pips: [], none: true }, 'garbage never throws');
});

test('stagger index: 0..4 then flat (CSS staggers at most 5 steps)', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9, 20].map(staggerIndex), [0, 1, 2, 3, 4, 4, 4, 4]);
  assert.equal(STAGGER_STEPS, 5);
  assert.equal(staggerIndex(-3), 0);
});

test('diff plan: same puzzle appends only what is missing; a different puzzle (or fewer clues) rebuilds', () => {
  assert.deepEqual(planClueSync({ key: null, count: 0 }, { key: 'a', count: 4 }), { rebuild: true, appendFrom: 0 });
  assert.deepEqual(planClueSync({ key: 'a', count: 4 }, { key: 'a', count: 4 }), { rebuild: false, appendFrom: 4 });
  assert.deepEqual(planClueSync({ key: 'a', count: 2 }, { key: 'a', count: 5 }), { rebuild: false, appendFrom: 2 });
  assert.deepEqual(planClueSync({ key: 'a', count: 4 }, { key: 'b', count: 4 }), { rebuild: true, appendFrom: 0 });
  assert.deepEqual(planClueSync({ key: 'a', count: 5 }, { key: 'a', count: 3 }), { rebuild: true, appendFrom: 0 });
});

const FB = { kind: 'feedback', guess: [4, 2, 1], bulls: 1, cows: 2 };
const SUM = { kind: 'sum', value: 13 };

test('feedback row: flat children = digits, pips (right first), hidden sentence; every visual piece aria-hidden', () => {
  const doc = createFakeDocument();
  const li = buildRow(doc, FB, 0, 'en');
  assert.equal(li.getAttribute('data-kind'), 'feedback');
  const names = li.children.map((c) => c.getAttribute('data-pip') || c.className);
  assert.deepEqual(names, ['digit', 'digit', 'digit', 'right', 'wrong', 'wrong', 'clue-text visually-hidden']);
  assert.deepEqual(li.children.slice(0, 3).map((c) => c.textContent), ['4', '2', '1']);
  for (const c of li.children.slice(0, 6)) assert.equal(c.getAttribute('aria-hidden'), 'true');
  assert.equal(li.children[6].getAttribute('aria-hidden'), null, 'the sentence is what assistive tech reads');
  assert.match(li.children[6].textContent, /Guess 4 2 1/);
  assert.equal(li.style.props.get('--i'), '0');
});

test('feedback row with no match draws the none glyph, never an empty row', () => {
  const doc = createFakeDocument();
  const li = buildRow(doc, { kind: 'feedback', guess: [7, 2, 9], bulls: 0, cows: 0 }, 1, 'en');
  const glyph = li.children.find((c) => c.tagName === 'SVG');
  assert.ok(glyph);
  assert.equal(glyph.children[0].getAttribute('href'), './assets/sprites.svg#lp-none');
  assert.equal(li.children.filter((c) => c.getAttribute('data-pip')).length, 0);
});

test('symbol rows: kind icon + .sym + hidden sentence; compare carries data-rel; row index drives --i', () => {
  const doc = createFakeDocument();
  const sum = buildRow(doc, SUM, 2, 'en');
  assert.equal(sum.children[0].children[0].getAttribute('href'), './assets/sprites.svg#lp-sum');
  assert.equal(sum.children[1].className, 'sym');
  assert.equal(sum.children[1].textContent, '= 13');
  assert.equal(sum.children[2].textContent, 'The digits add up to 13.');
  const cmp = buildRow(doc, { kind: 'compare', a: 0, b: 2, rel: 'lt' }, 7, 'en');
  assert.equal(cmp.getAttribute('data-rel'), 'lt');
  assert.equal(cmp.style.props.get('--i'), '4', 'later rows share the last stagger step');
  assert.equal(buildRow(doc, { kind: 'evenCount', value: 2 }, 0, 'en').children[0].children[0].getAttribute('href'), './assets/sprites.svg#lp-even-count');
  assert.equal(buildRow(doc, { kind: 'parity', pos: 0, parity: 'odd' }, 0, 'en').children[0].children[0].getAttribute('href'), './assets/sprites.svg#lp-parity');
});

test('syncClues: the same puzzle never replaces existing rows (no replayed entrance); a new puzzle rebuilds; language rewrites text in place', () => {
  const doc = createFakeDocument();
  const list = doc.createElement('ol');
  list.dataset = {};
  const clues = [SUM, FB, { kind: 'evenCount', value: 1 }];
  syncClues(list, clues.slice(0, 2), 'p1', 'en');
  const [first, second] = list.children;
  assert.equal(list.children.length, 2);
  syncClues(list, clues.slice(0, 2), 'p1', 'en');
  assert.equal(list.children[0], first, 'same row objects after a no-op sync');
  syncClues(list, clues, 'p1', 'en');
  assert.equal(list.children.length, 3);
  assert.equal(list.children[0], first);
  assert.equal(list.children[1], second, 'appended, nothing rebuilt');
  syncClues(list, clues, 'p1', 'ar');
  assert.equal(list.children[0], first, 'language change keeps the rows');
  assert.equal(first.children[1].textContent, '= 13');
  assert.match(list.children[2].children[2].textContent, /زوجي|الأرقام|رقم/, 'sentence re-translated in place');
  assert.equal(list.children[2].children[1].textContent, 'زوجي: 1');
  syncClues(list, clues, 'p2', 'ar');
  assert.notEqual(list.children[0], first, 'a different puzzle starts from scratch');
  assert.equal(list.children.length, 3);
});
