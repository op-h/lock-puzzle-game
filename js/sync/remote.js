// Firestore REST client (ADR 0002). Plain fetch, no SDK. Every call resolves to a Result and none
// ever throws, so the UI layer needs no try/catch around the network.
//
// Deliberately silent: the URL carries the document id (a capability) and the request body can carry
// the save, so nothing in here logs. Failure reasons are small enums, never error text.

/**
 * @typedef {'offline'|'denied'|'notfound'|'conflict'|'quota'|'toolarge'|'error'} Reason
 * @typedef {{ok: true, data: any} | {ok: false, reason: Reason, status?: number}} Result
 *
 * @typedef {Object} RemoteOptions
 * @property {string} projectId
 * @property {string} apiKey Firebase Web API key (an identifier; authorization is by firestore.rules)
 * @property {boolean} [enabled] false makes every call report 'offline' without touching the network
 * @property {typeof fetch} [fetch] injectable; defaults to the global at call time
 * @property {number} [timeoutMs] per-request budget, default 8000
 * @property {string} [baseUrl] override for tests
 *
 * @typedef {{name: string, total: number, blood: number, solved: number, bestRun: number, updatedAt: number}} BoardRow
 */

const DEFAULT_BASE = 'https://firestore.googleapis.com';
const ID_RE = /^[0-9a-f]{64}$/;
/** Stay under the rule's 900 000 limit with headroom; counted in chars, which is what the rule counts. */
export const MAX_SAVE_CHARS = 850000;
export const BOARD_LIMIT_MAX = 50;

/** @param {Reason} reason @param {number} [status] @returns {Result} */
const fail = (reason, status) => (status === undefined ? { ok: false, reason } : { ok: false, reason, status });

// ---- Firestore typed values -------------------------------------------------------------------

/** @param {unknown} v @returns {Record<string, unknown>} */
export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  // integerValue is a *string* in the REST JSON mapping (int64 does not fit a JSON number).
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') {
    /** @type {Record<string, unknown>} */
    const fields = {};
    for (const [k, x] of Object.entries(v)) fields[k] = toValue(x);
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

/** @param {any} tv @returns {unknown} */
export function fromValue(tv) {
  if (!tv || typeof tv !== 'object') return null;
  if ('stringValue' in tv) return String(tv.stringValue);
  if ('integerValue' in tv) return Number(tv.integerValue);
  if ('doubleValue' in tv) return Number(tv.doubleValue);
  if ('booleanValue' in tv) return Boolean(tv.booleanValue);
  if ('timestampValue' in tv) return String(tv.timestampValue);
  if ('arrayValue' in tv) return ((tv.arrayValue && tv.arrayValue.values) || []).map(fromValue);
  if ('mapValue' in tv) return fromFields((tv.mapValue && tv.mapValue.fields) || {});
  return null;
}

/** @param {Record<string, any>} fields @returns {Record<string, unknown>} */
export function fromFields(fields) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromValue(v);
  return out;
}

// ---- Status mapping ---------------------------------------------------------------------------

/**
 * @param {number} status HTTP status
 * @param {any} body parsed JSON error body, or null
 * @param {boolean} isWrite precondition failures only mean "conflict" on writes
 * @returns {Reason}
 */
export function reasonFor(status, body, isWrite) {
  const code = body && body.error && body.error.status;
  if (status === 404 || code === 'NOT_FOUND') return 'notfound';
  if (status === 403 || status === 401 || code === 'PERMISSION_DENIED' || code === 'UNAUTHENTICATED') return 'denied';
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') return 'quota';
  if (status === 409 || status === 412 || code === 'ALREADY_EXISTS' || code === 'ABORTED') return 'conflict';
  // Real Firestore reports a failed updateTime precondition as 400 FAILED_PRECONDITION; the same
  // status on a query means a missing index, which is not a conflict.
  if (isWrite && code === 'FAILED_PRECONDITION') return 'conflict';
  // 5xx (UNAVAILABLE, INTERNAL, DEADLINE_EXCEEDED) are transient: retrying later is the right response.
  if (status >= 500) return 'offline';
  return 'error';
}

// ---- Client -----------------------------------------------------------------------------------

/** @param {RemoteOptions} opts */
export function createRemote(opts) {
  const { projectId, apiKey, timeoutMs = 8000 } = opts;
  const enabled = opts.enabled !== false && !!projectId && !!apiKey;
  const base = (opts.baseUrl || DEFAULT_BASE) + '/v1/projects/' + encodeURIComponent(projectId || '') + '/databases/(default)/documents';
  /** Resource-name prefix used inside request bodies (batchGet), as opposed to the URL. */
  const docRoot = 'projects/' + (projectId || '') + '/databases/(default)/documents';

  /**
   * @param {'GET'|'PATCH'|'POST'} method
   * @param {string} path relative to the documents root, e.g. "/players/<id>" or ":runQuery"
   * @param {Record<string, string>} query extra query params (the API key is appended here)
   * @param {unknown} body
   * @param {boolean} isWrite
   * @returns {Promise<Result>}
   */
  async function call(method, path, query, body, isWrite) {
    if (!enabled) return fail('offline');
    const doFetch = opts.fetch || (typeof globalThis.fetch === 'function' ? (/** @type {any} */ u, /** @type {any} */ i) => globalThis.fetch(u, i) : null);
    if (!doFetch) return fail('offline');

    const params = new URLSearchParams({ ...query, key: apiKey });
    const url = base + path + '?' + params.toString();
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    try {
      // Race against our own timer as well as aborting: a fetch that ignores its signal must not hang the UI.
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (ctrl) ctrl.abort();
          reject(new Error('timeout'));
        }, timeoutMs);
      });
      const exchange = (async () => {
        /** @type {RequestInit} */
        const init = { method, credentials: 'omit', cache: 'no-store' };
        if (ctrl) init.signal = ctrl.signal;
        // A Content-Type header makes the request non-simple (CORS preflight), so only send it with a body.
        if (body !== undefined) {
          init.headers = { 'Content-Type': 'application/json' };
          init.body = JSON.stringify(body);
        }
        const res = await doFetch(url, init);
        const text = await res.text();
        return { status: res.status, text };
      })();
      // If the timeout wins, the losing fetch may still reject later; swallow it to avoid an unhandled rejection.
      exchange.catch(() => {});
      const { status, text } = /** @type {{status: number, text: string}} */ (await Promise.race([exchange, timeout]));
      /** @type {any} */
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (status >= 200 && status < 300) return { ok: true, data: json };
      return fail(reasonFor(status, json, isWrite), status);
    } catch {
      return fail('offline');
    } finally {
      clearTimeout(timer);
    }
  }

  /** @param {string} id */
  const validId = (id) => typeof id === 'string' && ID_RE.test(id);

  /** @param {Record<string, unknown>} obj */
  const fieldsOf = (obj) => {
    /** @type {Record<string, unknown>} */
    const fields = {};
    for (const [k, v] of Object.entries(obj)) fields[k] = toValue(v);
    return { fields };
  };

  /** @param {any} doc */
  const playerFrom = (doc) => {
    const f = fromFields((doc && doc.fields) || {});
    return {
      v: typeof f.v === 'number' ? f.v : 0,
      save: typeof f.save === 'string' ? f.save : '',
      updateTime: doc && typeof doc.updateTime === 'string' ? doc.updateTime : '',
    };
  };

  /**
   * @param {string} id
   * @param {string} saveJson
   * @param {Record<string, string>} precondition
   * @returns {Promise<Result>}
   */
  async function writePlayer(id, saveJson, precondition) {
    if (!validId(id) || typeof saveJson !== 'string') return fail('error');
    if (saveJson.length > MAX_SAVE_CHARS) return fail('toolarge');
    // PATCH without an updateMask replaces the whole document, which is exactly what the rules validate.
    const r = await call('PATCH', '/players/' + id, precondition, fieldsOf({ v: 1, save: saveJson }), true);
    return r.ok ? { ok: true, data: { updateTime: playerFrom(r.data).updateTime } } : r;
  }

  return {
    enabled,

    /** @param {string} id @returns {Promise<Result>} data: {v, save, updateTime} */
    async getPlayer(id) {
      if (!validId(id)) return fail('error');
      // batchGet, not GET: a missing document is a normal 200 answer with a `missing` entry. A plain GET would
      // answer 404, and browsers print every 404 as a console ERROR, even for an existence probe the app expects
      // (sign-up id collision check, wrong-code sign-in). The rules evaluate batchGet per document as a `get`.
      const r = await call('POST', ':batchGet', {}, { documents: [docRoot + '/players/' + id] }, false);
      if (!r.ok) return r;
      const hit = Array.isArray(r.data) ? r.data.find((e) => e && e.found) : null;
      return hit ? { ok: true, data: playerFrom(hit.found) } : fail('notfound', 404);
    },

    /** Create-only: the exists=false precondition makes a concurrent create lose instead of overwrite. */
    createPlayer(/** @type {string} */ id, /** @type {string} */ saveJson) {
      return writePlayer(id, saveJson, { 'currentDocument.exists': 'false' });
    },

    /** Optimistic write: fails with 'conflict' if anyone updated the document since `updateTime`. */
    updatePlayer(/** @type {string} */ id, /** @type {string} */ saveJson, /** @type {string} */ updateTime) {
      if (!updateTime) return Promise.resolve(fail('error'));
      return writePlayer(id, saveJson, { 'currentDocument.updateTime': updateTime });
    },

    /** Upsert of a public leaderboard row. @param {string} bid @param {BoardRow} row @returns {Promise<Result>} */
    async putBoard(bid, row) {
      if (!validId(bid)) return fail('error');
      const clean = {
        name: row.name,
        total: row.total,
        blood: row.blood,
        solved: row.solved,
        bestRun: row.bestRun,
        updatedAt: row.updatedAt,
      };
      return call('PATCH', '/board/' + bid, {}, fieldsOf(clean), true);
    },

    /**
     * @param {{orderBy?: 'total'|'bestRun', limit?: number}} [q]
     * @returns {Promise<Result>} data: Array<BoardRow & {bid: string}>
     */
    async listBoard(q = {}) {
      const orderBy = q.orderBy === 'bestRun' ? 'bestRun' : 'total';
      // The rules reject limit > 50 (and a missing limit), so clamp here rather than fail at the server.
      const limit = Math.max(1, Math.min(BOARD_LIMIT_MAX, Math.floor(Number(q.limit) || 20)));
      const body = {
        structuredQuery: {
          from: [{ collectionId: 'board' }],
          orderBy: [{ field: { fieldPath: orderBy }, direction: 'DESCENDING' }],
          limit,
        },
      };
      const r = await call('POST', ':runQuery', {}, body, false);
      if (!r.ok) return r;
      const items = Array.isArray(r.data) ? r.data : [];
      const rows = [];
      for (const it of items) {
        const doc = it && it.document;
        if (!doc || !doc.fields) continue; // the final item of an empty result carries only readTime
        const f = fromFields(doc.fields);
        if (typeof f.name !== 'string') continue;
        const bid = typeof doc.name === 'string' ? doc.name.split('/').pop() : '';
        rows.push({
          bid,
          name: f.name,
          total: Number(f.total) || 0,
          blood: Number(f.blood) || 0,
          solved: Number(f.solved) || 0,
          bestRun: Number(f.bestRun) || 0,
          updatedAt: Number(f.updatedAt) || 0,
        });
      }
      return { ok: true, data: rows };
    },
  };
}
