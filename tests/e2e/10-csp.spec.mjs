// CSP and security hygiene. The policy is a <meta> (GitHub Pages sends no headers), so this spec proves three things:
// the policy text is what we reviewed, it is actually enforced in a real browser, and the app runs under it with zero
// violations (every other spec also fails on any securitypolicyviolation event).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as H from './support/harness.mjs';

let srv;
let br;
before(async () => {
  srv = await H.startServer();
  br = await H.launchBrowser();
});
after(async () => {
  await br.close();
  await srv.close();
});

const html = fs.readFileSync(path.join(H.REPO, 'index.html'), 'utf8');
const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] || '';
const dirs = Object.fromEntries(policy.split(';').map((s) => s.trim()).filter(Boolean).map((s) => [s.split(/\s+/)[0], s.split(/\s+/).slice(1)]));

test('policy text: exact reviewed directives, hash equals the inline script, nothing unsafe, nothing ignored-in-meta', () => {
  const inline = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const hash = `'sha256-${crypto.createHash('sha256').update(inline, 'utf8').digest('base64')}'`;
  assert.deepEqual(dirs['default-src'], ["'self'"]);
  assert.deepEqual(dirs['script-src'], ["'self'", hash], `script-src carries exactly the hash of the inline script (${hash})`);
  assert.deepEqual(dirs['style-src'], ["'self'"]);
  assert.deepEqual(dirs['img-src'], ["'self'", 'data:']);
  assert.deepEqual(dirs['font-src'], ["'self'"]);
  assert.deepEqual(dirs['connect-src'], ["'self'", 'https://firestore.googleapis.com']);
  assert.deepEqual(dirs['manifest-src'], ["'self'"]);
  assert.deepEqual(dirs['worker-src'], ["'self'"]);
  assert.deepEqual(dirs['base-uri'], ["'none'"]);
  assert.deepEqual(dirs['form-action'], ["'self'"]);
  assert.deepEqual(dirs['object-src'], ["'none'"]);
  assert.ok(!/unsafe-inline|unsafe-eval|\*|http:/.test(policy.replace(/https:\/\/firestore\.googleapis\.com/, '')), 'no unsafe sources or wildcards');
  for (const ignored of ['frame-ancestors', 'report-uri', 'report-to', 'sandbox']) assert.ok(!(ignored in dirs), `${ignored} is ignored in a meta element and would log a console error`);
  assert.equal((html.match(/<script>/g) || []).length, 1, 'exactly one attribute-less inline script');
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script>'), 'CSP precedes the first script it governs');
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('rel="stylesheet"'));
  assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
  assert.ok(!/\sstyle=|\son[a-z]+=|javascript:/i.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'no inline style attributes, event handlers or javascript: URLs in markup');
});

test('policy is enforced in the browser: inline script, eval, style attribute, <base>, foreign origins are blocked and reported; CSSOM styling still works', async () => {
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend() });
  const { page } = d;
  await d.goto('');
  d.problems.length = 0;
  // eval must be tried from a script the page itself loaded: code run through CDP evaluate() is exempt from CSP.
  await d.context.route('**/__eval-probe.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'window.__eval = (function () { try { return new Function("return 1")(); } catch (e) { return "blocked"; } })();' }));
  await page.evaluate(() => new Promise((res) => {
    const s = document.createElement('script');
    s.src = './__eval-probe.js';
    s.onload = res;
    s.onerror = res;
    document.head.append(s);
  }));
  const evalResult = await page.evaluate(() => window.__eval);
  assert.equal(evalResult, 'blocked', 'eval/new Function is blocked for page scripts (no unsafe-eval)');
  const r = await page.evaluate(async () => {
    const out = {};
    const s = document.createElement('script');
    s.textContent = 'window.__inline = 1';
    document.head.append(s);
    out.inlineRan = window.__inline === 1;
    const p = document.createElement('p');
    p.setAttribute('style', 'color: rgb(1, 2, 3)');
    document.body.append(p);
    out.styleAttrApplied = getComputedStyle(p).color === 'rgb(1, 2, 3)';
    const q = document.createElement('p');
    q.style.color = 'rgb(4, 5, 6)'; // CSSOM: what play.js/dom.js use
    document.body.append(q);
    out.cssomApplied = getComputedStyle(q).color === 'rgb(4, 5, 6)';
    const b = document.createElement('base');
    b.href = 'https://evil.example/';
    document.head.append(b);
    out.baseApplied = document.baseURI.startsWith('https://evil.example');
    try {
      await fetch('https://evil.example/x', { mode: 'no-cors' });
      out.foreignFetch = 'allowed';
    } catch {
      out.foreignFetch = 'blocked';
    }
    return out;
  });
  assert.equal(r.inlineRan, false, 'injected inline script must not run');
  assert.equal(r.styleAttrApplied, false, 'style="" attribute is blocked');
  assert.equal(r.cssomApplied, true, 'element.style.x = ... is allowed (the app relies on it)');
  assert.equal(r.baseApplied, false, '<base> is blocked by base-uri none');
  assert.equal(r.foreignFetch, 'blocked', 'connect-src blocks foreign origins');
  await page.waitForTimeout(200);
  const kinds = d.problems.filter((p) => p.kind === 'csp').map((p) => p.text.split(' ')[0]);
  for (const need of ['script-src-elem', 'script-src', 'style-src-attr', 'base-uri', 'connect-src']) assert.ok(kinds.some((k) => k === need || k.startsWith(need)), `a ${need} violation was reported (got ${[...new Set(kinds)]})`);
  await d.close();
});

test('the app runs every screen under the policy with zero violations; modulepreload hints are all used (no "preloaded but not used" warning) in EN and AR', async () => {
  for (const lang of ['en', 'ar']) {
    const backend = H.createBackend();
    const d = await H.openDevice(br, { baseUrl: srv.url, backend, locale: lang === 'ar' ? 'ar-SA' : 'en-US' });
    const { page } = d;
    await d.goto('');
    await page.waitForTimeout(3500); // Chrome logs unused preloads ~3 s after load
    assert.deepEqual(d.problems.filter((p) => /preload/i.test(p.text)), [], `${lang}: no unused-preload warning on the first (auth) load`);
    await H.signUp(d, 'Policy Pam');
    await H.startClassic(page, 'rookie');
    await H.solveClassic(page);
    await page.click('[data-screen="result"] [data-action="go-home"]');
    await H.startBlood(page);
    await H.quitRound(page);
    await page.click('[data-screen="home"] [data-action="show-board"]');
    await d.waitScreen('board');
    await page.click('[data-screen="board"] [data-action="back"]');
    await page.click('[data-screen="home"] [data-action="show-help"]');
    await d.waitScreen('help');
    await page.click('header [data-action="mute"]'); // sound module + AudioContext path
    await page.click('[data-screen="help"] [data-action="back"]');
    await page.waitForTimeout(3500);
    assert.deepEqual(d.problems.filter((p) => p.kind === 'csp'), [], `${lang}: zero CSP violations across all screens`);
    assert.deepEqual(d.problems.filter((p) => /preload/i.test(p.text)), [], `${lang}: no unused-preload warning`);
    d.assertClean(lang);
    await d.close();
  }
});

test('no secret in client code: only the public Firebase Web API key, no tokens, private keys or service-account fields', async () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  for (const d of ['js', 'css', 'assets']) walk(path.join(H.REPO, d));
  files.push(path.join(H.REPO, 'index.html'), path.join(H.REPO, 'sw.js'), path.join(H.REPO, 'manifest.webmanifest'));
  const SECRET = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /ghp_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{30,}/, /\bsk-[A-Za-z0-9]{32,}/, /AKIA[0-9A-Z]{16}/, /xox[abp]-[A-Za-z0-9-]{10,}/, /"private_key"/, /client_secret/i, /Bearer\s+[A-Za-z0-9._-]{20,}/];
  const keys = new Set();
  for (const f of files.filter((x) => /\.(js|html|css|json|webmanifest|svg)$/.test(x))) {
    const t = fs.readFileSync(f, 'utf8');
    for (const re of SECRET) assert.ok(!re.test(t), `${path.relative(H.REPO, f)} matches ${re}`);
    for (const m of t.matchAll(/AIza[0-9A-Za-z_-]{35}/g)) keys.add(m[0]);
  }
  assert.equal(keys.size, 1, 'exactly one Google API key literal (the public Web key, ADR 0002)');
  const { CLOUD } = await import('../../js/config.js');
  assert.deepEqual([...keys], [CLOUD.apiKey]);
  // and nothing sensitive reaches storage: only lp1.* keys, no code
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend() });
  const code = await H.signUp(d, 'Secret Sam');
  await H.waitSynced(d.page);
  const dump = await d.page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie }));
  assert.ok(!dump.includes(code), 'the sign-up code is not in local/session storage or cookies');
  assert.equal(await d.page.evaluate(() => document.cookie), '', 'no cookies');
  assert.ok((await d.page.evaluate(() => Object.keys(localStorage))).every((k) => k.startsWith('lp1.')));
  await d.close();
});
