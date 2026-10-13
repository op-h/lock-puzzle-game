// Client for the game's own small API (ADR 0007: a Cloudflare Worker + D1; worker/src/handler.js is the server).
// Plain fetch, no SDK. Every call resolves to a Result and none ever throws, so the UI layer needs no try/catch
// around the network.
//
// Deliberately silent: the request body carries the save and the id (a capability), so nothing in here logs.
// Failure reasons are small enums, never error text.

/**
 * @typedef {'offline'|'denied'|'notfound'|'conflict'|'quota'|'toolarge'|'error'} Reason
 * @typedef {{ok: true, data: any} | {ok: false, reason: Reason, status?: number}} Result
 *
 * @typedef {Object} RemoteOptions
 * @property {string} url base URL of the Worker, no trailing slash needed
 * @property {boolean} [enabled] false makes every call report 'offline' without touching the network
 * @property {typeof fetch} [fetch] injectable; defaults to the global at call time
 * @property {number} [timeoutMs] per-request budget, default 8000
 *
 * @typedef {{name: string, total: number, blood: number, solved: number, bestRun: number, updatedAt: number}} BoardRow
 */

const ID_RE = /^[0-9a-f]{64}$/;
/** Same cap the server enforces (worker/src/handler.js), so an oversized save fails locally with a clear reason. */
export const MAX_SAVE_CHARS = 850000;
export const BOARD_LIMIT_MAX = 50;

/** @param {Reason} reason @param {number} [status] @returns {Result} */
const fail = (reason, status) => (status === undefined ? { ok: false, reason } : { ok: false, reason, status });

/**
 * @param {number} status HTTP status
 * @returns {Reason}
 */
export function reasonFor(status) {
  if (status === 404) return 'notfound';
  if (status === 401 || status === 403) return 'denied';
  if (status === 409) return 'conflict';
  if (status === 413) return 'toolarge';
  if (status === 429) return 'quota';
  // 5xx (Worker or D1 unavailable, daily free quota exhausted) is transient: retrying later is the right response.
  if (status >= 500) return 'offline';
  return 'error';
}

/** @param {RemoteOptions} opts */
export function createRemote(opts) {
  const { timeoutMs = 8000 } = opts;
  const base = String(opts.url || '').replace(/\/+$/, '');
  const enabled = opts.enabled !== false && /^https?:\/\//.test(base);

  /**
   * @param {string} path e.g. "/player/get"
   * @param {unknown} body
   * @returns {Promise<Result>}
   */
  async function call(path, body) {
    if (!enabled) return fail('offline');
    const doFetch = opts.fetch || (typeof globalThis.fetch === 'function' ? (/** @type {any} */ u, /** @type {any} */ i) => globalThis.fetch(u, i) : null);
    if (!doFetch) return fail('offline');

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
        // text/plain keeps this a CORS "simple" request: no preflight round trip before every call. The server
        // parses the body as JSON regardless of the declared type.
        /** @type {RequestInit} */
        const init = { method: 'POST', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) };
        if (ctrl) init.signal = ctrl.signal;
        const res = await doFetch(base + path, init);
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
      return fail(reasonFor(status), status);
    } catch {
      return fail('offline');
    } finally {
      clearTimeout(timer);
    }
  }

  /** @param {string} id */
  const validId = (id) => typeof id === 'string' && ID_RE.test(id);

  /** @param {string} path @param {Record<string, unknown>} body */
  async function writePlayer(path, body) {
    if (!validId(/** @type {string} */ (body.id)) || typeof body.save !== 'string') return fail('error');
    if (body.save.length > MAX_SAVE_CHARS) return fail('toolarge');
    const r = await call(path, body);
    return r.ok ? { ok: true, data: { updateTime: String(r.data && r.data.updateTime) } } : r;
  }

  return {
    enabled,

    /** @param {string} id @returns {Promise<Result>} data: {v, save, updateTime} */
    async getPlayer(id) {
      if (!validId(id)) return fail('error');
      // A missing player is a normal 200 {found:false}, not a 404: browsers print every 404 as a console ERROR,
      // even for an existence probe the app expects (sign-up id collision check, wrong-code sign-in).
      const r = await call('/player/get', { id });
      if (!r.ok) return r;
      const d = r.data;
      if (!d || d.found !== true) return fail('notfound', 404);
      return { ok: true, data: { v: Number(d.v) || 0, save: typeof d.save === 'string' ? d.save : '', updateTime: String(d.updateTime || '') } };
    },

    /** Create-only: the server refuses with 'conflict' if the id exists, so a concurrent create loses. */
    createPlayer(/** @type {string} */ id, /** @type {string} */ saveJson) {
      return writePlayer('/player/create', { id, save: saveJson });
    },

    /** Optimistic write: fails with 'conflict' if anyone updated the save since `updateTime`. */
    updatePlayer(/** @type {string} */ id, /** @type {string} */ saveJson, /** @type {string} */ updateTime) {
      if (!updateTime) return Promise.resolve(fail('error'));
      return writePlayer('/player/update', { id, save: saveJson, updateTime });
    },

    /** Upsert of a public leaderboard row. @param {string} bid @param {BoardRow} row @returns {Promise<Result>} */
    async putBoard(bid, row) {
      if (!validId(bid)) return fail('error');
      const clean = { name: row.name, total: row.total, blood: row.blood, solved: row.solved, bestRun: row.bestRun, updatedAt: row.updatedAt };
      return call('/board/put', { bid, row: clean });
    },

    /**
     * @param {{orderBy?: 'total'|'bestRun', limit?: number}} [q]
     * @returns {Promise<Result>} data: Array<BoardRow & {bid: string}>
     */
    async listBoard(q = {}) {
      const orderBy = q.orderBy === 'bestRun' ? 'bestRun' : 'total';
      // The server rejects limit > 50, so clamp here rather than fail there.
      const limit = Math.max(1, Math.min(BOARD_LIMIT_MAX, Math.floor(Number(q.limit) || 20)));
      const r = await call('/board/list', { orderBy, limit });
      if (!r.ok) return r;
      const items = r.data && Array.isArray(r.data.rows) ? r.data.rows : [];
      const rows = [];
      for (const f of items) {
        if (!f || typeof f.name !== 'string') continue;
        rows.push({
          bid: typeof f.bid === 'string' ? f.bid : '',
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
