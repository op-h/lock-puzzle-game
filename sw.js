// Offline shell for GitHub Pages. HTML, JS and CSS can never mix versions:
//
//   * The cache is named `lp1-${VERSION}`. INSTALL fetches EVERY precached file (cache: 'reload', bypassing the
//     HTTP cache) into that new cache, all or nothing: if any file fails the install fails and the old worker
//     keeps serving the old, consistent set.
//   * Precached files, and navigations to the app root / index.html, are served ONLY from the active version's
//     cache (cache-first). Nothing is revalidated into it later, so a page can never load index.html from one
//     deploy and a module from another.
//   * A new version is found by reg.update() on every load (main.js), installs in the background and takes over
//     on the NEXT load: no skipWaiting / clients.claim, so a running Blood round is never switched mid-flight.
//   * ACTIVATE deletes every older lp1-* cache.
//   * Cross-origin requests (Firestore) and non-GET requests are never touched.
//
// RELEASE TOKEN (SENTRY): the release workflow must replace the literal  __BUILD_ID__  on the VERSION line with the
// git SHA, in the STAGED copy only, e.g.  sed -i "s/__BUILD_ID__/$GITHUB_SHA/" sw.js
// While VERSION is 'dev' or still carries the unreplaced __BUILD token, the worker is a pure network
// passthrough (no caches at all, and any stale lp1-* cache is deleted), so local development never serves
// stale files. The check below compares the PREFIX '__BUILD' on purpose: a naive replace of the full token must
// not rewrite the check itself.

const VERSION = '__BUILD_ID__';
const PASSTHROUGH = VERSION === 'dev' || VERSION.startsWith('__BUILD');
const CACHE = `lp1-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './css/main.css',
  './assets/sprites.svg',
  './assets/fonts/pixelify-sans-latin.woff2',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.png',
  './js/main.js',
  './js/config.js',
  './js/store.js',
  './js/router.js',
  './js/engine/clues.js',
  './js/engine/feedback.js',
  './js/engine/generator.js',
  './js/engine/rng.js',
  './js/engine/scoring.js',
  './js/engine/solver.js',
  './js/game/blood.js',
  './js/game/classic.js',
  './js/game/clock.js',
  './js/game/guess.js',
  './js/game/hint.js',
  './js/game/ownership.js',
  './js/game/progress.js',
  './js/i18n/ar.js',
  './js/i18n/en.js',
  './js/i18n/index.js',
  './js/sync/identity.js',
  './js/sync/index.js',
  './js/sync/local.js',
  './js/sync/merge.js',
  './js/sync/remote.js',
  './js/sync/sync.js',
  './js/sync/tabs.js',
  './js/ui/auth.js',
  './js/ui/board.js',
  './js/ui/chrome.js',
  './js/ui/dom.js',
  './js/ui/help.js',
  './js/ui/home.js',
  './js/ui/params.js',
  './js/ui/play.js',
  './js/ui/result.js',
  './js/ui/sound.js',
];

/** URL path -> cache key of the precached copy, or null if it is not part of the shell. */
function shellKey(url) {
  const path = url.pathname;
  const base = new URL('./', self.location.href).pathname;
  if (path === base || path === base + 'index.html') return './index.html';
  const rel = './' + path.slice(base.length);
  return PRECACHE.includes(rel) ? rel : null;
}

self.addEventListener('install', (e) => {
  if (PASSTHROUGH) return;
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await Promise.all(
          PRECACHE.filter((u) => u !== './').map(async (u) => {
            const res = await fetch(new Request(u, { cache: 'reload' }));
            if (!res.ok) throw new Error(`precache ${u}: ${res.status}`);
            // './' and './index.html' are the same document: one entry (shellKey maps both to it).
            await cache.put(u, res);
          }),
        );
      } catch (err) {
        await caches.delete(CACHE); // never leave a half-filled cache that a later install could trust
        throw err;
      }
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('lp1-') && (PASSTHROUGH || k !== CACHE)).map((k) => caches.delete(k)))),
  );
});

self.addEventListener('fetch', (e) => {
  if (PASSTHROUGH) return;
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const key = shellKey(url);
  if (key !== null) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => (await c.match(key)) || fetch(req)), // a miss is a network error, not a mixed version
    );
  } else if (req.mode === 'navigate') {
    // Some other page URL: network first, the cached index as the offline fallback.
    e.respondWith(
      fetch(req).catch(async () => (await (await caches.open(CACHE)).match('./index.html')) || Response.error()),
    );
  }
});
