// The whole server API as a pure function of (Request, store). No Cloudflare types in here: the Worker entry
// supplies a D1-backed store, the unit and e2e tests supply an in-memory one, so the tests run THIS validation.
//
// Threat model (ADR 0007, carried over from ADR 0002): no accounts, no sessions. A save's id is
// SHA-256(name + code), so possession of the id is the credential. This server therefore (1) never lists or
// deletes players, (2) bounds every write, (3) never echoes an error body that could leak what exists.
//
// Every endpoint is POST + JSON and answers 200 for "not found": a 404 would be printed as a console error by
// browsers for an existence probe the app performs on purpose (sign-up collision check, wrong-code sign-in).

export const MAX_SAVE_CHARS = 850000; // under the 1 MB D1 row comfort zone, same cap the client has always used
export const MAX_BODY_BYTES = 900000;
export const BOARD_LIMIT_MAX = 50;

const ID_RE = /^[0-9a-f]{64}$/;
const ROW_MAX = { total: 1e8, blood: 1e8, solved: 1e6, bestRun: 1e8, updatedAt: 1e14 };
const ROW_KEYS = ['name', 'total', 'blood', 'solved', 'bestRun', 'updatedAt'];

/**
 * @typedef {{name: string, total: number, blood: number, solved: number, bestRun: number, updatedAt: number}} BoardRow
 * @typedef {Object} Store
 * @property {(id: string) => Promise<{v: number, save: string, rev: number} | null>} getPlayer
 * @property {(id: string, save: string) => Promise<number | null>} createPlayer rev of the new row, null if it exists
 * @property {(id: string, save: string, rev: number) => Promise<number | null>} updatePlayer new rev, null if rev is stale
 * @property {(bid: string, row: BoardRow) => Promise<void>} putBoard
 * @property {(orderBy: 'total'|'bestRun', limit: number) => Promise<Array<BoardRow & {bid: string}>>} listBoard
 */

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

/** Codes the client maps to its Reason enum (remote.js reasonFor). */
const bad = (status, error, headers) => json(status, { error }, headers);

const isInt = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;
const utf8Len = (s) => new TextEncoder().encode(s).length;

/** @param {unknown} row @returns {BoardRow | null} the row with exactly the known keys, or null when invalid */
export function cleanRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const keys = Object.keys(row).sort().join(',');
  if (keys !== [...ROW_KEYS].sort().join(',')) return null;
  const r = /** @type {any} */ (row);
  if (typeof r.name !== 'string' || r.name.length < 1 || utf8Len(r.name) > 96) return null;
  for (const [k, max] of Object.entries(ROW_MAX)) if (!isInt(r[k], max)) return null;
  return { name: r.name, total: r.total, blood: r.blood, solved: r.solved, bestRun: r.bestRun, updatedAt: r.updatedAt };
}

/**
 * @param {Request} req
 * @param {Store} store
 * @param {{origins?: (origin: string) => boolean}} [opts] origins: which browser origins get CORS headers
 */
export async function handle(req, store, opts = {}) {
  const origin = req.headers.get('Origin');
  // CORS is a browser courtesy, not access control (curl ignores it). Echoing only known origins keeps other
  // sites' scripts from reading answers in a victim's browser.
  const allowed = origin && opts.origins ? opts.origins(origin) : false;
  const cors = allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' },
    });
  }
  if (req.method !== 'POST') return bad(405, 'method', cors);
  if (origin && !allowed) return bad(403, 'origin', cors);

  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  const declared = Number(req.headers.get('Content-Length'));
  if (declared > MAX_BODY_BYTES) return bad(413, 'toolarge', cors);

  let body;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return bad(413, 'toolarge', cors);
    body = JSON.parse(text);
  } catch {
    return bad(400, 'json', cors);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad(400, 'json', cors);

  try {
    switch (path) {
      case '/player/get': {
        if (!ID_RE.test(body.id)) return bad(400, 'id', cors);
        const p = await store.getPlayer(body.id);
        return json(200, p ? { found: true, v: p.v, save: p.save, updateTime: String(p.rev) } : { found: false }, cors);
      }
      case '/player/create':
      case '/player/update': {
        const isUpdate = path === '/player/update';
        if (!ID_RE.test(body.id) || typeof body.save !== 'string') return bad(400, 'shape', cors);
        if (body.save.length > MAX_SAVE_CHARS) return bad(413, 'toolarge', cors);
        if (!isUpdate) {
          const rev = await store.createPlayer(body.id, body.save);
          return rev === null ? bad(409, 'conflict', cors) : json(200, { updateTime: String(rev) }, cors);
        }
        if (typeof body.updateTime !== 'string' || !/^[0-9]{1,15}$/.test(body.updateTime)) return bad(400, 'shape', cors);
        const rev = await store.updatePlayer(body.id, body.save, Number(body.updateTime));
        return rev === null ? bad(409, 'conflict', cors) : json(200, { updateTime: String(rev) }, cors);
      }
      case '/board/put': {
        const row = cleanRow(body.row);
        if (!ID_RE.test(body.bid) || !row) return bad(400, 'shape', cors);
        await store.putBoard(body.bid, row);
        return json(200, { ok: true }, cors);
      }
      case '/board/list': {
        const orderBy = body.orderBy === 'bestRun' ? 'bestRun' : 'total';
        const limit = Number.isInteger(body.limit) ? body.limit : 20;
        if (limit < 1 || limit > BOARD_LIMIT_MAX) return bad(400, 'limit', cors);
        return json(200, { rows: await store.listBoard(orderBy, limit) }, cors);
      }
      default:
        return bad(404, 'route', cors);
    }
  } catch {
    // Never forward store errors: they can carry SQL text or ids.
    return bad(503, 'unavailable', cors);
  }
}
