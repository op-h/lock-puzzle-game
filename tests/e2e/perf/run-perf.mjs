// DoD 6 performance gate, as far as it is measurable on this machine (dev-only):
//   node tests/e2e/perf/run-perf.mjs [--runs=5] [--out=DIR]
// THROTTLED DESKTOP CHROMIUM, NOT A REAL MID-TIER ANDROID: CDP network 1.6 Mbps down / 750 Kbps up / 150 ms RTT,
// CPU 4x slowdown, 360x800 @2x mobile emulation, cold HTTP cache and empty storage per run, motion and scheme pinned
// via Emulation.setEmulatedMedia. Served by a node server that gzips like Pages (python http.server does not).
// Reports LCP (+element), FCP, CLS (+sources), a TBT proxy (long tasks after FCP), request count, transfer bytes per
// type against docs/perf.md budgets, and INP-like interaction latency (event timing, input -> next paint).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as H from '../support/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const RUNS = Number(arg('runs', 5));
const OUT = arg('out', path.join(HERE, '..', 'shots'));
fs.mkdirSync(OUT, { recursive: true });

// serve what production serves: the staged copy (release id stamped), gzip, 600 s cache header like Pages
const staged = path.join(os.tmpdir(), `lp-perf-stage-${process.pid}`);
execFileSync('bash', [path.join(H.REPO, '.github/scripts/stage-site.sh'), staged], { env: { ...process.env, BUILD_ID: 'perf' }, stdio: 'pipe' });
const srv = await H.startServer({ root: staged, compress: 'gzip' });
const browser = await H.launchBrowser();

const NET = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const gzBudget = { html: 14000, css: 18000, js: 45000, font: 20000, sprites: 8000, total: 120000 };

async function throttled(storageState) {
  const d = await H.openDevice(browser, { baseUrl: srv.url, backend: H.createBackend(), viewport: { width: 360, height: 800 }, mobile: true, storageState, media: { motion: 'no-preference', scheme: 'dark' } });
  const cdp = await d.context.newCDPSession(d.page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.emulateNetworkConditions', NET);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const reqs = new Map();
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp }));
  cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.enc = e.response.headers['content-encoding'] || e.response.headers['Content-Encoding'] || ''; } });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.end = e.timestamp; } });
  await d.page.addInitScript(() => {
    window.__m = { lcp: null, cls: 0, shifts: [], fcp: null, long: [], ev: [] };
    new PerformanceObserver((l) => { const e = l.getEntries().at(-1); window.__m.lcp = { t: Math.round(e.startTime), el: e.element ? e.element.tagName + (e.element.id ? '#' + e.element.id : '') + (e.element.dataset && e.element.dataset.out ? '[' + e.element.dataset.out + ']' : '') : '?' }; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__m.cls += e.value; window.__m.shifts.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), n: (e.sources || []).map((s) => s.node && (s.node.nodeName + (s.node.id ? '#' + s.node.id : ''))).join(',') }); } }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__m.fcp = Math.round(e.startTime); }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.ev.push({ n: e.name, d: e.duration, t: Math.round(e.startTime), tgt: e.target && (e.target.dataset && (e.target.dataset.action || e.target.dataset.digit || e.target.dataset.dial) || e.target.tagName) }); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  });
  return { d, cdp, reqs };
}

function classify(reqs, base) {
  const out = { count: 0, html: 0, css: 0, js: 0, font: 0, sprites: 0, other: 0, total: 0, jsFiles: 0, items: [] };
  for (const r of reqs.values()) {
    if (!r.url.startsWith(base) || r.bytes === undefined) continue;
    out.count++;
    out.total += r.bytes;
    const rel = r.url.slice(base.length);
    let k = 'other';
    if (r.type === 'Document') k = 'html';
    else if (r.type === 'Stylesheet') k = 'css';
    else if (r.type === 'Script' || /\.js$/.test(rel)) { k = 'js'; out.jsFiles++; }
    else if (r.type === 'Font') k = 'font';
    else if (/sprites\.svg/.test(rel)) k = 'sprites';
    out[k] += r.bytes;
    out.items.push([rel || '(document)', r.bytes, r.status]);
  }
  return out;
}

const cold = [];
for (let i = 0; i < RUNS; i++) {
  const { d, reqs } = await throttled(undefined);
  await d.page.goto(srv.url, { waitUntil: 'load' });
  await d.page.waitForTimeout(3500);
  const m = await d.page.evaluate(() => window.__m);
  const nav = await d.page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; });
  const net = classify(reqs, srv.url);
  const tbt = m.long.filter(([s]) => s >= (m.fcp || 0)).reduce((a, [, dur]) => a + Math.max(0, dur - 50), 0);
  cold.push({ lcp: m.lcp, fcp: m.fcp, cls: m.cls, shifts: m.shifts, tbt, longTasks: m.long.length, nav, net, problems: d.problems.length });
  await d.close();
}

// returning, signed-in visitor (session in storage): the Auth -> Home flash and its CLS
const setup = await H.openDevice(browser, { baseUrl: srv.url, backend: H.createBackend(), viewport: { width: 360, height: 800 }, mobile: true });
await H.signUp(setup, 'Perf Pat');
await H.waitSynced(setup.page);
const state = await setup.context.storageState();
const warmBackend = setup.net; // same fake not needed: the resumed session talks to a fresh fake (offline-first)
await setup.close();
const returning = [];
for (let i = 0; i < Math.min(RUNS, 3); i++) {
  const { d, reqs } = await throttled(state);
  await d.page.goto(srv.url, { waitUntil: 'load' });
  await d.page.waitForTimeout(3500);
  const m = await d.page.evaluate(() => window.__m);
  const scr = await d.screen();
  returning.push({ lcp: m.lcp, cls: m.cls, shifts: m.shifts, screen: scr, net: classify(reqs, srv.url) });
  await d.close();
}

// INP-like: drive real interactions under the same throttle
const inp = [];
for (let i = 0; i < 3; i++) {
  const { d } = await throttled(undefined);
  const { page } = d;
  await d.goto('');
  await H.signUp(d, 'Inp ' + i);
  // each step measured as: dispatch -> next frame after the handler (rAF x2), plus the browser's own event timing
  const step = async (label, fn) => {
    const t = await page.evaluate(async () => {
      window.__t0 = performance.now();
      return null;
    });
    await fn();
    const ms = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(Math.round(performance.now() - window.__t0))))));
    inp.push({ run: i, label, ms });
  };
  await step('home: pick Master', () => page.check('#diff-master'));
  await step('home: Play Classic (route + generate + render)', () => page.click('[data-screen="home"] [data-action="play-classic"]'));
  await page.waitForSelector('[data-screen="play"] [data-slot="dials"] > button');
  await step('dial tap', () => page.click('[data-screen="play"] [data-slot="dials"] > button:nth-child(3)'));
  for (const dgt of [1, 2, 3, 4, 5]) await step(`keypad ${dgt}`, () => page.click(`[data-screen="play"] [data-digit="${dgt}"]`));
  await step('Check (wrong guess)', () => page.click('[data-screen="play"] [data-action="check"]'));
  await step('Hint', () => page.click('[data-screen="play"] [data-action="hint"]'));
  await step('language toggle (re-render)', () => page.click('header [data-action="lang"]'));
  await step('language toggle back', () => page.click('header [data-action="lang"]'));
  await H.quitRound(page);
  await d.waitScreen('home');
  await step('home: Play Blood (route + generate + render)', () => page.click('[data-screen="home"] [data-action="play-blood"]'));
  await page.waitForSelector('[data-screen="play"] [data-slot="dials"] > button');
  const bp = await H.currentPuzzle(page);
  for (const dgt of H.wrongGuess(bp.answer, 0)) await step(`blood keypad ${dgt}`, () => page.click(`[data-screen="play"] [data-digit="${dgt}"]`));
  await step('Blood Check (wrong, -5 s)', () => page.click('[data-screen="play"] [data-action="check"]'));
  await step('Blood Skip', () => page.click('[data-screen="play"] [data-action="skip"]'));
  const ev = await page.evaluate(() => window.__m.ev);
  inp.push({ run: i, label: 'EVENT-TIMING max (browser, durationThreshold 16)', ms: Math.round(Math.max(0, ...ev.map((e) => e.d))), detail: ev.sort((a, b) => b.d - a.d).slice(0, 3) });
  await d.close();
}

await browser.close();
await srv.close();
fs.rmSync(staged, { recursive: true, force: true });

const col = (k) => cold.map((c) => c[k]);
const lcp = cold.map((c) => c.lcp && c.lcp.t);
const table = {
  runs: RUNS,
  lcp: { median: median(lcp), worst: Math.max(...lcp), elements: [...new Set(cold.map((c) => c.lcp && c.lcp.el))] },
  fcp: { median: median(col('fcp')), worst: Math.max(...col('fcp')) },
  cls: { median: +median(col('cls')).toFixed(4), worst: +Math.max(...col('cls')).toFixed(4), shifts: cold.flatMap((c) => c.shifts).slice(0, 6) },
  tbtProxyMs: { median: median(col('tbt')), worst: Math.max(...col('tbt')) },
  load: { median: median(cold.map((c) => c.nav.load)), worst: Math.max(...cold.map((c) => c.nav.load)) },
  net: cold[0].net,
  returning: returning.map((r) => ({ lcp: r.lcp, cls: +r.cls.toFixed(4), shifts: r.shifts, screen: r.screen, requests: r.net.count, js: r.net.js })),
  inpLike: {
    worstStep: inp.filter((x) => !x.label.startsWith('EVENT')).sort((a, b) => b.ms - a.ms).slice(0, 6),
    byLabel: Object.fromEntries([...new Set(inp.map((x) => x.label))].map((l) => [l, Math.max(...inp.filter((x) => x.label === l).map((x) => x.ms))])),
    eventTiming: inp.filter((x) => x.label.startsWith('EVENT')),
  },
  budgets: {
    html: [cold[0].net.html, gzBudget.html],
    css: [cold[0].net.css, gzBudget.css],
    jsFirstLoad: [cold[0].net.js, gzBudget.js],
    font: [cold[0].net.font, gzBudget.font],
    sprites: [cold[0].net.sprites, gzBudget.sprites],
    total: [cold[0].net.total, gzBudget.total],
  },
  note: 'throttled desktop Chromium (1.6 Mbps, 150 ms RTT, CPU x4), not a real mid-tier Android',
};
fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify({ when: new Date().toISOString(), table, cold, returning, inp }, null, 1));
console.log(JSON.stringify(table, null, 1));
