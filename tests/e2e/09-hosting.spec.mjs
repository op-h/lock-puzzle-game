// Hosting smoke: the site must work when served from a project sub-path (GitHub Pages) AND from a root, and every
// file the page, manifest and service worker point at must exist in what is being served. Run with E2E_ROOT=_site
// to prove the staged deploy artifact is complete (CI does).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as H from './support/harness.mjs';

let br;
before(async () => {
  br = await H.launchBrowser();
});
after(async () => {
  await br.close();
});

const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

for (const base of ['/lock-puzzle-game/', '/']) {
  test(`hosting at ${base}: boots, plays a round, every request is 200 and stays inside ${base}`, async () => {
    const srv = await H.startServer({ base });
    try {
      const backend = H.createBackend();
      const d = await H.openDevice(br, { baseUrl: srv.url, backend });
      const { page } = d;
      await H.signUp(d, 'Host Hana');
      await H.startClassic(page, 'rookie');
      await H.solveClassic(page);
      await page.click('[data-screen="result"] [data-action="go-home"]');
      await page.click('[data-screen="home"] [data-action="show-board"]');
      await d.waitScreen('board');
      await page.click('[data-screen="board"] [data-action="back"]');
      await page.click('[data-screen="home"] [data-action="show-help"]');
      await d.waitScreen('help');
      await page.click('[data-screen="help"] [data-action="back"]');
      await H.startBlood(page);
      await H.quitRound(page);
      await page.waitForTimeout(500);
      d.assertClean(`(${base})`);
      const outside = srv.hits.filter((h) => !h.split(' ')[1].startsWith(base) && !h.endsWith(base.slice(0, -1)));
      assert.deepEqual(outside, [], 'no request escaped the project path (a root-absolute URL would 404 on Pages)');
      // the same pixels: font and sprite actually used
      assert.equal(await page.evaluate(() => document.fonts.check('16px "Pixelify Sans"')), true);
      await d.close();
    } finally {
      await srv.close();
    }
  });
}

test('every path in index.html, manifest, sw.js precache list and CSS url() is served 200 at the sub-path, with the right type and size', async () => {
  const srv = await H.startServer();
  try {
    const get = async (rel) => {
      const r = await fetch(new URL(rel, srv.url));
      return { r, buf: Buffer.from(await r.arrayBuffer()) };
    };
    const html = (await get('')).buf.toString();
    const refs = new Set();
    for (const m of html.matchAll(/\b(?:href|src)="(\.\/[^"#]+)/g)) refs.add(m[1]);
    const mani = JSON.parse((await get('manifest.webmanifest')).buf.toString());
    for (const i of mani.icons) refs.add(i.src);
    const sw = (await get('sw.js')).buf.toString();
    for (const m of /const PRECACHE = \[([\s\S]*?)\];/.exec(sw)[1].matchAll(/'([^']+)'/g)) refs.add(m[1]);
    const css = (await get('css/main.css')).buf.toString();
    for (const m of css.matchAll(/url\("(\.\.\/[^"]+)"\)/g)) refs.add(m[1].replace('../', './'));
    for (const r of ['./robots.txt', './sitemap.xml']) refs.add(r);
    assert.ok(refs.size > 40, `collected ${refs.size} references`);
    for (const rel of refs) {
      const { r } = await get(rel);
      assert.equal(r.status, 200, `${rel} -> ${r.status}`);
    }
    // declared icon sizes are real
    for (const i of mani.icons) {
      const { buf, r } = await get(i.src);
      assert.equal(r.headers.get('content-type'), 'image/png');
      const [w, h] = i.sizes.split('x').map(Number);
      assert.deepEqual(pngSize(buf), { w, h }, `${i.src} really is ${i.sizes}`);
    }
    const og = pngSize((await get('assets/og.png')).buf);
    assert.deepEqual(og, { w: 1200, h: 630 }, 'og.png is 1200x630 as the meta tags declare');
    assert.equal((await get('manifest.webmanifest')).r.headers.get('content-type'), 'application/manifest+json');
    assert.match((await get('assets/fonts/pixelify-sans-latin.woff2')).r.headers.get('content-type'), /font\/woff2/);
    // outside the project path is a 404, as on Pages (so a stray /js/x.js would be caught)
    assert.equal((await fetch(srv.origin + '/js/main.js')).status, 404);
    // the deploy artifact must not contain anything but the site: when serving the repo itself these exist and are fine,
    // when serving _site they must not
    if (process.env.E2E_ROOT) {
      for (const rel of ['tests/unit/engine.test.mjs', 'docs/qa.md', 'package.json', 'firestore.rules', '.git/config', 'node_modules/playwright-core/package.json']) {
        assert.equal((await fetch(new URL(rel, srv.url))).status, 404, `${rel} must not be deployed`);
      }
    }
    // gzip is honoured (Pages compresses text); compare sizes so a regression in the dev server cannot fake the perf run
    const plain = await fetch(new URL('css/main.css', srv.url), { headers: { 'accept-encoding': 'identity' } });
    const gz = await fetch(new URL('css/main.css', srv.url), { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    assert.ok(Number(gz.headers.get('content-length')) < Number(plain.headers.get('content-length')) / 3);
  } finally {
    await srv.close();
  }
});

test('index.html uses only relative URLs for first-party resources (no leading slash)', async () => {
  const root = process.env.E2E_ROOT || H.REPO;
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const bad = [...html.matchAll(/\b(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(bad, [], 'root-absolute URLs break under /lock-puzzle-game/');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(!/'\/(js|css|assets)\//.test(sw), 'sw.js precache uses relative paths');
});
