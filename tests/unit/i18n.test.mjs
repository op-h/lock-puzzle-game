// i18n infrastructure and clue text (ADR 0003 #5): every reachable (bulls, cows) has non-empty,
// placeholder-free, distinct text in both languages, and the Arabic is grammatical for each count.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTED, catalogs, resolveLang, getLang, setLang, onLangChange, dirFor, pluralCategory, plural,
  formatNumber, formatDuration, t, tFor, feedbackText, clueText,
} from '../../js/i18n/index.js';
import { loadLang } from '../../js/i18n/index.js';

// Catalogs are lazy-loaded in production; the catalog tests need both present.
await Promise.all([loadLang('en'), loadLang('ar')]);
import { feedback } from '../../js/engine/feedback.js';
import { generatePuzzle } from '../../js/engine/generator.js';
import { DIFFICULTY_ORDER } from '../../js/config.js';
import { refAllCodes, seedAt } from '../helpers/reference.mjs';

const LANGS = ['en', 'ar'];

/** Every (bulls, cows) a length-n code can yield, minus the arithmetically impossible (n-1, 1). */
function combos(n) {
  const out = [];
  for (let b = 0; b <= n; b++) for (let c = 0; b + c <= n; c++) if (!(b === n - 1 && c === 1)) out.push([b, c]);
  return out;
}

function assertClean(s, label) {
  assert.equal(typeof s, 'string', label);
  assert.ok(s.trim().length > 0, `${label}: empty`);
  assert.ok(!/[{}]/.test(s), `${label}: unresolved placeholder in "${s}"`);
  assert.ok(!/undefined|null|NaN|\[object/.test(s), `${label}: leaked value in "${s}"`);
}

describe('feedback sentences cover every (bulls, cows)', () => {
  test('enumeration sizes: n=3 -> 9, n=4 -> 14, n=5 -> 20', () => {
    assert.deepEqual([3, 4, 5].map((n) => combos(n).length), [9, 14, 20]);
  });

  test('(b, c) combinations that feedback() really produces are exactly the enumerated ones', () => {
    for (const [n, repeats] of [[3, true], [3, false], [4, false]]) {
      const all = refAllCodes(n, repeats);
      const seen = new Set();
      for (const g of all) for (const s of all) {
        const { bulls, cows } = feedback(g, s);
        seen.add(`${bulls},${cows}`);
      }
      assert.deepEqual([...seen].sort(), combos(n).map(([b, c]) => `${b},${c}`).sort(), `n=${n} repeats=${repeats}`);
    }
  });

  for (const lang of LANGS) {
    for (const n of [3, 4, 5]) {
      test(`${lang}, n=${n}: non-empty, clean, all distinct`, () => {
        const texts = combos(n).map(([b, c]) => {
          const s = feedbackText(b, c, lang);
          assertClean(s, `${lang} (${b},${c})`);
          return s;
        });
        assert.equal(new Set(texts).size, texts.length, `${lang} n=${n} has duplicate sentences`);
      });
    }

    test(`${lang}: distinct across the union of n=3,4,5`, () => {
      const seen = new Map();
      const keys = new Set([3, 4, 5].flatMap((n) => combos(n).map(([b, c]) => `${b},${c}`)));
      for (const k of keys) {
        const [b, c] = k.split(',').map(Number);
        const s = feedbackText(b, c, lang);
        assert.ok(!seen.has(s), `"${s}" used for both ${seen.get(s)} and ${k}`);
        seen.set(s, k);
      }
      assert.equal(seen.size, keys.size);
    });
  }

  test('English wording, hand-checked, including (1,2) "Complex analysis"', () => {
    const rows = [
      [0, 0, 'No digit is correct.'],
      [1, 0, '1 digit is correct and in the right place.'],
      [2, 0, '2 digits are correct and in the right place.'],
      [0, 1, '1 digit is correct but in the wrong place.'],
      [0, 2, '2 digits are correct but in the wrong place.'],
      [1, 1, '1 digit is correct and in the right place; 1 digit is correct but in the wrong place.'],
      [1, 2, '1 digit is correct and in the right place; 2 digits are correct but in the wrong place.'],
      [2, 1, '2 digits are correct and in the right place; 1 digit is correct but in the wrong place.'],
      [3, 0, '3 digits are correct and in the right place.'],
    ];
    for (const [b, c, want] of rows) assert.equal(feedbackText(b, c, 'en'), want);
  });

  test('Arabic wording, hand-checked against the legacy phrases', () => {
    const rows = [
      [0, 0, 'لا شيء صحيح.'],
      [1, 0, 'رقم واحد صحيح وفي المكان الصحيح.'],
      [0, 1, 'رقم واحد صحيح ولكن في المكان الخطأ.'],
      [0, 2, 'رقمان صحيحان ولكن في المكان الخطأ.'], // legacy: "317"
      [2, 0, 'رقمان صحيحان وفي المكان الصحيح.'],
      [3, 0, '3 أرقام صحيحة وفي المكان الصحيح.'],
      [0, 3, '3 أرقام صحيحة ولكن في المكان الخطأ.'],
      [1, 2, 'رقم واحد صحيح وفي المكان الصحيح، ورقمان صحيحان ولكن في المكان الخطأ.'],
      [2, 1, 'رقمان صحيحان وفي المكان الصحيح، ورقم واحد صحيح ولكن في المكان الخطأ.'],
      [1, 1, 'رقم واحد صحيح وفي المكان الصحيح، ورقم واحد صحيح ولكن في المكان الخطأ.'],
    ];
    for (const [b, c, want] of rows) assert.equal(feedbackText(b, c, 'ar'), want, `(${b},${c})`);
  });

  test('Arabic count agreement: 1 رقم واحد, 2 رقمان, 3-10 N أرقام, 11+ N رقمًا', () => {
    for (const kind of ['right', 'wrong']) {
      const at = (n) => (kind === 'right' ? feedbackText(n, 0, 'ar') : feedbackText(0, n, 'ar'));
      assert.ok(at(1).startsWith('رقم واحد صحيح'));
      assert.ok(at(2).startsWith('رقمان صحيحان'));
      for (let n = 3; n <= 10; n++) assert.ok(at(n).startsWith(`${n} أرقام صحيحة`), `${n}: ${at(n)}`);
      assert.ok(at(11).startsWith('11 رقمًا صحيحًا'));
      assert.ok(at(100).startsWith('100 رقم صحيح'));
    }
  });

  test('English singular/plural agreement', () => {
    assert.match(feedbackText(1, 0, 'en'), /^1 digit is /);
    for (let n = 2; n <= 5; n++) assert.match(feedbackText(n, 0, 'en'), new RegExp(`^${n} digits are `));
  });

  test('rejects nonsense counts', () => {
    for (const bad of [-1, 1.5, NaN, '1', undefined]) {
      assert.throws(() => feedbackText(bad, 0, 'en'), RangeError);
      assert.throws(() => feedbackText(0, bad, 'ar'), RangeError);
    }
  });
});

describe('clueText for every kind', () => {
  test('hand-checked sentences in both languages', () => {
    const rows = [
      [{ kind: 'sum', value: 14 }, 'The digits add up to 14.', 'مجموع الأرقام يساوي 14.'],
      [{ kind: 'parity', pos: 0, parity: 'even' }, 'The first digit is even.', 'الرقم الأول زوجي.'],
      [{ kind: 'parity', pos: 2, parity: 'odd' }, 'The third digit is odd.', 'الرقم الثالث فردي.'],
      [{ kind: 'compare', a: 1, b: 3, rel: 'gt' }, 'The second digit is greater than the fourth digit.', 'الرقم الثاني أكبر من الرقم الرابع.'],
      [{ kind: 'compare', a: 0, b: 4, rel: 'lt' }, 'The first digit is smaller than the fifth digit.', 'الرقم الأول أصغر من الرقم الخامس.'],
      [{ kind: 'evenCount', value: 0 }, 'None of the digits is even.', 'لا يوجد أي رقم زوجي.'],
      [{ kind: 'evenCount', value: 1 }, 'Exactly 1 digit is even.', 'رقم واحد فقط زوجي.'],
      [{ kind: 'evenCount', value: 2 }, 'Exactly 2 digits are even.', 'رقمان فقط زوجيان.'],
      [{ kind: 'evenCount', value: 4 }, 'Exactly 4 digits are even.', '4 أرقام فقط زوجية.'],
    ];
    for (const [clue, en, ar] of rows) {
      assert.equal(clueText(clue, 'en'), en);
      assert.equal(clueText(clue, 'ar'), ar);
    }
  });

  test('feedback clue text names the guess digits in order, LTR-isolated in Arabic', () => {
    const clue = { kind: 'feedback', guess: [3, 1, 7], bulls: 1, cows: 2 };
    assert.equal(
      clueText(clue, 'en'),
      'Guess 3 1 7: 1 digit is correct and in the right place; 2 digits are correct but in the wrong place.',
    );
    const ar = clueText(clue, 'ar');
    assert.ok(ar.includes('⁦3 1 7⁩'), 'digits wrapped in LRI..PDI so bidi cannot reverse them');
    assert.ok(ar.endsWith('رقم واحد صحيح وفي المكان الصحيح، ورقمان صحيحان ولكن في المكان الخطأ.'));
  });

  test('all positions, all parities, all compares, all even counts are clean and distinct per language', () => {
    for (const lang of LANGS) {
      const texts = [];
      for (let pos = 0; pos < 5; pos++) for (const parity of ['even', 'odd']) texts.push(clueText({ kind: 'parity', pos, parity }, lang));
      for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) if (a !== b) for (const rel of ['gt', 'lt']) texts.push(clueText({ kind: 'compare', a, b, rel }, lang));
      for (let v = 0; v <= 5; v++) texts.push(clueText({ kind: 'evenCount', value: v }, lang));
      for (let v = 0; v <= 45; v++) texts.push(clueText({ kind: 'sum', value: v }, lang));
      texts.forEach((s, i) => assertClean(s, `${lang}#${i}`));
      assert.equal(new Set(texts).size, texts.length, `${lang}: duplicate clue sentences`);
    }
  });

  test('every clue of generated puzzles (all difficulties, 100 seeds each) renders clean in both languages', () => {
    for (const difficulty of DIFFICULTY_ORDER) {
      for (let i = 0; i < 100; i++) {
        const p = generatePuzzle({ difficulty, seed: seedAt(i) });
        for (const c of p.clues) {
          for (const lang of LANGS) assertClean(clueText(c, lang), `${p.id} ${c.kind} ${lang}`);
        }
        // sentences within one puzzle are pairwise distinct per language
        for (const lang of LANGS) {
          const ss = p.clues.map((c) => clueText(c, lang));
          assert.equal(new Set(ss).size, ss.length, `${p.id} ${lang}`);
        }
      }
    }
  });

  test('defaults to the current language and rejects unknown kinds / bad positions', () => {
    setLang('ar');
    assert.equal(clueText({ kind: 'sum', value: 3 }), 'مجموع الأرقام يساوي 3.');
    setLang('en');
    assert.equal(clueText({ kind: 'sum', value: 3 }), 'The digits add up to 3.');
    assert.throws(() => clueText({ kind: 'nope' }, 'en'), TypeError);
    assert.throws(() => clueText({ kind: 'parity', pos: 10, parity: 'even' }, 'en'), RangeError);
    assert.throws(() => clueText({ kind: 'feedback', guess: 'abc', bulls: 0, cows: 0 }, 'en'), TypeError);
  });
});

describe('catalog integrity', () => {
  const placeholders = (v) => {
    const forms = typeof v === 'string' ? [v] : Object.values(v);
    return [...new Set(forms.flatMap((s) => [...s.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1])))].sort();
  };

  test('en and ar define exactly the same keys with the same placeholders', () => {
    assert.deepEqual(Object.keys(catalogs.ar).sort(), Object.keys(catalogs.en).sort());
    for (const key of Object.keys(catalogs.en)) {
      assert.deepEqual(placeholders(catalogs.ar[key]), placeholders(catalogs.en[key]), key);
    }
  });

  test('plural entries provide the forms their language can select', () => {
    for (const key of Object.keys(catalogs.en)) {
      const en = catalogs.en[key];
      const ar = catalogs.ar[key];
      assert.equal(typeof en, typeof ar, `${key}: both strings or both plural objects`);
      if (typeof en === 'object') {
        assert.ok('one' in en && 'other' in en, `${key} en needs one/other`);
        for (const f of ['one', 'two', 'few', 'many', 'other']) assert.ok(f in ar, `${key} ar needs ${f}`);
      }
    }
  });

  test('every message is a non-empty string or an object of non-empty strings', () => {
    for (const lang of LANGS) {
      for (const [k, v] of Object.entries(catalogs[lang])) {
        const forms = typeof v === 'string' ? [v] : Object.values(v);
        assert.ok(forms.length > 0 && forms.every((s) => typeof s === 'string' && s.trim()), `${lang}.${k}`);
      }
    }
  });
});

describe('infrastructure', () => {
  test('pluralCategory matches Intl.PluralRules for 0..1000 (en and ar)', () => {
    for (const lang of LANGS) {
      const pr = new Intl.PluralRules(lang);
      for (let n = 0; n <= 1000; n++) assert.equal(pluralCategory(lang, n), pr.select(n), `${lang} ${n}`);
    }
  });

  test('plural(): exact match first, then category, then other', () => {
    const forms = { '=0': 'none', one: 'a', two: 'b', other: 'c' };
    assert.equal(plural('ar', 0, forms), 'none');
    assert.equal(plural('ar', 1, forms), 'a');
    assert.equal(plural('ar', 2, forms), 'b');
    assert.equal(plural('ar', 7, forms), 'c'); // 'few' missing -> other
    assert.equal(plural('en', 2, forms), 'c'); // en has no 'two' category
  });

  test('resolveLang / setLang / getLang / dirFor / onLangChange', () => {
    assert.deepEqual([...SUPPORTED], ['en', 'ar']);
    assert.equal(resolveLang('ar-IQ'), 'ar');
    assert.equal(resolveLang('AR'), 'ar');
    assert.equal(resolveLang('ar_EG'), 'ar');
    assert.equal(resolveLang('en-GB'), 'en');
    assert.equal(resolveLang('fr'), 'en');
    assert.equal(resolveLang(undefined), 'en');
    assert.equal(dirFor('ar'), 'rtl');
    assert.equal(dirFor('en'), 'ltr');
    assert.equal(getLang(), 'en');
    const seen = [];
    const off = onLangChange((l) => seen.push(l));
    onLangChange(() => {
      throw new Error('subscriber bug');
    });
    assert.equal(setLang('ar'), true);
    assert.equal(getLang(), 'ar');
    assert.equal(setLang('ar'), true);
    assert.equal(setLang('fr'), false);
    assert.equal(getLang(), 'ar', 'unsupported language leaves the current one untouched');
    assert.equal(setLang('en'), true);
    off();
    setLang('ar');
    setLang('en');
    assert.deepEqual(seen, ['ar', 'en'], 'notified once per real change; throwing subscriber is isolated; unsubscribe works');
  });

  test('t(): lookup, interpolation, fallbacks', () => {
    assert.equal(tFor('en', 'clue.sum', { value: 9 }), 'The digits add up to 9.');
    assert.equal(tFor('ar', 'clue.sum', { value: 9 }), 'مجموع الأرقام يساوي 9.');
    assert.equal(t('definitely.missing.key'), 'definitely.missing.key');
    assert.equal(t('clue.sum'), 'The digits add up to {value}.', 'a missing param stays visible instead of vanishing');
    assert.equal(t('clue.sum', { value: 0 }), 'The digits add up to 0.');
    assert.equal(t('constructor'), 'constructor', 'prototype keys are not catalog keys');
    assert.equal(t('__proto__'), '__proto__');
    assert.equal(tFor('en', 'clue.pos.1', { unused: 'x' }), 'first');
    assert.equal(tFor('xx', 'clue.pos.1'), 'first', 'unknown language falls back to English');
  });

  test('a UI-style key can be appended to the catalogs without touching the infrastructure', () => {
    catalogs.en['ui.test.hello'] = 'Hello {name}';
    catalogs.ar['ui.test.hello'] = 'مرحبًا {name}';
    try {
      assert.equal(tFor('en', 'ui.test.hello', { name: 'Sam' }), 'Hello Sam');
      assert.equal(tFor('ar', 'ui.test.hello', { name: 'سام' }), 'مرحبًا سام');
    } finally {
      delete catalogs.en['ui.test.hello'];
      delete catalogs.ar['ui.test.hello'];
    }
  });

  test('formatNumber: Latin digits, grouped, total over junk', () => {
    for (const lang of LANGS) {
      assert.equal(formatNumber(0, lang), '0');
      assert.equal(formatNumber(999, lang), '999');
      assert.match(formatNumber(1234567, lang), /^1.234.567$/);
      assert.ok(/^[0-9,.٬٫  -]+$/.test(formatNumber(-1234567, lang)) || formatNumber(-1234567, lang).includes('1'));
      assert.ok(!/[٠-٩۰-۹]/.test(formatNumber(1234567, lang)), 'no Arabic-Indic digits');
      for (const junk of [NaN, Infinity, undefined, 'x']) assert.equal(formatNumber(junk, lang), '–');
    }
  });

  test('formatDuration: m:ss, clamped', () => {
    const rows = [[0, '0:00'], [5, '0:05'], [59.9, '0:59'], [60, '1:00'], [185, '3:05'], [180, '3:00'], [-5, '0:00'], [NaN, '0:00'], [Infinity, '0:00'], [3600, '60:00']];
    for (const [s, want] of rows) assert.equal(formatDuration(s), want, String(s));
  });
});
