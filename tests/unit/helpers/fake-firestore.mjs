// In-process fake of the Firestore REST surface the app uses, exposed as an injectable `fetch`.
// It mirrors firestore.rules (shape and ranges) so a client bug that real Firestore would reject
// fails here too. It never opens a socket.

export const PROJECT = 'test-project';
export const API_KEY = 'test-key';

const ID_RE = /^[0-9a-f]{64}$/;

/** @param {number} n */
function stamp(n) {
  // Real Firestore updateTime has microsecond precision; a counter in the fraction is monotonic and unique.
  return `2026-01-01T00:00:00.${String(n).padStart(6, '0')}Z`;
}

function json(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body,
  };
}

const err = (status, code) => json(status, { error: { code: status, status: code, message: code } });

/** Mirrors validPlayer() in firestore.rules. */
function playerAllowed(fields, existing) {
  const keys = Object.keys(fields || {}).sort().join(',');
  if (keys !== 'save,v') return false;
  const v = fields.v;
  const s = fields.save;
  if (!v || typeof v.integerValue !== 'string' || v.integerValue !== '1') return false;
  if (!s || typeof s.stringValue !== 'string' || s.stringValue.length >= 900000) return false;
  if (existing && existing.fields.v.integerValue !== v.integerValue) return false;
  return true;
}

const ROW_KEYS = ['bestRun', 'blood', 'name', 'solved', 'total', 'updatedAt'];
const ROW_MAX = { total: 1e8, blood: 1e8, solved: 1e6, bestRun: 1e8, updatedAt: 1e14 };

/** Mirrors validRow() in firestore.rules. */
function rowAllowed(fields) {
  if (Object.keys(fields || {}).sort().join(',') !== ROW_KEYS.join(',')) return false;
  const n = fields.name;
  if (!n || typeof n.stringValue !== 'string' || n.stringValue.length < 1 || Buffer.byteLength(n.stringValue) > 96) return false; // rules: size() <= 96 (chars or bytes)
  for (const [k, max] of Object.entries(ROW_MAX)) {
    const f = fields[k];
    if (!f || typeof f.integerValue !== 'string' || !/^-?\d+$/.test(f.integerValue)) return false;
    const x = Number(f.integerValue);
    if (x < 0 || x > max) return false;
  }
  return true;
}

/**
 * @param {{projectId?: string, apiKey?: string}} [opts]
 */
export function createFakeFirestore(opts = {}) {
  const projectId = opts.projectId || PROJECT;
  const apiKey = opts.apiKey || API_KEY;
  const root = `/v1/projects/${projectId}/databases/(default)/documents`;
  /** @type {Map<string, {name: string, fields: any, createTime: string, updateTime: string}>} */
  const docs = new Map();
  let clock = 0;

  const backend = {
    docs,
    /** How many 404 responses were sent. Existence probes must never add to it (browsers log each 404 as a console error). */
    notFound: 0,
    /** every request that reached the server: {method, path, query} */
    log: [],
    /** global fault switches, applied to every device */
    faults: { deny: false, quota: false, hang: false, server5xx: false },
    /** statuses to return (and NOT apply) for the next N write requests */
    failWrites: [],
    /** runs just before a write is evaluated, to simulate another device writing in between */
    beforeWrite: null,

    /** @param {string} path e.g. "players/<id>" */
    get(path) {
      return docs.get(path);
    },

    /** Server-side write that bypasses rules and preconditions (simulates "another device got there first"). */
    put(path, fields) {
      clock++;
      const existing = docs.get(path);
      docs.set(path, {
        name: `projects/${projectId}/databases/(default)/documents/${path}`,
        fields,
        createTime: existing ? existing.createTime : stamp(clock),
        updateTime: stamp(clock),
      });
    },

    /** A client with its own network switch, so two "devices" can differ in connectivity. */
    device() {
      const dev = {
        offline: false,
        /** @param {string} url @param {RequestInit} [init] */
        fetch: async (url, init = {}) => {
          if (dev.offline) throw new TypeError('Failed to fetch');
          const res = await handle(url, init);
          if (res.status === 404) backend.notFound++;
          return res;
        },
      };
      return dev;
    },
  };

  function handle(urlStr, init) {
    const url = new URL(urlStr);
    const method = (init.method || 'GET').toUpperCase();
    const path = decodeURIComponent(url.pathname);
    backend.log.push({ method, path, query: Object.fromEntries(url.searchParams) });

    if (backend.faults.hang) {
      return new Promise((_, reject) => {
        if (init.signal) init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    if (url.origin !== 'https://firestore.googleapis.com') return Promise.resolve(err(400, 'INVALID_ARGUMENT'));
    if (url.searchParams.get('key') !== apiKey) return Promise.resolve(err(403, 'PERMISSION_DENIED'));
    if (backend.faults.deny) return Promise.resolve(err(403, 'PERMISSION_DENIED'));
    if (backend.faults.quota) return Promise.resolve(err(429, 'RESOURCE_EXHAUSTED'));
    if (backend.faults.server5xx) return Promise.resolve(err(503, 'UNAVAILABLE'));

    if (!path.startsWith(root)) return Promise.resolve(err(404, 'NOT_FOUND'));
    const rel = path.slice(root.length);

    if (method === 'POST' && rel === ':runQuery') return Promise.resolve(runQuery(JSON.parse(init.body)));
    if (method === 'POST' && rel === ':batchGet') return Promise.resolve(batchGet(JSON.parse(init.body)));

    const m = /^\/(players|board)\/([^/]+)$/.exec(rel);
    if (!m) return Promise.resolve(err(404, 'NOT_FOUND'));
    const [, coll, id] = m;
    if (!ID_RE.test(id)) return Promise.resolve(err(400, 'INVALID_ARGUMENT'));
    const key = `${coll}/${id}`;

    if (method === 'GET') {
      const d = docs.get(key);
      return Promise.resolve(d ? json(200, d) : err(404, 'NOT_FOUND'));
    }
    if (method === 'PATCH') return Promise.resolve(write(coll, key, url, JSON.parse(init.body)));
    return Promise.resolve(err(405, 'METHOD_NOT_ALLOWED'));
  }

  function write(coll, key, url, body) {
    if (backend.beforeWrite) {
      const h = backend.beforeWrite;
      backend.beforeWrite = null; // one-shot
      h();
    }
    const next = backend.failWrites.shift();
    if (next) return err(next.status, next.code);

    const existing = docs.get(key);
    const mustNotExist = url.searchParams.get('currentDocument.exists') === 'false';
    const mustMatch = url.searchParams.get('currentDocument.updateTime');
    if (mustNotExist && existing) return err(409, 'ALREADY_EXISTS');
    // Real Firestore answers a stale updateTime with 400 FAILED_PRECONDITION (remote.js must treat it as a conflict).
    if (mustMatch && (!existing || existing.updateTime !== mustMatch)) return err(400, 'FAILED_PRECONDITION');

    const fields = body && body.fields;
    const ok = coll === 'players' ? playerAllowed(fields, existing) : rowAllowed(fields);
    if (!ok) return err(403, 'PERMISSION_DENIED');

    clock++;
    const doc = {
      name: `projects/${projectId}/databases/(default)/documents/${key}`,
      fields,
      createTime: existing ? existing.createTime : stamp(clock),
      updateTime: stamp(clock),
    };
    docs.set(key, doc);
    return json(200, doc);
  }

  /**
   * documents:batchGet. Faithful to the REST contract: 200 with one entry per requested name, `{found, readTime}` or
   * `{missing, readTime}` (NEVER a 404 for an absent document). Each name is authorised like a `get`: only players/*
   * and board/* exist in the rules, everything else is denied.
   */
  function batchGet(body) {
    const names = body && Array.isArray(body.documents) ? body.documents : null;
    if (!names || names.length === 0 || names.length > 100) return err(400, 'INVALID_ARGUMENT');
    const prefix = `projects/${projectId}/databases/(default)/documents/`;
    const readTime = stamp(clock);
    const out = [];
    for (const name of names) {
      if (typeof name !== 'string' || !name.startsWith(prefix)) return err(400, 'INVALID_ARGUMENT');
      const m = /^(players|board)\/([^/]+)$/.exec(name.slice(prefix.length));
      if (!m) return err(403, 'PERMISSION_DENIED'); // not a collection the rules allow `get` on
      if (!ID_RE.test(m[2])) return err(400, 'INVALID_ARGUMENT');
      const d = docs.get(`${m[1]}/${m[2]}`);
      out.push(d ? { found: d, readTime } : { missing: name, readTime });
    }
    return json(200, out);
  }

  function runQuery(body) {
    const q = body && body.structuredQuery;
    const coll = q && q.from && q.from[0] && q.from[0].collectionId;
    // players has no `list` rule: the whole point is that ids cannot be enumerated.
    if (coll !== 'board') return err(403, 'PERMISSION_DENIED');
    // Missing or oversized limit is denied by `request.query.limit <= 50`.
    if (typeof q.limit !== 'number' || q.limit > 50) return err(403, 'PERMISSION_DENIED');
    // ... and `request.query.offset == 0` (an unset offset counts as 0): paging past the first 50 rows is refused.
    if (q.offset !== undefined && Number(q.offset) !== 0) return err(403, 'PERMISSION_DENIED');
    const ob = (q.orderBy && q.orderBy[0]) || null;
    const field = ob ? ob.field.fieldPath : null;
    const desc = ob ? ob.direction === 'DESCENDING' : false;
    let rows = [...docs.entries()].filter(([k]) => k.startsWith('board/')).map(([, d]) => d);
    if (field) {
      rows = rows.filter((d) => d.fields[field] !== undefined); // Firestore omits docs lacking the ordered field
      const val = (d) => Number(d.fields[field].integerValue);
      rows.sort((a, b) => (desc ? val(b) - val(a) : val(a) - val(b)) || (a.name < b.name ? -1 : 1));
    }
    rows = rows.slice(0, q.limit);
    const readTime = stamp(clock);
    if (rows.length === 0) return json(200, [{ readTime }]);
    return json(200, rows.map((document) => ({ document, readTime })));
  }

  return backend;
}
