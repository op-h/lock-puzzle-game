// Pure save-merging (ADR 0002, "Save model" in docs/architecture.md).
//
// Saves are append-only event logs keyed by unique ids, so a merge is a set union. Totals are never
// stored; they are derived. That makes offline play on two devices impossible to double-count and
// impossible to lose, as long as mergeSaves is commutative, associative and idempotent. Every choice
// below that looks fussy (canonical key order, total-order tie-breaks) exists to keep those laws true.

export const SAVE_VERSION = 1;

/** Fixed here, not imported from config.js: a save written today must stay readable if balance changes. */
export const DIFFICULTY_IDS = Object.freeze(['rookie', 'agent', 'hacker', 'master']);
export const MODES = Object.freeze(['c', 'b']);
export const LANGS = Object.freeze(['en', 'ar']);

// Upper bounds are sanity limits that turn corrupted or hostile numbers into dropped entries;
// they sit far above anything the scoring formula can produce.
// Legit maximum for one solve is 2400 (Master base 600 x 2.0 speed x 2 Blood); 5000 leaves headroom for rebalancing
// while stopping a forged save from minting a leaderboard-topping entry.
export const MAX_ENTRY_PTS = 5000;
const MAX_COUNT = 10000000;
const MAX_TIME = 8.64e15; // ECMAScript Date range, in ms
const MAX_ID = 64;
const MAX_NAME = 80;

/**
 * @typedef {Object} HistoryEntry
 *
 * @typedef {{id: string, t: number, solved: number, pts: number}} RunEntry
 * @typedef {{lang: 'en'|'ar', sound: boolean, at: number}} Settings
 * @typedef {{v: 1, name: string, createdAt: number, updatedAt: number, history: HistoryEntry[], runs: RunEntry[], settings: Settings, bk?: string}} Save
 */

function isInt(n, max) {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max;
}

function isId(s) {
  return typeof s === 'string' && s.length >= 1 && s.length <= MAX_ID;
}

function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Code-unit comparison: locale-independent, so every device sorts identically. */
function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Validate and canonicalise one solve. Rebuilding the object (instead of copying) drops unknown
 * fields and fixes key order, which the duplicate-id tie-break below relies on.
 */
export function sanitizeHistoryEntry(raw) {
  if (!isObject(raw)) return null;
  const { id, m, d, pts, s, w, h, t, r } = raw;
  if (!isId(id)) return null;
  if (m !== 'c' && m !== 'b') return null;
  if (typeof d !== 'string' || !DIFFICULTY_IDS.includes(d)) return null;
  if (!isInt(pts, MAX_ENTRY_PTS) || !isInt(s, MAX_COUNT) || !isInt(w, MAX_COUNT) || !isInt(t, MAX_TIME)) return null;
  if (h !== 0 && h !== 1) return null;
  const e = { id: /** @type {string} */ (id), m, d: /** @type {HistoryEntry['d']} */ (d), pts, s, w, h, t };
  if (r !== undefined && r !== null) {
    if (!isId(r)) return null;
    e.r = /** @type {string} */ (r);
  }
  return e;
}

export function sanitizeRunEntry(raw) {
  if (!isObject(raw)) return null;
  const { id, t, solved, pts } = raw;
  if (!isId(id) || !isInt(t, MAX_TIME) || !isInt(solved, MAX_COUNT) || !isInt(pts, MAX_ENTRY_PTS * MAX_COUNT)) return null;
  // A run is the sum of its solves, so its points are bounded by the same per-solve cap times its solve count.
  if (pts > MAX_ENTRY_PTS * solved) return null;
  return { id: /** @type {string} */ (id), t, solved, pts };
}

export function sanitizeSettings(raw) {
  if (!isObject(raw)) return null;
  const { lang, sound, at } = raw;
  if (typeof lang !== 'string' || !LANGS.includes(lang)) return null;
  if (typeof sound !== 'boolean' || !isInt(at, MAX_TIME)) return null;
  return { lang: /** @type {'en'|'ar'} */ (lang), sound, at };
}

function defaultSettings() {
  return { lang: 'en', sound: true, at: 0 };
}

const BK_RE = /^[0-9a-f]{32}$/;

/** Board key: 128 random bits that live only inside the save (see identity.js boardId). */
export const isBoardKey = (x) => typeof x === 'string' && BK_RE.test(x);

/**
 * Deterministic pick between board keys: the lexicographically smaller valid one. Any order-independent
 * choice keeps merge commutative/associative/idempotent; invalid or missing candidates are ignored.
 */
function pickBoardKey(...cands) {
  let best;
  for (const c of cands) if (isBoardKey(c) && (best === undefined || c < best)) best = c;
  return best;
}

/**
 * Schema version of raw save text, so a caller can refuse to overwrite a save written by a NEWER app.
 */
export function saveVersionOf(text) {
  if (typeof text !== 'string') return null;
  try {
    const raw = JSON.parse(text);
    return raw && typeof raw === 'object' && typeof raw.v === 'number' ? raw.v : null;
  } catch {
    return null;
  }
}

function validName(s) {
  return typeof s === 'string' && s.length >= 1 && s.length <= MAX_NAME && !/\p{Cc}/u.test(s);
}

/**
 * Pick one entry per id, sorted by (t, id). When two entries share an id but differ (only possible
 * through corruption or a bug), the larger canonical JSON wins: arbitrary but identical on every
 * device, which is all commutativity needs.
 * @template {{id: string, t: number}} T
 */
function union(entries) {
  const byId = new Map();
  for (const e of entries) {
    const j = JSON.stringify(e);
    const cur = byId.get(e.id);
    if (!cur || j > cur.j) byId.set(e.id, { e, j });
  }
  return [...byId.values()].map((x) => x.e).sort((a, b) => a.t - b.t || cmp(a.id, b.id));
}

/**
 * Assemble a canonical save. Both sanitising and merging go through here so that equal content
 * always serialises to equal JSON (key order included), which sync uses to detect "nothing new".
 */
function build(p) {
  const out = {
    v: SAVE_VERSION,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    history: union(p.history),
    runs: union(p.runs),
    settings: p.settings,
  };
  // Optional and last, so a save without one serialises exactly as it always did.
  if (isBoardKey(p.bk)) out.bk = /** @type {string} */ (p.bk);
  return out;
}

/**
 * Turn anything into a valid canonical save, counting what had to be thrown away. Never throws.
 * A missing createdAt becomes MAX_TIME (the identity of "earliest"), and a missing name becomes '',
 * so a damaged copy can never overwrite a healthy copy's identity fields.
 */
export function sanitizeSave(raw) {
  let dropped = 0;
  const bottom = () =>
    build({ name: '', createdAt: MAX_TIME, updatedAt: 0, history: [], runs: [], settings: defaultSettings() });
  if (raw === undefined || raw === null) return { save: bottom(), dropped };
  if (!isObject(raw)) return { save: bottom(), dropped: 1 };
  // An unknown version is not ours to interpret; treating it as empty keeps newer data safe from
  // being "repaired" by an older client, because empty merges away to nothing.
  if (raw.v !== undefined && raw.v !== SAVE_VERSION) return { save: bottom(), dropped: 1 };

  const history = [];
  if (raw.history !== undefined) {
    if (Array.isArray(raw.history)) {
      for (const x of raw.history) {
        const e = sanitizeHistoryEntry(x);
        if (e) history.push(e);
        else dropped++;
      }
    } else dropped++;
  }
  const runs = [];
  if (raw.runs !== undefined) {
    if (Array.isArray(raw.runs)) {
      for (const x of raw.runs) {
        const e = sanitizeRunEntry(x);
        if (e) runs.push(e);
        else dropped++;
      }
    } else dropped++;
  }
  let settings = defaultSettings();
  if (raw.settings !== undefined) {
    const s = sanitizeSettings(raw.settings);
    if (s) settings = s;
    else dropped++;
  }
  let name = '';
  // '' is what a damaged copy is normalised to, so it must re-sanitise cleanly rather than count as a drop.
  if (raw.name !== undefined && raw.name !== '') {
    if (validName(raw.name)) name = /** @type {string} */ (raw.name);
    else dropped++;
  }
  let createdAt = MAX_TIME;
  if (raw.createdAt !== undefined) {
    if (isInt(raw.createdAt, MAX_TIME)) createdAt = /** @type {number} */ (raw.createdAt);
    else dropped++;
  }
  let updatedAt = 0;
  if (raw.updatedAt !== undefined) {
    if (isInt(raw.updatedAt, MAX_TIME)) updatedAt = /** @type {number} */ (raw.updatedAt);
    else dropped++;
  }
  // A malformed board key is dropped silently: it is the one optional field and a missing one is always legal.
  let bk;
  if (raw.bk !== undefined) {
    if (isBoardKey(raw.bk)) bk = raw.bk;
    else dropped++;
  }
  return { save: build({ name, createdAt, updatedAt, history, runs, settings, bk }), dropped };
}

/**
 * Parse stored/remote JSON text. A failed parse is reported, not thrown.
 */
export function parseSave(text) {
  if (typeof text !== 'string') return { ok: false };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!isObject(raw)) return { ok: false };
  const r = sanitizeSave(raw);
  return { ok: true, save: r.save, dropped: r.dropped };
}

export function emptySave(name, now = Date.now()) {
  const n = validName(name) ? name : '';
  return build({ name: n, createdAt: now, updatedAt: now, history: [], runs: [], settings: defaultSettings() });
}

/**
 * Total order on (createdAt, name) so that "earliest account identity wins" is a min over a total
 * order, which is what makes it associative. An empty name always loses a tie.
 */
function identityOrder(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.name === b.name) return 0;
  if (a.name === '') return 1;
  if (b.name === '') return -1;
  return cmp(a.name, b.name);
}

const DEFAULT_SETTINGS_JSON = JSON.stringify(defaultSettings());

/**
 * Total order for settings: last writer wins by `at`. On an `at` tie the untouched default loses to
 * anything (so "no settings" is a true identity for merge), and two real values fall back to their
 * canonical JSON so every device picks the same one.
 */
function settingsOrder(a, b) {
  if (a.at !== b.at) return a.at - b.at;
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja === jb) return 0;
  if (ja === DEFAULT_SETTINGS_JSON) return -1;
  if (jb === DEFAULT_SETTINGS_JSON) return 1;
  return cmp(ja, jb);
}

/**
 * Union of two saves. Accepts anything (corrupt, missing, undefined) and never throws.
 * Commutative, associative and idempotent.
 */
export function mergeSaves(a, b) {
  const A = sanitizeSave(a);
  const B = sanitizeSave(b);
  const first = identityOrder(A.save, B.save) <= 0 ? A.save : B.save;
  const sa = A.save.settings;
  const sb = B.save.settings;
  const settings = settingsOrder(sa, sb) >= 0 ? sa : sb;
  const save = build({
    name: first.name,
    createdAt: first.createdAt,
    updatedAt: Math.max(A.save.updatedAt, B.save.updatedAt),
    history: A.save.history.concat(B.save.history),
    runs: A.save.runs.concat(B.save.runs),
    settings: { ...settings },
    bk: pickBoardKey(A.save.bk, B.save.bk),
  });
  return { save, dropped: A.dropped + B.dropped };
}

/**
 * @typedef {Object} Derived
 */

/**
 * Everything the UI shows is computed here from the event log, never stored.
 * Tolerates a partial object so a half-loaded save cannot crash a render.
 */
export function derive(save) {
  const out = { classic: 0, blood: 0, total: 0, solved: 0, bestRun: 0, byDifficulty: {} };
  for (const id of DIFFICULTY_IDS) out.byDifficulty[id] = { solved: 0, pts: 0 };
  const history = save && Array.isArray(save.history) ? save.history : [];
  for (const e of history) {
    if (!isObject(e)) continue;
    const pts = Number(e.pts) || 0;
    if (e.m === 'b') out.blood += pts;
    else out.classic += pts;
    out.solved++;
    // hasOwn, not truthiness: a hostile "d" like "constructor" must not resolve to a prototype member.
    const bucket = Object.hasOwn(out.byDifficulty, e.d) ? out.byDifficulty[e.d] : null;
    if (bucket) {
      bucket.solved++;
      bucket.pts += pts;
    }
  }
  out.total = out.classic + out.blood;
  const runs = save && Array.isArray(save.runs) ? save.runs : [];
  for (const r of runs) if (isObject(r)) out.bestRun = Math.max(out.bestRun, Number(r.pts) || 0);
  return out;
}
