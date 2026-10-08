// Dev-only static server that imitates GitHub Pages project hosting, so path bugs show up as 404s here
// and not in production:
//   - files live under a BASE path (default /lock-puzzle-game/); anything outside it is a plain 404
//   - gzip (and optionally brotli) like Pages' CDN, with precompressed buffers so timing is stable
//   - cache-control: max-age=600 like Pages, plus an off switch for tests that need fresh files
//   - `.webmanifest` served as application/manifest+json, `.woff2` as font/woff2
// `python3 -m http.server` does none of this (no gzip, wrong mount point, no 404 outside the base).
// CLI: node tests/e2e/support/static-server.mjs [--root DIR] [--base /x/] [--port N] [--no-compress]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg', '.txt', '.xml']);

/**
 * @param {{root?: string, base?: string, port?: number, compress?: 'gzip'|'br'|false, cache?: boolean,
 *   headers?: Record<string,string>, allow?: (rel: string) => boolean,
 *   rewrite?: (rel: string, body: Buffer) => Buffer | null}} [o]  rewrite() lets a test serve a modified file (e.g. a new sw.js)
 * @returns {Promise<{url: string, origin: string, base: string, port: number, hits: string[], close: () => Promise<void>}>}
 */
export async function startServer(o = {}) {
  // E2E_ROOT lets CI run a spec against the staged _site/ instead of the working tree
  const root = path.resolve(o.root || process.env.E2E_ROOT || REPO);
  const base = (o.base ?? '/lock-puzzle-game/').replace(/\/?$/, '/');
  const compress = o.compress === undefined ? 'gzip' : o.compress;
  const hits = [];
  const memo = new Map();

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    hits.push(`${req.method} ${p}`);
    const bare = base.slice(0, -1);
    // Pages redirects /project to /project/ (301); mirror it so relative URLs resolve the same way.
    if (base !== '/' && p === bare) {
      res.writeHead(301, { location: base + u.search });
      return res.end();
    }
    if (!p.startsWith(base)) return notFound(res);
    let rel = p.slice(base.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) return notFound(res);
    if (o.allow && !o.allow(rel)) return notFound(res);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      return notFound(res);
    }
    if (!st.isFile()) return notFound(res);
    const ext = path.extname(abs).toLowerCase();
    const type = TYPES[ext] || 'application/octet-stream';
    const changed = o.rewrite ? o.rewrite(rel, fs.readFileSync(abs)) : null;
    const key = changed ? null : abs + ':' + st.mtimeMs;
    let ent = key ? memo.get(key) : null;
    if (!ent) {
      const raw = changed || fs.readFileSync(abs);
      ent = { raw, gz: null, br: null };
      if (COMPRESSIBLE.has(ext)) {
        ent.gz = zlib.gzipSync(raw, { level: 9 });
        ent.br = zlib.brotliCompressSync(raw);
      }
      if (key) memo.set(key, ent);
    }
    const accept = String(req.headers['accept-encoding'] || '');
    const headers = {
      'content-type': type,
      'cache-control': o.cache === false ? 'no-store' : 'max-age=600',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
      vary: 'Accept-Encoding',
      ...(o.headers || {}),
    };
    let body = ent.raw;
    if (compress === 'br' && ent.br && /\bbr\b/.test(accept)) {
      headers['content-encoding'] = 'br';
      body = ent.br;
    } else if (compress && ent.gz && /\bgzip\b/.test(accept)) {
      headers['content-encoding'] = 'gzip';
      body = ent.gz;
    }
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });

  function notFound(res) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('404 Not Found');
  }

  await new Promise((r) => server.listen(o.port || 0, '127.0.0.1', r));
  const { port } = /** @type {any} */ (server.address());
  const origin = `http://localhost:${port}`;
  return {
    url: origin + base,
    origin,
    base,
    port,
    hits,
    close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(() => r()))),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(n);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const s = await startServer({
    root: arg('--root', REPO),
    base: arg('--base', '/lock-puzzle-game/'),
    port: Number(arg('--port', 8743)),
    compress: process.argv.includes('--no-compress') ? false : 'gzip',
  });
  console.log(`serving ${arg('--root', REPO)} at ${s.url}`);
}
