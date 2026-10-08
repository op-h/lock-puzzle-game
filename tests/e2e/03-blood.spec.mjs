// 3c. Blood mode under Playwright's fake clock: the 3:00 countdown is driven deterministically.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './support/harness.mjs';
import { puzzleScore } from '../../js/engine/scoring.js';
import { BLOOD } from '../../js/config.js';

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

const T = '[data-screen="play"]';
const norm = (s) => s.replace(/\u00a0/g, ' ').trim();
const timerText = (page) => page.textContent(`${T} [data-out="timer"]`).then((s) => s.trim());
const sel = {
  puzzleNo: `${T} [data-out="puzzle-no"]`,
  diff: `${T} [data-out="difficulty"]`,
  msg: `${T} [data-out="msg"]`,
  sr: `${T} [data-live="timer-sr"]`,
};
const save = (page) =>
  page.evaluate(() => {
    const sess = JSON.parse(localStorage.getItem('lp1.session'));
    return JSON.parse(localStorage.getItem('lp1.save.' + sess.id));
  });

/** Sign up in real time, then run the app under a paused fake clock. */
async function fakeClockDevice(backend, name, opts = {}) {
  const d = await H.openDevice(br, { baseUrl: srv.url, backend, ...opts });
  const code = await H.signUp(d, name);
  await H.waitStatus(d.page);
  await d.page.clock.install({ time: Date.now() });
  await d.page.reload();
  await d.booted();
  const now = await d.page.evaluate(() => Date.now());
  await d.page.clock.pauseAt(now + 1000);
  return { d, code };
}

/** Advance fake time in 1 s steps so intervals and the 250 ms tick behave as in real life. */
async function advance(page, ms) {
  for (let left = ms; left > 0; left -= 1000) {
    await page.clock.runFor(Math.min(1000, left));
  }
}

async function solveOneBlood(page) {
  const before = await page.textContent(sel.puzzleNo);
  const p = await H.currentPuzzle(page);
  assert.equal(p.solutions.length, 1);
  await H.typeWithKeypad(page, p.answer);
  await H.pressCheck(page);
  await page.waitForFunction(([s, b]) => document.querySelector(s).textContent !== b, [sel.puzzleNo, before]);
  return p;
}

test('blood: countdown shape, wrong -5 s, skip -10 s, per-solve points x2, difficulty ramp 1-2 Rookie / 3-4 Agent / 5-7 Hacker / 8 Master', async () => {
  const { d } = await fakeClockDevice(H.createBackend(), 'Blood Bea');
  const { page } = d;
  await H.startBlood(page);
  assert.equal(await page.getAttribute('body', 'data-mode'), 'blood');
  assert.equal(await page.textContent(`${T} [data-mode-badge]`), 'Blood');
  assert.equal(await timerText(page), '3:00');
  assert.equal(await page.getAttribute(`${T} [data-timer-bar]`, 'data-phase'), 'normal');
  assert.equal(await page.evaluate((s) => document.querySelector(s).style.getPropertyValue('--lp-timer-left'), `${T} [data-timer-bar]`), '18');
  assert.equal(await page.isVisible(`${T} [data-action="skip"]`), true);
  assert.equal(await page.isVisible(`${T} [data-action="hint"]`), false, 'no hints in Blood');
  assert.equal(await page.isVisible(`${T} [data-timer-bar]`), true);
  assert.equal(await page.getAttribute(`${T} [data-out="timer"]`, 'role'), 'timer');
  assert.notEqual(await page.getAttribute(`${T} [data-out="timer"]`, 'aria-live'), 'polite', 'timer itself is not a polite live region');
  assert.equal(await page.textContent(sel.puzzleNo), '#1');
  assert.match(norm(await page.textContent(sel.diff)), /^Rookie · 3 digits, all different$/);

  // wrong guess: -5 s
  const p1 = await H.currentPuzzle(page);
  await H.typeWithKeypad(page, H.wrongGuess(p1.answer, 0));
  await H.pressCheck(page);
  await page.waitForFunction((s) => /Wrong guess: .5/.test(document.querySelector(s).textContent), sel.msg);
  assert.equal(await timerText(page), '2:55', 'wrong guess costs 5 s');
  // duplicate wrong guess: no second penalty
  await H.typeWithKeypad(page, H.wrongGuess(p1.answer, 0));
  await H.pressCheck(page);
  await page.waitForFunction((s) => /already tried/.test(document.querySelector(s).textContent), sel.msg);
  assert.equal(await timerText(page), '2:55', 'duplicate guess is free');
  // skip: -10 s, new puzzle, still puzzle #1
  await page.click(`${T} [data-action="skip"]`);
  await page.waitForFunction((s) => /Skipped/.test(document.querySelector(s).textContent), sel.msg);
  assert.equal(await timerText(page), '2:45', 'skip costs 10 s');
  assert.equal(await page.textContent(sel.puzzleNo), '#1', 'skipping does not count as a solve');
  const afterSkip = await H.currentPuzzle(page);
  assert.notEqual(afterSkip.id, p1.id, 'skip serves a new puzzle');

  // solve 8 puzzles: ramp and score pins. The clock is frozen, so secs=0 and no wrong guesses: pts are fixed.
  const expectDiff = ['Rookie', 'Rookie', 'Agent', 'Agent', 'Hacker', 'Hacker', 'Hacker', 'Master'];
  const dials = [3, 3, 3, 3, 4, 4, 4, 5];
  for (let i = 0; i < 8; i++) {
    assert.ok(norm(await page.textContent(sel.diff)).startsWith(expectDiff[i] + ' ·'), `puzzle #${i + 1} difficulty: ${await page.textContent(sel.diff)}`);
    assert.equal((await H.dialValues(page)).length, dials[i], `puzzle #${i + 1} dial count`);
    if (expectDiff[i] === 'Agent') assert.match(norm(await page.textContent(sel.diff)), /digits may repeat/, 'Agent says digits may repeat');
    else assert.match(norm(await page.textContent(sel.diff)), /all different/);
    assert.equal(await page.textContent(sel.puzzleNo), `#${i + 1}`);
    await solveOneBlood(page);
  }
  assert.ok((await page.textContent(sel.diff)).startsWith('Master'));
  const s = await save(page);
  const blood = s.history.filter((e) => e.m === 'b');
  assert.equal(blood.length, 8);
  assert.deepEqual(blood.map((e) => e.d), ['rookie', 'rookie', 'agent', 'agent', 'hacker', 'hacker', 'hacker', 'master']);
  assert.equal(blood[0].pts, 400, 'rookie Blood solve at 0 s with no wrong guess = 100 x 2.0 x 2');
  assert.equal(blood[0].pts, puzzleScore({ difficulty: 'rookie', secs: 0, wrong: 0, usedHint: false, blood: true }));
  for (const e of blood) assert.equal(e.pts, puzzleScore({ difficulty: e.d, secs: e.s, wrong: e.w, usedHint: false, blood: true }), `entry ${e.id}`);
  assert.equal(await timerText(page), '2:45', 'solving costs no clock; the frozen clock did not move');
  d.assertClean();
  await d.close();
});

test('blood: SR announcements only at 2:00/1:00/0:30/0:10/0:00; phases; expiry forfeits the puzzle in play; result labels Blood points; totals split', async () => {
  const backend = H.createBackend();
  const { d } = await fakeClockDevice(backend, 'Expiry Ed');
  const { page } = d;
  // a Classic solve first (real flow, frozen clock) so Classic is non-zero and the split is visible
  await H.startClassic(page, 'rookie');
  await H.solveClassic(page, { fakeClock: true });
  const classicPts = (await save(page)).history.at(-1).pts;
  await page.click('[data-screen="result"] [data-action="go-home"]');
  await d.waitScreen('home');

  await H.startBlood(page);
  await page.evaluate((s) => {
    window.__sr = [];
    new MutationObserver(() => window.__sr.push(document.querySelector(s).textContent)).observe(document.querySelector(s), { childList: true, characterData: true, subtree: true });
    window.__phases = [];
    const bar = document.querySelector('[data-screen="play"] [data-timer-bar]');
    new MutationObserver(() => window.__phases.push(bar.dataset.phase)).observe(bar, { attributes: true, attributeFilter: ['data-phase'] });
  }, sel.sr);
  await solveOneBlood(page);
  await solveOneBlood(page);
  const inPlay = await H.currentPuzzle(page); // solved count is 2: this one is forfeited
  assert.equal(await page.textContent(sel.puzzleNo), '#3');

  // play through the clock second by second
  const phaseAt = {};
  const timerAt = {};
  for (let sec = 1; sec <= 180; sec++) {
    await page.clock.runFor(1000);
    if ((await d.screen()) !== 'play') break;
    if ([60, 119, 120, 121, 149, 150, 151, 169, 170, 171, 179].includes(sec)) {
      phaseAt[sec] = await page.getAttribute(`${T} [data-timer-bar]`, 'data-phase');
      timerAt[sec] = await timerText(page);
    }
  }
  await d.waitScreen('result');
  const sr = await page.evaluate(() => window.__sr.filter((t) => t !== ''));
  assert.deepEqual(sr, ['2:00 left', '1:00 left', '0:30 left', '0:10 left', 'Time is up'], 'timer SR fires only at the five marks');
  assert.equal(timerAt[60], '2:00');
  assert.equal(timerAt[120], '1:00');
  assert.equal(phaseAt[149], 'normal', 'phase normal until 30 s remain');
  assert.equal(phaseAt[151], 'last30');
  assert.equal(phaseAt[170], 'last10');
  assert.equal(phaseAt[171], 'last10');
  // (a MutationObserver also records same-value writes, hence the dedupe)
  assert.deepEqual([...new Set(await page.evaluate(() => window.__phases))], ['normal', 'last30', 'last10'], 'phases only move forward');

  // result
  const s = await save(page);
  const blood = s.history.filter((e) => e.m === 'b');
  assert.equal(blood.length, 2, 'only the two solved puzzles scored; the one in play was forfeited');
  assert.ok(!s.history.some((e) => e.id.startsWith('b') && e.d && e.id.includes(String(inPlay.seed))));
  const bloodPts = blood.reduce((a, e) => a + e.pts, 0);
  assert.equal(s.runs.length, 1);
  assert.equal(s.runs[0].solved, 2);
  assert.equal(s.runs[0].pts, bloodPts);
  assert.equal(await page.getAttribute('body', 'data-mode'), 'blood');
  assert.equal(await page.textContent('[data-screen="result"] [data-mode-badge]'), 'Blood');
  const R = '[data-screen="result"]';
  const lines = await page.$$eval(`${R} [data-slot="result-lines"] li`, (l) => l.map((x) => x.textContent.trim()));
  assert.equal(lines[0], `Blood points (from Blood mode): +${bloodPts.toLocaleString('en-US')}`, lines[0]);
  assert.ok(lines.includes('Puzzles solved in this run: 2'));
  assert.ok(lines.some((l) => l.startsWith('Puzzle 1 (Rookie)')) && lines.some((l) => l.startsWith('Puzzle 2 (Rookie)')));
  const f = (n) => n.toLocaleString('en-US'); // the app groups thousands
  assert.ok(lines.includes(`Total Classic points: ${f(classicPts)}`), lines.join(' | '));
  assert.ok(lines.includes(`Total Blood points (from Blood mode): ${f(bloodPts)}`));
  assert.ok(lines.includes(`Total points: ${f(classicPts + bloodPts)}`));
  assert.equal(await page.isVisible(`${R} dt[data-mode="blood"]`), true);
  assert.match(await page.textContent(`${R} dt[data-mode="blood"]`), /Blood points \(from Blood mode\)/);
  assert.equal(H.num(await page.textContent(`${R} [data-out="bloodpoints"]`)), bloodPts);
  assert.equal(await page.isVisible(`${R} [data-action="retry"]`), true);
  assert.equal(await page.isVisible(`${R} [data-action="next"]`), false);
  await page.clock.runFor(400); // outcome line is deferred 250 ms so it is announced
  await page.waitForFunction((s2) => /Time is up\./.test(document.querySelector(s2).textContent), `${R} [data-out="msg"]`);
  // home: Classic / Blood / Total shown separately
  await page.click(`${R} [data-action="go-home"]`);
  await d.waitScreen('home');
  const totals = await H.homeTotals(page);
  assert.equal(H.num(totals.classic), classicPts);
  assert.equal(H.num(totals.blood), bloodPts);
  assert.equal(H.num(totals.total), classicPts + bloodPts);
  assert.match(await page.textContent('[data-screen="home"] dt[data-mode="blood"]'), /Blood points \(from Blood mode\)/);
  const hist = await page.$$eval('[data-screen="home"] [data-slot="history"] li', (l) => l.map((x) => ({ t: x.textContent.trim(), m: x.dataset.mode })));
  assert.ok(hist.some((h) => h.m === 'blood' && /^Blood points \(from Blood mode\)/.test(h.t)), 'recent rounds name Blood as its source');
  assert.ok(hist.some((h) => h.m === 'classic' && /^Classic,/.test(h.t)));
  d.assertClean();
  await d.close();
});

test('blood: a wrong guess with less than 5 s left ends the run and the run is recorded', async () => {
  const { d } = await fakeClockDevice(H.createBackend(), 'Late Lee');
  const { page } = d;
  await H.startBlood(page);
  await solveOneBlood(page);
  await advance(page, 176000);
  assert.equal(await timerText(page), '0:04');
  const p = await H.currentPuzzle(page);
  await H.typeWithKeypad(page, H.wrongGuess(p.answer, 0));
  await H.pressCheck(page);
  await d.waitScreen('result');
  const s = await save(page);
  assert.equal(s.history.filter((e) => e.m === 'b').length, 1);
  assert.equal(s.runs[0].solved, 1);
  d.assertClean();
  await d.close();
});

test('blood: reload mid-run restores the same run; reload after expiry finalises exactly once; second device sees Blood points', async () => {
  const backend = H.createBackend();
  const { d, code } = await fakeClockDevice(backend, 'Reload Rae');
  const { page } = d;
  await H.startBlood(page);
  await solveOneBlood(page);
  await solveOneBlood(page);
  await advance(page, 20000);
  const before = { timer: await timerText(page), no: await page.textContent(sel.puzzleNo), id: (await H.currentPuzzle(page)).id };
  assert.equal(before.timer, '2:40');
  assert.equal(before.no, '#3');

  // reload mid-run: the ownership state machine hands the run back on pagehide, so the reload resumes it at once
  await page.reload();
  await d.booted();
  assert.equal(await d.screen(), 'play', 'an immediate reload resumes the run (F-04)');
  await d.waitScreen('play');
  assert.equal(await page.getAttribute('body', 'data-mode'), 'blood');
  assert.equal(await timerText(page), before.timer, 'remaining time restored from the wall-clock deadline');
  assert.equal(await page.textContent(sel.puzzleNo), before.no, 'solved count restored');
  assert.equal((await H.currentPuzzle(page)).id, before.id, 'same puzzle in play');
  assert.equal((await save(page)).runs.length, 0, 'run not finalised by a mid-run reload');
  const bloodSoFar = (await save(page)).history.filter((e) => e.m === 'b');
  assert.equal(bloodSoFar.length, 2);
  const bloodPts = bloodSoFar.reduce((a, e) => a + e.pts, 0);

  // sync so device B can see the solves (debounce is a fake timer: push it forward)
  await advance(page, 3000);
  await H.waitStatus(page);

  // close the tab, let the deadline pass while nobody is looking, reopen
  const runRecord = await page.evaluate(() => {
    const sess = JSON.parse(localStorage.getItem('lp1.session'));
    return { key: 'lp1.run.' + sess.id, val: localStorage.getItem('lp1.run.' + sess.id) };
  });
  assert.ok(runRecord.val, 'run record exists');
  await page.goto('about:blank');
  await page.clock.fastForward(200000);
  await page.goto(srv.url);
  await d.booted();
  await d.waitScreen('result');
  let s = await save(page);
  assert.equal(s.runs.length, 1, 'finalised once');
  assert.equal(s.runs[0].pts, bloodPts, 'run points equal the per-solve points (not doubled)');
  assert.equal(s.runs[0].solved, 2);
  assert.equal(s.history.filter((e) => e.m === 'b').length, 2);
  assert.match(await page.textContent('[data-screen="result"] [data-out="msg"]'), /Time is up|​|^$/);
  // reload again: lands on home, nothing re-finalised
  await page.reload();
  await d.booted();
  assert.equal(await d.screen(), 'home');
  s = await save(page);
  assert.equal(s.runs.length, 1);
  // crash-during-finalisation: the same expired record reappears; recordRun is idempotent by runId
  await page.evaluate(({ key, val }) => localStorage.setItem(key, val), runRecord);
  await page.reload();
  await d.booted();
  await d.waitScreen('result');
  s = await save(page);
  assert.equal(s.runs.length, 1, 'restoring the same expired run twice does not duplicate it');
  assert.equal(s.runs[0].pts, bloodPts);
  await page.click('[data-screen="result"] [data-action="go-home"]');
  await d.waitScreen('home');
  const totalsA = await H.homeTotals(page);
  assert.equal(H.num(totalsA.blood), bloodPts, 'Blood total counted once');
  assert.equal(H.num(totalsA.classic), 0);
  assert.equal(H.num(totalsA.total), bloodPts);
  await advance(page, 3000);
  await H.waitStatus(page);

  // second device (real clock): closes and reopens after sync and sees the same split
  const b = await H.openDevice(br, { baseUrl: srv.url, backend });
  await H.signIn(b, 'Reload Rae', code);
  const totalsB = await H.homeTotals(b.page);
  assert.deepEqual(totalsB, totalsA, 'second device shows Blood points after sync');
  assert.ok(H.num(totalsB.blood) > 0);
  // and the board shows the best run on the Blood tab
  await b.page.click('[data-screen="home"] [data-action="show-board"]');
  await b.waitScreen('board');
  await b.page.click('[data-tab="blood"]');
  await b.page.waitForSelector('[data-slot="board-rows"] tr[data-self="true"]');
  assert.equal(H.num(await b.page.textContent('[data-slot="board-rows"] tr[data-self="true"] td:last-child')), bloodPts);
  d.assertClean();
  b.assertClean();
  await b.close();
  await d.close();
});

test('blood: quitting a run keeps solved points; zero-solve quit goes home; a new run can start', async () => {
  const { d } = await fakeClockDevice(H.createBackend(), 'Quit Quin');
  const { page } = d;
  await H.startBlood(page);
  await H.quitRound(page);
  await d.waitScreen('home');
  assert.equal((await save(page)).runs.length, 0, 'a run with no solve leaves no run entry');
  await H.startBlood(page);
  await solveOneBlood(page);
  await H.quitRound(page);
  await d.waitScreen('result');
  await page.clock.runFor(400); // the outcome line is written 250 ms after the screen shows (so it is announced)
  assert.match(await page.textContent('[data-screen="result"] [data-out="msg"]'), /Run ended/);
  assert.equal((await save(page)).runs.length, 1);
  await page.click('[data-screen="result"] [data-action="retry"]');
  await d.waitScreen('play');
  assert.equal(await timerText(page), '3:00', 'a new run starts a fresh countdown');
  assert.equal(await page.textContent(sel.puzzleNo), '#1');
  d.assertClean();
  await d.close();
});

test('blood constants in the UI copy come from config.js (3:00, x2, -5 s, -10 s)', async () => {
  assert.equal(BLOOD.durationMs, 180000);
  assert.equal(BLOOD.wrongPenaltyMs, 5000);
  assert.equal(BLOOD.skipPenaltyMs, 10000);
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend() });
  await H.signUp(d, 'Copy Cat');
  const desc = (await d.page.textContent('#home-blood-desc')).replace(/ /g, ' ');
  assert.match(desc, /3:00 countdown/);
  assert.match(desc, /×2 points/);
  assert.match(desc, /−5 s/);
  assert.match(desc, /−10 s/);
  d.assertClean();
  await d.close();
});

// F-04 (fixed by js/game/ownership.js): a real-clock reload mid-run must land back in the run, not bounce to Home as "another tab".
test('blood: an immediate reload mid-run resumes the run (does not bounce to Home as "another tab")', async () => {
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend() });
  const { page } = d;
  await H.signUp(d, 'Reloader');
  await H.waitSynced(page);
  await H.startBlood(page);
  await page.waitForTimeout(1500);
  await page.reload();
  await d.booted();
  assert.equal(await d.screen(), 'play', 'reload lands back in the run');
  await d.close();
});
