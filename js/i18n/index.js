// i18n core: catalog lookup, interpolation, plural selection, number formatting and clue text.
// DOM-free on purpose: setting <html lang/dir> is the UI layer's job (it can use dirFor).


/** @typedef {'en'|'ar'} Lang */
/** @typedef {string | Record<string, string>} Message */

// Catalogs are loaded on demand (loadLang), one per language: the other one is dead weight on the first load.
// Until a catalog arrives lookups return the key, so main.js awaits loadLang before the first render.
const CATALOGS = {};

const LOADERS = { en: () => import('./en.js'), ar: () => import('./ar.js') };

/**
 * Make a language's catalog available. Await before setLang.
 */
export async function loadLang(lang) {
  if (CATALOGS[lang]) return true;
  if (!Object.hasOwn(LOADERS, lang)) return false;
  try {
    CATALOGS[lang] = (await LOADERS[lang]()).default;
    return true;
  } catch {
    return false;
  }
}

export const SUPPORTED = Object.freeze(['en', 'ar']);

/** Exposed read-only-by-convention for tests (key/placeholder parity). */
export const catalogs = /** @type {Record<Lang, Record<string, Message>>} */ (CATALOGS);

let current = /** @type {Lang} */ ('en');
const listeners = new Set();

/**
 * Map any BCP-47-ish tag (navigator.language) to a supported language; unknown -> 'en'.
 */
export function resolveLang(input) {
  const primary = String(input ?? '').toLowerCase().split(/[-_]/)[0];
  return primary === 'ar' ? 'ar' : 'en';
}

export function getLang() {
  return current;
}

/**
 * Strict on purpose: pass resolveLang(x) if the input is untrusted.
 */
export function setLang(lang) {
  if (!SUPPORTED.includes(lang) || !CATALOGS[lang]) return false;
  if (lang !== current) {
    current = lang;
    for (const fn of Array.from(listeners)) {
      try {
        fn(lang);
      } catch {
        // One broken subscriber must not stop the language switch reaching the others.
      }
    }
  }
  return true;
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function dirFor(lang) {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/**
 * CLDR plural category. Implemented by hand rather than via Intl.PluralRules so the result cannot
 * differ between ICU builds; tests cross-check it against Intl where available.
 */
export function pluralCategory(lang, n) {
  if (lang === 'ar') {
    if (n === 0) return 'zero';
    if (n === 1) return 'one';
    if (n === 2) return 'two';
    const m = n % 100;
    if (Number.isInteger(n) && m >= 3 && m <= 10) return 'few';
    if (Number.isInteger(n) && m >= 11 && m <= 99) return 'many';
    return 'other';
  }
  return n === 1 ? 'one' : 'other';
}

/**
 * Pick a form from a plural-forms object: '=N' exact, then CLDR category, then 'other'.
 */
export function plural(lang, n, forms) {
  const exact = `=${n}`;
  if (Object.hasOwn(forms, exact)) return forms[exact];
  const cat = pluralCategory(lang, n);
  if (Object.hasOwn(forms, cat)) return forms[cat];
  return forms.other;
}

const nfCache = new Map();

/**
 * Locale-grouped number with Latin digits in both languages (the dials are Latin digits, and mixing
 * numeral systems inside one score line is hard to read). Non-finite input renders as an en dash.
 */
export function formatNumber(n, lang = current) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '–';
  try {
    let nf = nfCache.get(lang);
    if (!nf) {
      nf = new Intl.NumberFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', { maximumFractionDigits: 0 });
      nfCache.set(lang, nf);
    }
    return nf.format(v);
  } catch {
    return String(Math.round(v));
  }
}

/**
 * m:ss for timers; clamps negatives to 0. Latin digits so it never reorders inside RTL text.
 */
export function formatDuration(secs) {
  const total = Number.isFinite(Number(secs)) ? Math.max(0, Math.floor(Number(secs))) : 0;
  const s = total % 60;
  return `${Math.floor(total / 60)}:${s < 10 ? '0' : ''}${s}`;
}

function lookup(lang, key) {
  const own = CATALOGS[lang];
  if (own && Object.hasOwn(own, key)) return own[key];
  // English is the safety net (when loaded) so a missing translation shows words, not a key.
  const en = CATALOGS.en;
  if (en && Object.hasOwn(en, key)) return en[key];
  return undefined;
}

/**
 * Translate in an explicit language. `{name}` placeholders are filled from `params`; a missing param
 * is left visible as `{name}` (a loud, non-crashing bug). `params.count` also selects the plural form
 * and is rendered with formatNumber. An unknown key returns the key itself.
 */
export function tFor(lang, key, params) {
  let msg = lookup(lang, key);
  if (msg === undefined) return key;
  const p = params || {};
  if (typeof msg === 'object') {
    const n = Object.hasOwn(p, 'count') ? Number(p.count) : NaN;
    msg = plural(lang, n, msg);
    if (msg === undefined) return key;
  }
  return msg.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name) => {
    if (!Object.hasOwn(p, name)) return whole;
    return name === 'count' && typeof p[name] === 'number' ? formatNumber(p[name], lang) : String(p[name]);
  });
}

/**
 * Translate in the current language.
 */
export function t(key, params) {
  return tFor(current, key, params);
}

// ---- Clue text ----

const isCount = (x) => Number.isInteger(x) && x >= 0;

/**
 * Sentence describing a feedback result, composed from the two counts so every (bulls, cows)
 * combination is covered by construction, including mixed ones like (1, 2).
 */
export function feedbackText(bulls, cows, lang = current) {
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
export function clueText(clue, lang = current) {
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
