// In-process stand-in for the game's API, exposed as an injectable `fetch`. It runs the REAL request handler
// (worker/src/handler.js) over an in-memory store, so a client bug that the live server would reject fails here
// too, and the server's validation is exercised by every sync test. It never opens a socket.
//
// docs: Map<'players/<id>' | 'board/<id>', row>. A player row is {v, save, rev} (the D1 columns); a board row is
// {name, total, blood, solved, bestRun, updatedAt}.

import { handle } from '../../../worker/src/handler.js';

export const API_URL = 'https://api.test.invalid';

function memoryStore(docs, tick) {
  return {
    async getPlayer(id) {
      const d = docs.get('players/' + id);
      return d ? { v: d.v, save: d.save, rev: d.rev } : null;
    },
    async createPlayer(id, save) {
      if (docs.has('players/' + id)) return null;
      const rev = tick();
      docs.set('players/' + id, { v: 1, save, rev });
      return rev;
    },
    async updatePlayer(id, save, rev) {
      const d = docs.get('players/' + id);
      if (!d || d.rev !== rev) return null;
      const next = tick();
      docs.set('players/' + id, { v: d.v, save, rev: next });
      return next;
    },
    async putBoard(bid, row) {
      docs.set('board/' + bid, { ...row });
    },
    async listBoard(orderBy, limit) {
      const rows = [...docs.entries()].filter(([k]) => k.startsWith('board/')).map(([k, r]) => ({ bid: k.slice(6), ...r }));
      rows.sort((a, b) => b[orderBy] - a[orderBy] || (a.bid < b.bid ? -1 : 1));
      return rows.slice(0, limit);
    },
  };
}

/** @param {{url?: string}} [opts] */
export function createFakeBackend(opts = {}) {
  const url = opts.url || API_URL;
  const origin = new URL(url).origin;
  /** @type {Map<string, any>} */
  const docs = new Map();
  let clock = 0;
  const tick = () => ++clock;
  const store = memoryStore(docs, tick);

  const backend = {
    docs,
    /** How many 404 responses were sent. Existence probes must never add to it (browsers log each 404 as a console error). */
    notFound: 0,
    /** every request that reached the server: {method, path, body} */
    log: [],
    /** global fault switches, applied to every device */
    faults: { deny: false, quota: false, hang: false, server5xx: false },
    /** {status, code} to answer (and NOT apply) for the next N write requests */
    failWrites: [],
    /** runs just before a write is evaluated, to simulate another device writing in between */
    beforeWrite: null,

    /** @param {string} path e.g. "players/<id>" */
    get(path) {
      return docs.get(path);
    },

    /** Server-side write that bypasses validation (simulates "another device got there first"). */
    put(path, data) {
      docs.set(path, path.startsWith('players/') ? { v: 1, ...data, rev: tick() } : { ...data });
    },

    /** The rows of players/ and board/ separately, for assertions. */
    ids(coll) {
      return [...docs.keys()].filter((k) => k.startsWith(coll + '/'));
    },

    /** A client with its own network switch, so two "devices" can differ in connectivity. */
    device() {
      const dev = {
        offline: false,
        /** @param {string} u @param {RequestInit} [init] */
        fetch: async (u, init = {}) => {
          if (dev.offline) throw new TypeError('Failed to fetch');
          const res = await serve(u, init);
          if (res.status === 404) backend.notFound++;
          return res;
        },
      };
      return dev;
    },
  };

  const isWrite = (p) => p === '/player/create' || p === '/player/update' || p === '/board/put';

  async function serve(u, init) {
    const parsed = new URL(u);
    const method = (init.method || 'GET').toUpperCase();
    let body;
    try {
      body = init.body ? JSON.parse(init.body) : undefined;
    } catch {
      body = undefined;
    }
    backend.log.push({ method, path: parsed.pathname, body });

    if (backend.faults.hang) {
      return new Promise((_, reject) => {
        if (init.signal) init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    const err = (status, code) => new Response(JSON.stringify({ error: code }), { status, headers: { 'Content-Type': 'application/json' } });
    if (parsed.origin !== origin) return err(400, 'route');
    if (backend.faults.deny) return err(403, 'origin');
    if (backend.faults.quota) return err(429, 'quota');
    if (backend.faults.server5xx) return err(503, 'unavailable');

    if (isWrite(parsed.pathname)) {
      if (backend.beforeWrite) {
        const h = backend.beforeWrite;
        backend.beforeWrite = null; // one-shot
        h();
      }
      const next = backend.failWrites.shift();
      if (next) return err(next.status, next.code);
    }
    const req = new Request(u, { method, body: method === 'GET' ? undefined : init.body, headers: init.headers });
    return handle(req, store, { origins: () => true });
  }

  return backend;
}
