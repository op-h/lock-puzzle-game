// Behaviours added late in the build (ATLAS change list): clue-card geometry in Arabic, sign-up persistence rules,
// repeat-digit rule, never-stopping Classic timer, aria-disabled Check/Hint, multi-tab Blood ownership and logout,
// stricter name normalisation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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

const dev = (o = {}) => H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend(), ...o });
const T = '[data-screen="play"]';

/** Geometry of the first feedback clue vs the dial row, measured in the browser. */
const clueGeometry = (page) =>
  page.evaluate(() => {
    const li = document.querySelector('[data-screen="play"] [data-slot="clues"] > li[data-kind="feedback"]');
    const dials = [...document.querySelectorAll('[data-screen="play"] [data-slot="dials"] > button')].map((b) => b.getBoundingClientRect());
    const digits = [...li.querySelectorAll('.digit')].map((s) => s.getBoundingClientRect());
    const pips = [...li.querySelectorAll('[data-pip]')].map((s) => s.getBoundingClientRect());
    const txt = li.querySelector('.clue-text');
    const rng = document.createRange();
    rng.selectNodeContents(txt);
    const tr = rng.getBoundingClientRect();
    const lr = li.getBoundingClientRect();
    const cs = getComputedStyle(li);
    const rank = (arr) => arr.map((r, i) => i).sort((a, b) => arr[a].left - arr[b].left);
    return {
      liDir: cs.direction,
      liIsolate: cs.unicodeBidi,
      txtDir: getComputedStyle(txt).direction,
      digitRank: rank(digits),
      dialRank: rank(dials),
      digitLefts: digits.map((r) => Math.round(r.left)),
      // after = to the right on the same row, or wrapped onto the row below (5 digits + pips do not fit one row at 320)
      pipsAfterDigits: pips.length === 0 || pips.every((p) => p.left >= Math.max(...digits.map((d) => d.right)) - 1 || p.top >= Math.max(...digits.map((d) => d.bottom)) - 2),
      pipsWrapped: pips.some((p) => p.top >= Math.max(...digits.map((d) => d.bottom)) - 2),
      textBelowDigits: tr.top >= Math.max(...digits.map((d) => d.bottom)) - 2,
      textRightGap: Math.round(lr.right - parseFloat(cs.paddingRight) - tr.right),
      textLeftGap: Math.round(tr.left - lr.left - parseFloat(cs.paddingLeft)),
      liW: Math.round(lr.width),
      vw: innerWidth,
      scrollW: document.documentElement.scrollWidth,
    };
  });

for (const [w, h] of [[320, 568], [390, 844]]) {
  test(`clue cards @ ${w}: Arabic digits run in dial order (LTR), pips follow, sentence is RTL and right-aligned on its own row; English unchanged`, async () => {
    const d = await dev({ viewport: { width: w, height: h }, mobile: true, locale: 'ar-SA' });
    const { page } = d;
    await H.signUp(d, 'هندسة');
    await H.startClassic(page, 'master');
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    const ar = await clueGeometry(page);
    assert.equal(ar.liDir, 'ltr', 'feedback card is an LTR isolate so digits match the dials');
    assert.match(ar.liIsolate, /isolate/);
    assert.deepEqual(ar.digitRank, ar.dialRank.slice(0, ar.digitRank.length).map((_, i) => i), `digit i is left of digit i+1, same as dial order (lefts ${ar.digitLefts})`);
    assert.deepEqual(ar.dialRank, [...ar.dialRank].sort((a, b) => a - b));
    assert.equal(ar.pipsAfterDigits, true, 'pips come after the digits');
    assert.equal(ar.textBelowDigits, true, 'sentence sits on its own row below the digits');
    assert.equal(ar.txtDir, 'rtl', 'sentence stays RTL');
    assert.ok(ar.textRightGap <= 6, `Arabic sentence is right-aligned: gap to right edge ${ar.textRightGap}px (left gap ${ar.textLeftGap}px)`);
    assert.ok(ar.scrollW <= ar.vw, 'no horizontal overflow');
    // board points column in Arabic
    await H.quitRound(page);
    await d.waitScreen('home');
    await H.startClassic(page, 'rookie');
    await H.solveClassic(page);
    await H.waitSynced(page);
    await page.click('[data-screen="result"] [data-action="go-home"]');
    await page.click('[data-screen="home"] [data-action="show-board"]');
    await d.waitScreen('board');
    await page.waitForSelector('[data-slot="board-rows"] tr');
    const board = await page.evaluate(() => {
      const row = document.querySelector('[data-slot="board-rows"] tr');
      const tds = [...row.children].map((c) => ({ dir: getComputedStyle(c).direction, align: getComputedStyle(c).textAlign, text: c.textContent.trim(), r: c.getBoundingClientRect().toJSON() }));
      return { cells: tds, scrollW: document.documentElement.scrollWidth, vw: innerWidth, tableW: document.querySelector('table').getBoundingClientRect().width };
    });
    assert.ok(board.scrollW <= board.vw, 'board fits');
    assert.match(board.cells[2].text, /^[0-9][0-9,]*$/, 'points are Latin digits');
    assert.ok(board.cells[2].r.left >= 0 && board.cells[2].r.right <= board.vw);
    // English layout unchanged: digits run left to right in dial order too, sentence left-aligned
    await page.click('header [data-action="lang"]');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.click('[data-screen="board"] [data-action="back"]');
    await H.startClassic(page, 'master');
    const en = await clueGeometry(page);
    assert.equal(en.liDir, 'ltr');
    assert.equal(en.txtDir, 'ltr');
    assert.deepEqual(en.digitRank, en.digitRank.slice().sort((a, b) => a - b), 'English digits in order');
    assert.equal(en.pipsAfterDigits, true);
    assert.ok(en.textLeftGap <= 6, `English sentence left-aligned (gap ${en.textLeftGap})`);
    d.assertClean();
    await d.close();
  });
}

test('sign-up is not persisted until the code is acknowledged; reload with the dialog open lands on auth with no session', async () => {
  const backend = H.createBackend();
  const d = await dev({ backend });
  const { page } = d;
  page.on('dialog', (x) => x.accept()); // the armed beforeunload prompt: accept so the reload goes ahead
  await d.goto('');
  await page.fill(H.q.signupName, 'Orphan Olga');
  await page.click(H.q.signupSubmit);
  await page.waitForSelector(`${H.q.codeDialog}[open]`);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^lp1\.(session|save\.|dirty\.)/.test(k)));
  assert.deepEqual(keys, [], 'nothing about the account is on disk while the code is unacknowledged');
  await page.reload();
  await d.booted();
  assert.equal(await d.screen(), 'auth');
  assert.equal(await page.isVisible('header details[data-account]'), false);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter((k) => /^lp1\.(session|save\.)/.test(k))), []);
  // after the acknowledgement everything is written
  await H.signUp(d, 'Acked Ada');
  const after = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^lp1\.(session|save\.)/.test(k)).sort());
  assert.equal(after.length, 2, `session + save exist after ack: ${after}`);
  d.assertClean();
  await d.close();
});

test('no-repeat puzzles reject a repeated digit for free; Agent allows repeats; labels say so', async () => {
  const d = await dev();
  const { page } = d;
  await H.signUp(d, 'Repeat Rae');
  await H.startClassic(page, 'rookie');
  assert.match((await page.textContent(`${T} [data-out="difficulty"]`)).replace(/ /g, ' '), /^Rookie · 3 digits, all different$/);
  await H.typeWithKeypad(page, [4, 4, 7]);
  await H.pressCheck(page);
  await page.waitForFunction(() => /Every digit in this puzzle is different/.test(document.querySelector('[data-screen="play"] [data-out="msg"]').textContent));
  assert.equal(await page.locator(`${T} [data-slot="attempts"] li`).count(), 0, 'nothing is listed');
  assert.equal(await page.textContent(`${T} [data-out="attempts-left"]`), '0', 'nothing is counted');
  await H.quitRound(page);
  await H.startClassic(page, 'agent');
  assert.match((await page.textContent(`${T} [data-out="difficulty"]`)).replace(/ /g, ' '), /^Agent · 3 digits, digits may repeat$/);
  const p = await H.currentPuzzle(page);
  const rep = p.answer[0] === 5 ? [6, 6, 6] : [5, 5, 5];
  await H.typeWithKeypad(page, rep);
  await H.pressCheck(page);
  await page.waitForFunction(() => /Wrong guesses: 1\./.test(document.querySelector('[data-screen="play"] [data-out="msg"]').textContent));
  d.assertClean();
  await d.close();
});

test('Check and Hint use aria-disabled: still focusable, say why when activated, never the disabled attribute', async () => {
  const d = await dev();
  const { page } = d;
  await H.signUp(d, 'Aria Ann');
  await H.startClassic(page, 'rookie');
  const check = `${T} [data-action="check"]`;
  const hint = `${T} [data-action="hint"]`;
  assert.equal(await page.getAttribute(check, 'aria-disabled'), 'true');
  assert.equal(await page.getAttribute(check, 'disabled'), null, 'no disabled attribute');
  await page.focus(check);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'check', 'a disabled-looking Check can take focus');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Fill every dial first/.test(document.querySelector('[data-screen="play"] [data-out="msg"]').textContent));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'check', 'focus is not dropped');
  await page.click(hint);
  await page.waitForFunction(() => /Hint used/.test(document.querySelector('[data-screen="play"] [data-out="msg"]').textContent));
  assert.equal(await page.getAttribute(hint, 'aria-disabled'), 'true');
  assert.equal(await page.getAttribute(hint, 'disabled'), null);
  await page.focus(hint);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'hint', 'used Hint stays focusable');
  // fill the dials: Check becomes enabled
  const p = await H.currentPuzzle(page);
  const free = p.answer;
  await page.click(`${T} [data-action="clear"]`);
  for (const dgt of free) await page.click(`${T} [data-slot="keypad"] [data-digit="${dgt}"]`).catch(() => {});
  await page.waitForFunction(() => document.querySelector('[data-screen="play"] [data-action="check"]').getAttribute('aria-disabled') !== 'true');
  d.assertClean();
  await d.close();
});

test('Classic timer never stops: a hidden tab and a closed page both keep counting', async () => {
  const d = await dev();
  const { page } = d;
  await H.signUp(d, 'Clock Cal');
  await H.waitSynced(page);
  await page.clock.install({ time: Date.now() });
  await page.reload();
  await d.booted();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await H.startClassic(page, 'rookie');
  const timer = () => page.textContent(`${T} [data-out="timer"]`).then((s) => s.trim());
  const sec = (s) => s.split(':').reduce((a, b) => a * 60 + Number(b), 0);
  await page.clock.runFor(30000);
  assert.equal(await timer(), '0:30');
  // hidden tab
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(10000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(1000);
  assert.ok(sec(await timer()) >= 41, `hidden tab did not pause the clock: ${await timer()}`);
  // closed page: leave, wait 20 s, come back
  const t0 = sec(await timer());
  await page.goto('about:blank');
  await page.clock.fastForward(20000);
  await page.goto(srv.url);
  await d.booted();
  await d.waitScreen('play');
  assert.ok(sec(await timer()) >= t0 + 20, `closed time is added on reload: ${t0} -> ${await timer()}`);
  d.assertClean();
  await d.close();
});

test('names: Arabic digit folding signs in to one account; an all-invisible name has its own message', async () => {
  const backend = H.createBackend();
  const a = await dev({ backend });
  const code = await H.signUp(a, 'أحمد٢');
  await H.waitSynced(a.page);
  const b = await dev({ backend });
  await H.signIn(b, 'أحمد2', code);
  assert.equal(await b.page.isVisible('header details[data-account]'), true);
  assert.equal([...backend.docs.keys()].filter((k) => k.startsWith('players/')).length, 1, 'same account id');
  // invisible-only name
  const c = await dev({ backend });
  await c.goto('');
  await c.page.evaluate((sel) => {
    document.querySelector(sel).value = '​‍⁠';
  }, H.q.signupName);
  await c.page.click(H.q.signupSubmit);
  await c.page.waitForFunction(() => document.querySelector('#signup-error').textContent.trim() !== '');
  const msg = await c.page.textContent('#signup-error');
  assert.match(msg, /no visible characters/);
  assert.doesNotMatch(msg, /Enter a player name/, 'its own message, not the empty-name one');
  assert.equal(await c.page.isVisible(`${H.q.codeDialog}[open]`), false);
  // hidden characters inside a name do not make a different account
  const d3 = await dev({ backend });
  const code3 = await H.signUp(d3, 'Zed​Zed');
  await H.waitSynced(d3.page);
  const e = await dev({ backend });
  await H.signIn(e, 'ZedZed', code3);
  for (const x of [a, b, c, d3, e]) x.assertClean();
  for (const x of [a, b, c, d3, e]) await x.close();
});

test('multi-tab: a second tab cannot take over a live Blood run; logging out in one tab signs the other out and nothing resurrects the save', async () => {
  const d = await dev();
  const { page: a, context } = d;
  await H.signUp(d, 'Tabby');
  await H.waitSynced(a);
  await H.startBlood(a);
  await a.waitForTimeout(600);
  const b = await context.newPage();
  await H.pinMedia(b, { motion: 'no-preference', scheme: 'dark' });
  await b.goto(srv.url);
  await b.waitForSelector('main > [data-screen]:not([hidden])');
  await b.waitForFunction(() => !document.documentElement.hasAttribute('data-boot'));
  const screenB = await b.evaluate(() => document.querySelector('main > [data-screen]:not([hidden])').dataset.screen);
  assert.equal(screenB, 'home', 'second tab goes to Home');
  await b.waitForSelector('[data-toast]');
  assert.match(await b.textContent('[data-toast]'), /A Blood run is active in another tab/);
  await b.click('[data-screen="home"] [data-action="play-blood"]');
  await b.waitForFunction(() => /another tab/.test(document.querySelector('[data-toast]').textContent));
  assert.equal(await b.evaluate(() => document.querySelector('main > [data-screen]:not([hidden])').dataset.screen), 'home', 'cannot start a second Blood run');
  // tab A still plays
  assert.equal(await a.evaluate(() => document.querySelector('main > [data-screen]:not([hidden])').dataset.screen), 'play');
  const p = await H.currentPuzzle(a);
  await H.typeWithKeypad(a, p.answer);
  await H.pressCheck(a);
  // logout in B (the tab that is on Home): A must follow
  await b.click('header details[data-account] > summary');
  await b.click('header [data-action="logout"]');
  await b.waitForSelector('dialog[data-dialog="confirm-logout"][open]');
  await b.click('dialog[data-dialog="confirm-logout"] [data-action="logout"]');
  await b.waitForFunction(() => document.querySelector('main > [data-screen]:not([hidden])')?.dataset.screen === 'auth');
  await a.waitForFunction(() => document.querySelector('main > [data-screen]:not([hidden])')?.dataset.screen === 'auth', null, { timeout: 8000 });
  await a.waitForTimeout(2500); // a late debounce/heartbeat would resurrect lp1.save.<id> or lp1.run.<id> here
  const left = await a.evaluate(() => Object.keys(localStorage).filter((k) => !/^lp1\.(lang|pref)$/.test(k)));
  assert.deepEqual(left, [], 'nothing of the account was written back after logout');
  d.assertClean();
  await d.close();
});

// F-05 (fixed): the open Log Out menu must lie inside the viewport (full-width row under the header below 480 px).
for (const [w, h] of [[320, 568], [360, 740], [390, 844], [480, 854], [768, 1024], [1280, 800]]) {
  for (const lang of ['en', 'ar']) {
    test(`account menu @ ${w} ${lang}: the open Log Out button lies inside the viewport and is hit-testable`, async () => {
      const d = await dev({ viewport: { width: w, height: h }, mobile: w <= 768, locale: lang === 'ar' ? 'ar-SA' : 'en-US' });
      await H.signUp(d, 'Matrix Max');
      await d.page.click('header details[data-account] > summary');
      const r = await d.page.evaluate(() => {
        const b = document.querySelector('header [data-action="logout"]');
        const q = b.getBoundingClientRect();
        const top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, q.left + q.width / 2)), q.top + q.height / 2);
        return { left: Math.round(q.left), right: Math.round(q.right), vw: innerWidth, hit: !!top && (b === top || b.contains(top)) };
      });
      assert.ok(r.left >= 0 && r.right <= r.vw, `Log Out spans ${r.left}..${r.right} in a ${r.vw}px viewport`);
      assert.equal(r.hit, true, 'the centre of Log Out is clickable');
      await d.close();
    });
  }
}

// F-06 (fixed) + the ADR 0004 sentence-case change: no word may be broken across lines on any screen, in EN or AR.
const wordBreaks = (page, only = null) =>
  page.evaluate((onlySel) => {
    const out = [];
    const root = document.querySelector('main > [data-screen]:not([hidden])');
    for (const scope of [document.querySelector('header'), root, document.querySelector('footer')]) {
      if (!scope) continue;
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest('[hidden], noscript, dialog:not([open])')) continue;
        // F-12 (play status cell) and F-13 (board column headers) are tracked by their own tests and skipped here
        if (onlySel ? !el.closest(onlySel) : el.closest('[data-out="difficulty"], thead th')) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const box = el.getBoundingClientRect();
        if (box.width <= 2 || (cs.position === 'absolute' && box.width <= 2)) continue;
        for (const m of n.textContent.matchAll(/\S+/g)) {
          if (m[0].length < 3) continue;
          // puzzle ids ("master-p99d4z") are identifiers, not words: they may wrap
          if (/^[\u2066\u2067]?[a-z]+-[0-9a-z]{4,}[\u2069]?[:.]?$/.test(m[0])) continue;
          const r = document.createRange();
          r.setStart(n, m.index);
          r.setEnd(n, m.index + m[0].length);
          // a word is broken when its boxes sit on different LINES (bidi runs and isolates also yield several boxes on one line)
          const lines = new Set([...r.getClientRects()].filter((q) => q.width > 0.5).map((q) => Math.round((q.top + q.height / 2) / Math.max(4, q.height * 0.6))));
          if (lines.size > 1) out.push(m[0]);
        }
      }
    }
    return out;
  }, only);

test('word-break scan: no word is split across lines on auth, home, help, board, play and result at 320, 360, 390 and 768 (EN and AR)', async () => {
  const broken = [];
  for (const [w, h] of [[320, 568], [360, 740], [390, 844], [768, 1024]]) {
    for (const lang of ['en', 'ar']) {
      const backend = H.createBackend();
      const d = await dev({ backend, viewport: { width: w, height: h }, mobile: true, locale: lang === 'ar' ? 'ar-SA' : 'en-US' });
      const { page } = d;
      const scan = async (label) => {
        for (const x of await wordBreaks(page)) broken.push(`${w} ${lang} ${label}: ${x}`);
      };
      await d.goto('');
      await scan('auth');
      await page.click('[data-action="show-signin"]');
      await scan('signin');
      await page.click('[data-action="show-signup"]');
      await H.signUp(d, 'Wide Wanda');
      await scan('home');
      await page.click('[data-screen="home"] [data-action="show-help"]');
      await d.waitScreen('help');
      await scan('help');
      await page.click('[data-screen="help"] [data-action="back"]');
      await H.startClassic(page, 'master');
      const p = await H.currentPuzzle(page);
      await H.typeWithKeypad(page, H.wrongGuess(p.answer, 0));
      await H.pressCheck(page);
      await page.click('[data-screen="play"] [data-action="hint"]');
      await page.waitForTimeout(150);
      await scan('play-classic-5');
      await H.quitRound(page);
      await H.startBlood(page);
      await scan('play-blood');
      await H.quitRound(page);
      await H.startClassic(page, 'rookie');
      await H.solveClassic(page);
      await H.waitSynced(page);
      await scan('result');
      await page.click('[data-screen="result"] [data-action="go-home"]');
      await page.click('[data-screen="home"] [data-action="show-board"]');
      await d.waitScreen('board');
      await page.waitForSelector('[data-slot="board-rows"] tr');
      await scan('board');
      await d.close();
    }
  }
  assert.deepEqual(broken, []);
});

test('header stays on ONE row at 320 and 360 in EN and AR, signed out and signed in (incl. the "English" button)', async () => {
  const rows = [];
  for (const [w, h] of [[320, 568], [360, 740], [390, 844]]) {
    for (const lang of ['en', 'ar']) {
      const d = await dev({ viewport: { width: w, height: h }, mobile: true, locale: lang === 'ar' ? 'ar-SA' : 'en-US' });
      const { page } = d;
      const rowsOf = () =>
        page.evaluate(() => {
          const hd = document.querySelector('header');
          const kids = [...hd.querySelectorAll(':scope > *')].filter((c) => !c.hidden && getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().height > 0 && getComputedStyle(c).position !== 'absolute');
          // one row = every item's vertical centre within 6 px of the header's own centre (items differ in height)
          const hr = hd.getBoundingClientRect();
          const off = kids.filter((c) => { const r = c.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - (hr.top + hr.height / 2)) > 6; });
          return { rows: off.length ? 2 : 1, off: off.map((c) => c.className || c.tagName), h: Math.round(hd.getBoundingClientRect().height), lang: document.documentElement.lang, n: kids.length, sw: document.documentElement.scrollWidth, vw: innerWidth };
        });
      await d.goto('');
      let r = await rowsOf();
      if (r.rows !== 1 || r.sw > r.vw) rows.push(`${w} ${lang} signed-out: ${JSON.stringify(r)}`);
      await H.signUp(d, 'Row Rita');
      r = await rowsOf();
      if (r.rows !== 1 || r.sw > r.vw) rows.push(`${w} ${lang} signed-in: ${JSON.stringify(r)}`);
      // the other language's toggle label ("English" is the longest Latin one) must fit too
      await page.click('header [data-action="lang"]');
      await page.waitForFunction((l) => document.documentElement.lang !== l, lang);
      r = await rowsOf();
      if (r.rows !== 1 || r.sw > r.vw) rows.push(`${w} ${lang}->toggled: ${JSON.stringify(r)}`);
      await d.close();
    }
  }
  assert.deepEqual(rows, []);
});

test('Quit is reachable with a real pointer click and by keyboard at 320x568 and 390x844 on 5-dial Play and Blood (F-03)', async () => {
  for (const [w, h] of [[320, 568], [390, 844]]) {
    const d = await dev({ viewport: { width: w, height: h }, mobile: true });
    const { page } = d;
    await H.signUp(d, 'Quit Quentin');
    for (const start of [() => H.startClassic(page, 'master'), () => H.startBlood(page)]) {
      await start();
      await page.click(`${T} [data-action="quit"]`, { timeout: 5000 }); // Playwright fails if it is covered at every scroll position
      await page.waitForSelector('dialog[data-dialog="confirm-quit"][open]');
      await page.click('dialog[data-dialog="confirm-quit"] button[value="cancel"]');
      await page.waitForSelector('dialog[data-dialog="confirm-quit"]:not([open])', { state: 'attached' });
      assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'quit');
      const seen = await page.evaluate(() => {
        const q = document.querySelector('[data-screen="play"] [data-action="quit"]');
        q.scrollIntoView({ block: 'nearest' });
        q.focus();
        const r = q.getBoundingClientRect();
        const dock = document.querySelector('[data-screen="play"] > section[aria-labelledby="play-guess-title"]').getBoundingClientRect();
        const hd = document.querySelector('header').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, dockTop: dock.top, headerBottom: hd.bottom, vh: innerHeight, dockSticky: getComputedStyle(document.querySelector('[data-screen="play"] > section[aria-labelledby="play-guess-title"]')).position === 'sticky' };
      });
      assert.ok(seen.top >= seen.headerBottom - 0.5, `${w}: Quit not under the header`);
      assert.ok(!seen.dockSticky || seen.bottom <= seen.dockTop + 0.5, `${w}: Quit not under the sticky dock (${JSON.stringify(seen)})`);
      await H.quitRound(page);
      await d.waitScreen('home');
    }
    d.assertClean();
    await d.close();
  }
});

// F-12 (open, PRISM): at 320 px the play status cell "Master · 5 digits, all different" still breaks inside words
// (EN: Master / digits, / different; AR: the same). 360 px and wider are clean.
test('play status cell (difficulty) never breaks a word at 320 (F-12)', { todo: 'F-12: [data-out=difficulty] breaks inside words at 320 px' }, async () => {
  const broken = [];
  for (const lang of ['en', 'ar']) {
    const d = await dev({ viewport: { width: 320, height: 568 }, mobile: true, locale: lang === 'ar' ? 'ar-SA' : 'en-US' });
    await H.signUp(d, 'Cell Cy');
    await H.startClassic(d.page, 'master');
    for (const x of await wordBreaks(d.page, '[data-out="difficulty"]')) broken.push(`${lang}: ${x}`);
    await d.close();
  }
  assert.deepEqual(broken, []);
});

// F-13 (open, PRISM): in Arabic the leaderboard "Rank" column header is ~56 px wide and the word breaks inside itself
// (الترتي / ب) at every width from 320 to 768 (css table/th width).
test('board column headers never break a word in Arabic (F-13)', { todo: 'F-13: Arabic rank header breaks inside the word at all widths' }, async () => {
  const broken = [];
  for (const [w, h] of [[320, 568], [768, 1024]]) {
    const d = await dev({ viewport: { width: w, height: h }, mobile: true, locale: 'ar-SA' });
    await H.signUp(d, 'Head Hal');
    await H.startClassic(d.page, 'rookie');
    await H.solveClassic(d.page);
    await H.waitSynced(d.page);
    await d.page.click('[data-screen="result"] [data-action="go-home"]');
    await d.page.click('[data-screen="home"] [data-action="show-board"]');
    await d.waitScreen('board');
    await d.page.waitForSelector('[data-slot="board-rows"] tr');
    for (const x of await wordBreaks(d.page, 'thead th')) broken.push(`${w}: ${x}`);
    await d.close();
  }
  assert.deepEqual(broken, []);
});
