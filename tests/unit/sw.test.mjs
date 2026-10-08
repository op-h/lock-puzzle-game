// The precache list is hand-maintained; this keeps it honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import vm from 'node:vm';

const ROOT = new URL('../../', import.meta.url).pathname;
const src = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const PRECACHE = new Function(`return ${/const PRECACHE = (\[[\s\S]*?\n\]);/.exec(src)[1]}`)();

function walk(dir, ext) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (name.endsWith(ext)) out.push('./' + relative(ROOT, p).split('\\').join('/'));
  }
  return out;
}

test('sw: every precached path exists on disk', () => {
  for (const p of PRECACHE) {
    const rel = p === './' ? 'index.html' : p.slice(2);
    assert.ok(existsSync(join(ROOT, rel)), `${p} is precached but missing`);
  }
  assert.equal(new Set(PRECACHE).size, PRECACHE.length, 'no duplicates');
});

test('sw: every file under js/ and css/ is precached', () => {
  const files = [...walk(join(ROOT, 'js'), '.js'), ...walk(join(ROOT, 'css'), '.css')];
  assert.ok(files.length > 0);
  for (const f of files) assert.ok(PRECACHE.includes(f), `${f} is not in PRECACHE (bump CACHE too)`);
});

test('sw: shell entries; release token and passthrough check are written so a naive replace cannot break them', () => {
  assert.ok(PRECACHE.includes('./') && PRECACHE.includes('./index.html'));
  assert.match(src, /const VERSION = '__BUILD_ID__';/, 'SENTRY replaces exactly this literal');
  assert.match(src, /const CACHE = `lp1-\$\{VERSION\}`;/);
  // The check must not contain the full token, or replacing __BUILD_ID__ would rewrite the check as well.
  const check = src.split('\n').find((l) => l.startsWith('const PASSTHROUGH'));
  assert.ok(check.includes("startsWith('__BUILD')") && !check.includes('__BUILD_ID__'), check);
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ''), /skipWaiting|clients\.claim/, 'activation is on next load by design');
  assert.equal((src.match(/__BUILD_ID__/g) || []).length >= 2, true, 'documented in the header');
});

// ---- behaviour, in a fake ServiceWorkerGlobalScope ---------------------------------------------------------

const BASE = 'https://x.test/game/';

function fakeEnv({ server }) {
  /** @type {Map<string, Map<string, {body: string}>>} */
  const store = new Map();
  const abs = (u) => new URL(typeof u === 'string' ? u : u.url, BASE + 'sw.js').href;
  const caches = {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name);
      return { put: async (k, res) => void m.set(abs(k), { body: await res.text() }), match: async (k) => (m.has(abs(k)) ? new Response(m.get(abs(k)).body) : undefined) };
    },
    keys: async () => [...store.keys()],
    delete: async (n) => store.delete(n),
  };
  const requested = [];
  const net = { offline: false };
  class Req {
    constructor(u, init = {}) {
      this.url = abs(u);
      this.method = init.method || 'GET';
      this.mode = init.mode || 'cors';
      this.cache = init.cache;
    }
  }
  const fetchFn = async (r) => {
    const req = r instanceof Req ? r : new Req(r);
    if (net.offline) throw new TypeError('Failed to fetch');
    requested.push(req.url + (req.cache === 'reload' ? ' (reload)' : ''));
    const body = server.get(req.url);
    if (body === undefined) return new Response('nope', { status: 404 });
    return new Response(body);
  };
  return { store, caches, requested, Req, fetchFn, abs, net };
}

function loadSW(env, version) {
  const listeners = {};
  const self = { addEventListener: (t, f) => (listeners[t] = f), location: { href: BASE + 'sw.js', origin: 'https://x.test' } };
  const code = version === undefined ? src : src.replace("'__BUILD_ID__'", JSON.stringify(version));
  vm.runInNewContext(code, { self, caches: env.caches, fetch: env.fetchFn, Request: env.Req, Response, URL, Error, Promise });
  return {
    install: () => {
      let p;
      listeners.install({ waitUntil: (x) => (p = x) });
      return p || Promise.resolve();
    },
    activate: () => {
      let p;
      listeners.activate({ waitUntil: (x) => (p = x) });
      return p || Promise.resolve();
    },
    /** @returns {Promise<string|undefined>} the body served, or undefined if the worker did not respond (passthrough) */
    async fetch(url, { method = 'GET', mode = 'cors' } = {}) {
      let responded;
      listeners.fetch({ request: { url: env.abs(url), method, mode }, respondWith: (p) => (responded = p) });
      if (!responded) return undefined;
      const res = await responded;
      return res instanceof Response ? res.text() : res;
    },
  };
}

const shellFiles = (tag) => new Map(PRECACHE.filter((u) => u !== './').map((u) => [new URL(u, BASE).href, `${tag}:${u}`]));

test('sw: VERSION "dev" or the unreplaced token is a pure network passthrough that keeps no caches', async () => {
  for (const v of ['dev', undefined]) {
    const env = fakeEnv({ server: shellFiles('v1') });
    await env.caches.open('lp1-stale'); // left over from an older deploy
    const sw = loadSW(env, v);
    await sw.install();
    assert.deepEqual(env.requested, [], 'install fetches nothing');
    assert.equal(await sw.fetch('./js/main.js'), undefined, 'never answers: the browser goes to the network');
    assert.equal(await sw.fetch('./', { mode: 'navigate' }), undefined);
    await sw.activate();
    assert.deepEqual(await env.caches.keys(), [], 'stale dev caches are removed');
  }
});

test('sw: install fetches EVERY precached file with cache:"reload" into lp1-<VERSION>', async () => {
  const env = fakeEnv({ server: shellFiles('v1') });
  await loadSW(env, 'abc123').install();
  assert.deepEqual(await env.caches.keys(), ['lp1-abc123']);
  const expected = PRECACHE.filter((u) => u !== './').map((u) => new URL(u, BASE).href + ' (reload)');
  assert.deepEqual([...env.requested].sort(), expected.sort());
  const c = await env.caches.open('lp1-abc123');
  for (const u of PRECACHE.filter((x) => x !== './')) assert.ok(await c.match(u), u);
});

test('sw: install is atomic. One failing file rejects the install and leaves no cache behind', async () => {
  const server = shellFiles('v1');
  server.delete(new URL('./js/ui/play.js', BASE).href);
  const env = fakeEnv({ server });
  await assert.rejects(loadSW(env, 'abc123').install(), /precache/);
  assert.deepEqual(await env.caches.keys(), []);
});

test('sw: HTML and JS come from the SAME version even after a new deploy; "./", "index.html" and the bare folder are one entry', async () => {
  const server = shellFiles('v1');
  const env = fakeEnv({ server });
  const v1 = loadSW(env, 'v1sha');
  await v1.install();
  await v1.activate();
  // a new deploy lands on the server; v1 is still the active worker
  for (const k of server.keys()) server.set(k, k.replace(BASE, 'v2:./'));
  assert.equal(await v1.fetch('./js/main.js'), 'v1:./js/main.js', 'precached files are cache-first, not revalidated');
  const html = 'v1:./index.html';
  assert.equal(await v1.fetch('./', { mode: 'navigate' }), html);
  assert.equal(await v1.fetch('./index.html', { mode: 'navigate' }), html);
  assert.equal(await v1.fetch(BASE + '?utm=x#top', { mode: 'navigate' }), html);
  assert.equal(await v1.fetch('./css/main.css'), 'v1:./css/main.css');
  // v2 installs next to v1; each serves only its own cache until v2 activates
  const v2 = loadSW(env, 'v2sha');
  await v2.install();
  assert.deepEqual((await env.caches.keys()).sort(), ['lp1-v1sha', 'lp1-v2sha']);
  assert.equal(await v1.fetch('./js/main.js'), 'v1:./js/main.js');
  assert.equal(await v2.fetch('./js/main.js'), 'v2:./js/main.js');
  assert.equal(await v2.fetch('./', { mode: 'navigate' }), 'v2:./index.html');
  await v2.activate();
  assert.deepEqual(await env.caches.keys(), ['lp1-v2sha'], 'older caches are deleted on activate');
});

test('sw: never handles cross-origin, non-GET, or non-shell subresources; unknown pages are network-first with the cached index offline', async () => {
  const server = shellFiles('v1');
  const env = fakeEnv({ server });
  const sw = loadSW(env, 'v1sha');
  await sw.install();
  assert.equal(await sw.fetch('https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/players/x'), undefined);
  assert.equal(await sw.fetch('./js/main.js', { method: 'POST' }), undefined);
  assert.equal(await sw.fetch('./assets/og.png'), undefined, 'not part of the shell: straight to the network');
  env.net.offline = true;
  assert.equal(await sw.fetch('./some/other/page', { mode: 'navigate' }), 'v1:./index.html', 'offline: the cached index of the active version');
});

test('main: the worker is only registered on https or localhost, with a relative scope', () => {
  const main = readFileSync(join(ROOT, 'js/main.js'), 'utf8');
  assert.match(main, /protocol === 'https:'/);
  assert.match(main, /register\('\.\/sw\.js', \{ scope: '\.\/' \}\)/);
});
