// Shared e2e harness (dev-only). One import gives a spec: browser launch, a "device" (= browser context)
// with problem collection (console, pageerror, CSP violations, failed/4xx requests, third-party hosts),
// CDP media pinning, an in-process Firestore for multi-device tests, and the common user flows.
//
// Rules this file enforces for every spec:
//   * Firestore is NEVER contacted. Requests to firestore.googleapis.com are answered by the fake (Node
//     side, via context.route); on Chromium a host-resolver rule additionally makes every non-local host
//     unresolvable, so a leaked request fails loudly instead of reaching Google.
//   * prefers-reduced-motion / prefers-color-scheme are pinned with CDP Emulation.setEmulatedMedia on
//     Chromium (headless Chromium silently defaults to `reduce`, CLAUDE.md) and read back with matchMedia.
//   * Every device collects problems; a spec ends with `d.assertClean()`.

import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright-core';
import { createFakeFirestore } from '../../unit/helpers/fake-firestore.mjs';
import { CLOUD } from '../../../js/config.js';
import { startServer, REPO } from './static-server.mjs';

export { startServer, REPO };
export const BROWSER = process.env.E2E_BROWSER || 'chromium';
export const FIRESTORE_HOST = 'firestore.googleapis.com';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchBrowser(extra = {}) {
  if (BROWSER === 'firefox') return firefox.launch({ headless: true, ...extra });
  if (BROWSER === 'webkit') return webkit.launch({ headless: true, ...extra });
  return chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      // Safety net: nothing but the local server may resolve. Routed Firestore calls never need DNS.
      '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1',
      ...(extra.args || []),
    ],
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'args')),
  });
}

/** The fake backend shared by every device of a test, wired with the project id and key from js/config.js. */
export function createBackend() {
  return createFakeFirestore({ projectId: CLOUD.projectId, apiKey: CLOUD.apiKey });
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '600',
};

/**
 * Route firestore.googleapis.com to the in-process fake for one context. `net.offline = true` makes the
 * "device" unreachable (abort), like airplane mode; `net.block = true` is the same but meant as the
 * "backend blocked" scenario. Returns the net switch.
 */
export async function attachBackend(context, backend) {
  const net = backend ? backend.device() : { offline: false, fetch: null };
  net.block = false;
  net.requests = [];
  await context.route(`https://${FIRESTORE_HOST}/**`, async (route) => {
    const req = route.request();
    net.requests.push(`${req.method()} ${new URL(req.url()).pathname}`);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (net.offline || net.block || !backend) return route.abort('internetdisconnected');
    try {
      const r = await net.fetch(req.url(), { method: req.method(), body: req.postData() || undefined });
      const body = await r.text();
      await route.fulfill({ status: r.status, headers: { ...CORS, 'content-type': 'application/json' }, body });
    } catch {
      await route.abort('internetdisconnected').catch(() => {});
    }
  });
  return net;
}

// ---------------------------------------------------------------------------------------------- media

const cdpOf = new WeakMap();

/**
 * Pin media features. Chromium: CDP Emulation.setEmulatedMedia (all four features each call, because the
 * call REPLACES the set). Firefox/WebKit have no CDP: page.emulateMedia covers motion/scheme/contrast/forced.
 * Reads the result back with matchMedia and throws when the pin did not take: a silent default is exactly
 * the failure CLAUDE.md warns about.
 * @param {import('playwright-core').Page} page
 * @param {{motion?: 'reduce'|'no-preference', scheme?: 'dark'|'light', contrast?: 'more'|'no-preference', forced?: boolean}} m
 */
export async function pinMedia(page, m = {}) {
  const motion = m.motion || 'no-preference';
  const scheme = m.scheme || 'dark';
  const contrast = m.contrast || 'no-preference';
  const forced = m.forced ? 'active' : 'none';
  if (BROWSER === 'chromium') {
    let cdp = cdpOf.get(page);
    if (!cdp) {
      cdp = await page.context().newCDPSession(page);
      cdpOf.set(page, cdp);
    }
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-reduced-motion', value: motion },
        { name: 'prefers-color-scheme', value: scheme },
        { name: 'prefers-contrast', value: contrast },
        { name: 'forced-colors', value: forced },
      ],
    });
  } else {
    await page.emulateMedia({
      reducedMotion: motion,
      colorScheme: scheme,
      contrast: contrast === 'more' ? 'more' : 'no-preference',
      forcedColors: forced === 'active' ? 'active' : 'none',
    });
  }
  const got = await page.evaluate(() => ({
    reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
    more: matchMedia('(prefers-contrast: more)').matches,
    forced: matchMedia('(forced-colors: active)').matches,
  }));
  assert.equal(got.reduce, motion === 'reduce', `prefers-reduced-motion pin failed (${JSON.stringify(got)})`);
  assert.equal(got.dark, scheme === 'dark', `prefers-color-scheme pin failed (${JSON.stringify(got)})`);
  if (BROWSER === 'chromium') {
    assert.equal(got.more, contrast === 'more', 'prefers-contrast pin failed');
    assert.equal(got.forced, forced === 'active', 'forced-colors pin failed');
  }
  return got;
}

// ---------------------------------------------------------------------------------------------- device

/**
 * @typedef {Object} DeviceOpts
 * @property {string} baseUrl  site URL ending in "/"
 * @property {ReturnType<typeof createBackend>|null} [backend] shared fake; null = Firestore unreachable
 * @property {{width:number,height:number}} [viewport]
 * @property {boolean} [mobile] isMobile + hasTouch + DPR 2
 * @property {number} [dpr]
 * @property {boolean} [js] default true
 * @property {boolean} [sw] allow service workers (default false: they make fresh-load tests flaky)
 * @property {string} [locale] navigator.language, default en-US
 * @property {any} [storageState]
 * @property {{motion?:string, scheme?:string, contrast?:string, forced?:boolean}} [media]
 * @property {RegExp[]} [allow] console/network problems matching any of these are expected in this test
 * @property {boolean} [clipboard]
 */

export async function openDevice(browser, o) {
  const mobile = !!o.mobile;
  const context = await browser.newContext({
    viewport: o.viewport || { width: 390, height: 844 },
    isMobile: BROWSER === 'firefox' ? false : mobile,
    hasTouch: mobile,
    deviceScaleFactor: o.dpr || (mobile ? 2 : 1),
    javaScriptEnabled: o.js !== false,
    serviceWorkers: o.sw ? 'allow' : 'block',
    locale: o.locale || 'en-US',
    storageState: o.storageState,
    permissions: o.clipboard && BROWSER === 'chromium' ? ['clipboard-read', 'clipboard-write'] : undefined,
  });
  const page = await context.newPage();
  const problems = [];
  const allow = [...(o.allow || [])];
  const origin = new URL(o.baseUrl).origin;
  const note = (kind, text) => {
    const line = `${kind}: ${text}`;
    // Artefact of serviceWorkers:'block', not of the app (the SW spec runs with workers allowed).
    if (!o.sw && /Service Worker registration blocked by Playwright/.test(line)) return;
    // Chromium with scripting emulated off still issues the <link rel=modulepreload> requests and fails them with
    // errorText "csp" (verified identical with the CSP meta removed): emulation artefact, no console message, not the app.
    if (o.js === false && /^requestfailed: GET \S+\/js\/\S+\.js csp$/.test(line)) return;
    if (allow.some((re) => re.test(line))) return;
    problems.push({ kind, text });
  };

  page.on('pageerror', (e) => note('pageerror', String(e && e.message ? e.message : e)));
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') note('console.' + t, `${m.text()} @ ${m.location().url || ''}`);
  });
  page.on('requestfailed', (r) => note('requestfailed', `${r.method()} ${r.url()} ${r.failure() ? r.failure().errorText : ''}`));
  page.on('response', (r) => {
    if (r.status() >= 400) note('http' + r.status(), r.url());
  });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return;
    if (u.origin !== origin && u.hostname !== FIRESTORE_HOST) note('third-party', r.url());
  });
  // CSP violations and unhandled rejections: reported through a binding so they survive navigations.
  await context.exposeBinding('__lpReport', (_src, kind, text) => note(kind, String(text)));
  await context.addInitScript(() => {
    const send = (k, t) => {
      try {
        window.__lpReport(k, t);
      } catch {
        /* binding not ready */
      }
    };
    document.addEventListener('securitypolicyviolation', (e) => send('csp', `${e.violatedDirective} blocked ${e.blockedURI || '(inline)'} ${e.sample || ''}`));
    window.addEventListener('unhandledrejection', (e) => send('unhandledrejection', String(e.reason && e.reason.message ? e.reason.message : e.reason)));
  });

  const net = await attachBackend(context, o.backend === undefined ? null : o.backend);
  if (o.media !== undefined || BROWSER === 'chromium') await pinMedia(page, o.media || { motion: 'no-preference', scheme: 'dark' });

  const d = {
    browser,
    context,
    page,
    net,
    problems,
    allow,
    baseUrl: o.baseUrl,
    origin,
    media: o.media || { motion: 'no-preference', scheme: 'dark' },
    /** repin without reload */
    pin(m) {
      d.media = { ...d.media, ...m };
      return pinMedia(page, d.media);
    },
    /** Navigate within the site. `hash` like "#home" or ""; waits for the app to finish booting. */
    async goto(hash = '', { boot = true } = {}) {
      await page.goto(o.baseUrl + hash, { waitUntil: 'load' });
      if (boot && o.js !== false) await d.booted();
    },
    async booted() {
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-boot'), null, { timeout: 15000 });
      await page.waitForSelector('main > [data-screen]:not([hidden])', { timeout: 15000 });
    },
    screen: () => page.evaluate(() => (document.querySelector('main > [data-screen]:not([hidden])') || {}).dataset?.screen || null),
    async waitScreen(name, timeout = 10000) {
      await page.waitForSelector(`main > [data-screen="${name}"]:not([hidden])`, { timeout });
    },
    async close() {
      await context.close();
    },
    /** Throws with every collected problem. Call at the end of a test, after letting things settle. */
    assertClean(label = '') {
      assert.deepEqual(problems.map((p) => `${p.kind}: ${p.text}`), [], `console/network/CSP problems ${label}`);
    },
    clean: () => problems.length === 0,
  };
  return d;
}

// ---------------------------------------------------------------------------------------------- flows

export const q = {
  signupName: '[data-form="signup"] [data-field="name"]',
  signupSubmit: '[data-form="signup"] [type="submit"]',
  signinName: '[data-form="signin"] [data-field="name"]',
  signinCode: '[data-form="signin"] [data-field="code"]',
  signinSubmit: '[data-form="signin"] [type="submit"]',
  codeDialog: 'dialog[data-dialog="code"]',
  status: 'header [data-out="status"]',
};

/** Sign up through the real UI; returns the 6 raw digits. Leaves the player on Home. */
export async function signUp(d, name) {
  const { page } = d;
  await d.goto('');
  await page.fill(q.signupName, name);
  await page.click(q.signupSubmit);
  await page.waitForSelector(`${q.codeDialog}[open]`);
  const shown = (await page.textContent(`${q.codeDialog} [data-out="code"]`)).trim();
  const code = shown.replace(/\D/g, '');
  assert.match(code, /^\d{6}$/, `code dialog showed "${shown}"`);
  await page.check('#code-ack');
  await page.click(`${q.codeDialog} [data-action="ack-code"]`);
  await d.waitScreen('home');
  return code;
}

export async function signIn(d, name, code, { expect = 'home' } = {}) {
  const { page } = d;
  await d.goto('');
  await page.click('[data-action="show-signin"]');
  await page.fill(q.signinName, name);
  await page.fill(q.signinCode, code);
  await page.click(q.signinSubmit);
  if (expect) await d.waitScreen(expect);
}

export async function logout(d) {
  const { page } = d;
  await page.click('header details[data-account] > summary');
  await page.click('header [data-action="logout"]');
  await page.waitForSelector('dialog[data-dialog="confirm-logout"][open]');
  await page.click('dialog[data-dialog="confirm-logout"] [data-action="logout"]');
  await d.waitScreen('auth');
}

export async function homeTotals(page) {
  return page.evaluate(() => {
    const t = (n) => document.querySelector(`[data-screen="home"] [data-out="${n}"]`)?.textContent.trim();
    return { classic: t('classic'), blood: t('blood'), total: t('total') };
  });
}

/** Digits "1,234" or Arabic-Indic or plain: -> Number */
export const num = (s) => Number(String(s).replace(/[^\d]/g, ''));

export async function chooseDifficulty(page, id) {
  await page.check(`#diff-${id}`);
}

// ----- puzzle access: puzzles are pure functions of (difficulty, seed); the seed is in lp1.run.<id>

/**
 * The puzzle currently in play, rebuilt through the engine (generator + exhaustive solver) from the seed the
 * app persisted, then cross-checked against what the DOM actually shows. Independent of the UI's own state.
 */
export async function currentPuzzle(page) {
  return page.evaluate(async () => {
    const base = document.baseURI;
    const sess = JSON.parse(localStorage.getItem('lp1.session'));
    const rec = JSON.parse(localStorage.getItem('lp1.run.' + sess.id));
    const { generatePuzzle } = await import(new URL('./js/engine/generator.js', base).href);
    const { solutions } = await import(new URL('./js/engine/solver.js', base).href);
    const seed = rec.mode === 'classic' ? rec.seed : rec.puzzle.seed;
    let difficulty = rec.difficulty;
    if (rec.mode === 'blood') {
      const { bloodDifficultyFor } = await import(new URL('./js/config.js', base).href);
      difficulty = bloodDifficultyFor(rec.solvedInRun);
    }
    const p = generatePuzzle({ difficulty, seed });
    const sols = solutions({ length: p.length, repeats: p.repeats }, p.clues, 2);
    const items = [...document.querySelectorAll('[data-screen="play"] [data-slot="clues"] > li')];
    const domFeedback = items
      .filter((li) => li.dataset.kind === 'feedback')
      .map((li) => ({
        guess: [...li.querySelectorAll('.digit')].map((s) => Number(s.textContent)),
        bulls: li.querySelectorAll('[data-pip="right"]').length,
        cows: li.querySelectorAll('[data-pip="wrong"]').length,
      }));
    const engFeedback = p.clues.filter((c) => c.kind === 'feedback').map((c) => ({ guess: c.guess, bulls: c.bulls, cows: c.cows }));
    return {
      id: p.id,
      difficulty,
      seed,
      length: p.length,
      answer: p.answer,
      solutions: sols,
      clueCount: p.clues.length,
      domClueCount: items.length,
      domFeedback,
      engFeedback,
      kinds: p.clues.map((c) => c.kind),
    };
  });
}

/**
 * A wrong guess that is legal on every puzzle kind: the n-th distinct rearrangement of the answer's own digits.
 * (A rearrangement never repeats a digit the answer does not repeat, so it is not rejected by the no-repeat rule,
 * which would silently turn "wrong guess" into "free rejection".)
 */
export function wrongGuess(answer, n = 0) {
  const seen = new Set([answer.join('')]);
  const out = [];
  const rec = (rest, cur) => {
    if (!rest.length) {
      const k = cur.join('');
      if (!seen.has(k)) {
        seen.add(k);
        out.push(cur.slice());
      }
      return;
    }
    rest.forEach((d, i) => rec([...rest.slice(0, i), ...rest.slice(i + 1)], [...cur, d]));
  };
  rec(answer.slice(), []);
  return out[n % out.length];
}

/** Type digits with the on-screen keypad into the (cleared) dial row. */
export async function typeWithKeypad(page, digits) {
  await page.click('[data-screen="play"] [data-action="clear"]');
  for (const dgt of digits) await page.click(`[data-screen="play"] [data-slot="keypad"] [data-digit="${dgt}"]`);
}

export async function dialValues(page) {
  return page.$$eval('[data-screen="play"] [data-slot="dials"] > button', (bs) => bs.map((b) => b.textContent.trim()));
}

export async function pressCheck(page) {
  await page.click('[data-screen="play"] [data-action="check"]');
}

/** Start a Classic round from Home (picks the difficulty first) and wait for the play screen. */
export async function startClassic(page, difficulty = 'rookie') {
  // The radio is an invisible overlay on its label (design choice), so the input itself is the click target.
  await page.check(`#diff-${difficulty}`);
  await page.click('[data-screen="home"] [data-action="play-classic"]');
  await page.waitForSelector('main > [data-screen="play"]:not([hidden]) [data-slot="dials"] > button');
}

export async function startBlood(page) {
  await page.click('[data-screen="home"] [data-action="play-blood"]');
  await page.waitForSelector('main > [data-screen="play"]:not([hidden]) [data-slot="dials"] > button');
}

/**
 * Solve the Classic puzzle in play: answer comes from the engine (generator + exhaustive solver from the stored
 * seed) after asserting the solver finds exactly one solution and the DOM shows the same feedback clues.
 * @returns {Promise<{puzzle: any}>}
 */
export async function solveClassic(page, { wrongFirst = 0, fakeClock = false } = {}) {
  const puzzle = await currentPuzzle(page);
  assert.equal(puzzle.solutions.length, 1, 'engine puzzle must have exactly one solution');
  assert.deepEqual(puzzle.solutions[0], puzzle.answer, 'brute-force solution equals the generator answer');
  assert.equal(puzzle.domClueCount, puzzle.clueCount, 'DOM renders every clue');
  assert.deepEqual(puzzle.domFeedback, puzzle.engFeedback, 'DOM feedback clues (digits + pips) match the engine');
  for (let i = 0; i < wrongFirst; i++) {
    await typeWithKeypad(page, wrongGuess(puzzle.answer, i));
    await pressCheck(page);
  }
  await typeWithKeypad(page, puzzle.answer);
  await pressCheck(page);
  // The app holds the open lock on screen for ~1.1 s before routing; under a paused fake clock that pause must be advanced.
  if (fakeClock) await page.clock.runFor(1500);
  await page.waitForSelector('main > [data-screen="result"]:not([hidden])', { timeout: 10000 });
  return { puzzle };
}

/** Wait until the sync chip says `text` (default Synced). */
export async function waitStatus(page, text = 'Synced', timeout = 15000) {
  await page.waitForFunction((t) => document.querySelector('header [data-out="status"]')?.textContent.trim() === t, text, { timeout });
}

/** Language-independent: the chip carries data-status (synced|saving|offline|local). */
export async function waitSynced(page, timeout = 15000) {
  await page.waitForFunction(() => document.querySelector('header .lp-chip')?.dataset.status === 'synced', null, { timeout });
}

/** Quit the current round with real pointer clicks (the Quit button must be reachable at every viewport: F-03 is fixed). */
export async function quitRound(page) {
  await page.click('[data-screen="play"] [data-action="quit"]');
  await page.waitForSelector('dialog[data-dialog="confirm-quit"][open]');
  await page.click('dialog[data-dialog="confirm-quit"] [data-action="quit"]');
}
