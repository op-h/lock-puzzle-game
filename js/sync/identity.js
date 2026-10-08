// Account identity (ADR 0002): a (name, 6-digit code) pair is a capability. The save-document id is
// a hash of both, so knowing them lets you compute the id, and nothing else lets you find it.

export const NAME_MAX = 20;
export const CODE_LENGTH = 6;

// Rejected outright: control characters, line/paragraph separators and lone surrogates. They break JSON/UTF-8
// round trips and have no legitimate use in a nickname.
const FORBIDDEN = /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}]/u;

// Stripped silently (from the display name too): every format character (zero-width space/joiners, bidi
// controls U+202A-202E and U+2066-2069, tag characters), variation selectors, and the "blank" letters
// (Hangul fillers, braille blank). They are invisible, so they would let two visually identical names be
// different accounts, or let a leaderboard row spoof another name.
const INVISIBLE = /[\p{Cf}\u115F\u1160\u2800\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;

/**
 * @typedef {'not_string'|'empty'|'invisible'|'too_long'|'control_chars'} NameReason
 * @typedef {{ok: true, name: string, key: string} | {ok: false, reason: NameReason}} NameCheck
 */

const ARABIC_INDIC_DIGITS = /[\u0660-\u0669]/g;
const EASTERN_DIGITS = /[\u06F0-\u06F9]/g;
// Tatweel, harakat (U+064B-065F) and superscript alef: typography, not letters.
const ARABIC_MARKS = /[\u0640\u064B-\u065F\u0670]/g;

/**
 * The identity key: what two spellings of "the same name" must share. Locale-independent on purpose
 * (no toLocaleLowerCase). Arabic spelling variants are folded; teh marbuta vs heh are NOT (different words),
 * and Latin/Cyrillic look-alikes are NOT folded (merging across scripts would be a collision attack).
 */
function foldKey(name) {
  return name
    .toLowerCase()
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(EASTERN_DIGITS, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(ARABIC_MARKS, '')
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627') // أ إ آ ٱ -> ا
    .replace(/[\u0649\u06D0\u06CC\u064A]/g, '\u064A') // ى ې ی ي -> ي (U+06CC is the Persian yeh)
    .replace(/\u06A9/g, '\u0643'); // ک -> ك
}

/**
 * Validate a player name and produce both the display form and the identity key.
 * `name` keeps the player's letters and casing, minus invisible characters; `key` is what feeds the hash.
 * Length is counted in code points everywhere (an emoji is one character to the player).
 */
export function validateName(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'not_string' };
  // NFKC first: it folds full-width and compatibility forms, so visually identical input maps to one key.
  const composed = raw.normalize('NFKC');
  if (FORBIDDEN.test(composed)) return { ok: false, reason: 'control_chars' };
  const name = composed.replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim();
  if (name === '') return { ok: false, reason: composed.trim() === '' ? 'empty' : 'invisible' };
  if (Array.from(name).length > NAME_MAX) return { ok: false, reason: 'too_long' };
  return { ok: true, name, key: foldKey(name) };
}

export function normalizeName(raw) {
  const r = validateName(raw);
  return r.ok ? r.key : null;
}

// Largest multiple of 10^6 that fits in 2^32. Values at or above it are rejected so every code
// 000000-999999 has exactly the same number of preimages (no modulo bias).
const UNBIASED_LIMIT = 4294000000;

export function generateCode(fill) {
  const f = fill || ((buf) => globalThis.crypto.getRandomValues(buf));
  const buf = new Uint32Array(1);
  // The loop bound only exists to turn a broken (constant) RNG into an error instead of a hang.
  for (let i = 0; i < 64; i++) {
    f(buf);
    if (buf[0] < UNBIASED_LIMIT) return String(buf[0] % 1000000).padStart(CODE_LENGTH, '0');
  }
  throw new Error('rng did not produce an unbiased value');
}

async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let out = '';
  for (const b of new Uint8Array(digest)) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * Save-document id. Throws on invalid input: callers validate first, so reaching a throw is a
 * programming error rather than something to render to a player.
 */
export async function playerId(name, code) {
  const key = normalizeName(name);
  if (key === null) throw new TypeError('invalid name');
  if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) throw new TypeError('invalid code');
  return sha256Hex('lp1:' + key + ':' + code);
}

const BK_RE = /^[0-9a-f]{32}$/;

/**
 * A fresh board key: 128 random bits, stored only inside the save. Nothing public derives from the name or
 * the code, so the leaderboard cannot be used as an offline oracle for the 6-digit code.
 */
export function generateBoardKey(fill) {
  const buf = new Uint8Array(16);
  (fill || ((b) => globalThis.crypto.getRandomValues(b)))(buf);
  let out = '';
  for (const b of buf) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * Public leaderboard id: SHA-256("lp1-board:" + bk). `bk` is the random board key from the save, NOT anything
 * derived from the save id: the old H(H(name:code)) let anyone brute-force the code from a public row.
 */
export function boardId(bk) {
  if (typeof bk !== 'string' || !BK_RE.test(bk)) return Promise.reject(new TypeError('invalid board key'));
  return sha256Hex('lp1-board:' + bk);
}

export function formatCode(code) {
  const s = String(code);
  return s.length === CODE_LENGTH ? s.slice(0, 3) + ' ' + s.slice(3) : s;
}

const ARABIC_INDIC = 0x0660; // ٠-٩
const EASTERN_ARABIC = 0x06f0; // ۰-۹ (Persian/Urdu)

/**
 * Accept what a person really types or pastes: spaces, dashes, bidi marks from copied RTL text,
 * and non-ASCII digits (Arabic keyboards).
 */
export function parseCode(input) {
  if (typeof input !== 'string') return null;
  let out = '';
  // NFKC folds full-width digits; the two Arabic digit blocks are not compatibility forms, so map by hand.
  for (const ch of input.normalize('NFKC')) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (cp >= 0x30 && cp <= 0x39) out += ch;
    else if (cp >= ARABIC_INDIC && cp <= ARABIC_INDIC + 9) out += String(cp - ARABIC_INDIC);
    else if (cp >= EASTERN_ARABIC && cp <= EASTERN_ARABIC + 9) out += String(cp - EASTERN_ARABIC);
    else if (/[\s\p{Pd}\p{Cf}−]/u.test(ch)) continue; // separators and invisible format marks
    else return null;
  }
  return /^[0-9]{6}$/.test(out) ? out : null;
}
