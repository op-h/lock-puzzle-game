// 3b. Classic mode: real solve from the engine's brute-forced answer, scoring, dup guess, hint, next, no replay.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './support/harness.mjs';
import { puzzleScore } from '../../js/engine/scoring.js';
import { DIFFICULTIES } from '../../js/config.js';

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

const lastSolve = (page) =>
  page.evaluate(() => {
    const sess = JSON.parse(localStorage.getItem('lp1.session'));
    const save = JSON.parse(localStorage.getItem('lp1.save.' + sess.id));
    return save.history.at(-1);
  });
const history = (page) =>
  page.evaluate(() => {
    const sess = JSON.parse(localStorage.getItem('lp1.session'));
    return JSON.parse(localStorage.getItem('lp1.save.' + sess.id)).history;
  });

test('classic: play screen shape, dup guess is free, solve scores exactly puzzleScore(), result is labelled Classic', async () => {
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend() });
  const { page } = d;
  await H.signUp(d, 'Classic Carl');
  await H.startClassic(page, 'rookie');

  // screen shape
  assert.equal(await page.textContent('[data-screen="play"] [data-mode-badge]'), 'Classic');
  assert.equal(await page.getAttribute('body', 'data-mode'), 'classic');
  assert.equal((await H.dialValues(page)).length, 3);
  assert.equal(await page.locator('[data-screen="play"] [data-slot="keypad"] button').count(), 10);
  assert.equal(await page.evaluate(() => document.activeElement.tagName + '#' + document.activeElement.id), 'H1#play-title', 'router focuses the h1');
  assert.equal(await page.getAttribute('[data-screen="play"] [data-action="check"]', 'aria-disabled'), 'true', 'Check is disabled with empty dials');
  // Classic has no skip button and no timer bar; hint exists
  assert.equal(await page.isVisible('[data-screen="play"] [data-action="skip"]'), false);
  assert.equal(await page.isVisible('[data-screen="play"] [data-action="hint"]'), true);
  assert.equal(await page.isVisible('[data-screen="play"] [data-timer-bar]'), false);

  const puzzle = await H.currentPuzzle(page);
  assert.equal(puzzle.length, 3);
  assert.equal(puzzle.solutions.length, 1, 'exactly one code satisfies every clue (brute force)');
  assert.deepEqual(puzzle.domFeedback, puzzle.engFeedback, 'on-screen feedback clues equal engine clues');
  assert.equal(puzzle.domClueCount, puzzle.clueCount);

  // wrong guess #1
  const w1 = H.wrongGuess(puzzle.answer, 0);
  await H.typeWithKeypad(page, w1);
  assert.deepEqual(await H.dialValues(page), w1.map(String));
  await H.pressCheck(page);
  await page.waitForFunction(() => /Wrong guesses: 1\./.test(document.querySelector('[data-screen="play"] [data-out="msg"]').textContent));
  assert.equal(await page.locator('[data-screen="play"] [data-slot="attempts"] li').count(), 1);
  assert.equal(await page.textContent('[data-screen="play"] [data-out="attempts-left"]'), '1');
  // the same wrong guess again: told so, no extra penalty, no extra row
  await H.typeWithKeypad(page, w1);
  await H.pressCheck(page);
  await page.waitForFunction(() => /already tried/.test(document.querySelector('[data-screen="play"] [data-out="msg"]').textContent));
  assert.equal(await page.locator('[data-screen="play"] [data-slot="attempts"] li').count(), 1, 'duplicate guess adds no row');
  assert.equal(await page.textContent('[data-screen="play"] [data-out="attempts-left"]'), '1', 'duplicate guess adds no penalty');

  // reload mid-round restores the same puzzle and its wrong guess
  await page.reload();
  await d.booted();
  await d.waitScreen('play');
  const again = await H.currentPuzzle(page);
  assert.equal(again.id, puzzle.id, 'reload resumes the same puzzle');
  assert.equal(await page.locator('[data-screen="play"] [data-slot="attempts"] li').count(), 1, 'wrong guess survived the reload');

  // solve
  await H.typeWithKeypad(page, puzzle.answer);
  await H.pressCheck(page);
  await d.waitScreen('result');
  const e = await lastSolve(page);
  assert.equal(e.m, 'c');
  assert.equal(e.d, 'rookie');
  assert.equal(e.w, 1, 'one distinct wrong guess counted (the duplicate was free)');
  assert.equal(e.h, 0);
  assert.equal(e.id, puzzle.id);
  assert.equal(e.pts, puzzleScore({ difficulty: 'rookie', secs: e.s, wrong: 1, usedHint: false, blood: false }), 'UI points == pure scoring function');
  assert.ok(e.pts > 0 && e.pts <= DIFFICULTIES.rookie.base * 2);

  // result screen
  assert.equal(await page.getAttribute('body', 'data-mode'), 'classic');
  assert.equal(await page.textContent('[data-screen="result"] [data-mode-badge]'), 'Classic');
  assert.equal(H.num(await page.textContent('[data-screen="result"] [data-out="score"]')), e.pts);
  const lines = await page.$$eval('[data-screen="result"] [data-slot="result-lines"] li', (l) => l.map((x) => x.textContent.trim()));
  assert.match(lines[0], new RegExp(`^Classic, puzzle ${puzzle.id}: \\+${e.pts}\\s?points`));
  assert.ok(lines.some((l) => l.startsWith('The code was ' + puzzle.answer.join(' '))), 'reveals the code after the solve');
  assert.ok(lines.some((l) => l === `Total Classic points: ${e.pts}`), lines.join(' | '));
  assert.ok(lines.some((l) => l === 'Total Blood points (from Blood mode): 0'));
  assert.ok(lines.some((l) => l === `Total points: ${e.pts}`));
  assert.equal(await page.isVisible('[data-screen="result"] dd[data-mode="blood"]'), false, 'no Blood row on a Classic result');
  assert.equal(await page.isVisible('[data-screen="result"] [data-action="retry"]'), false);
  assert.equal(await page.isVisible('[data-screen="result"] [data-action="next"]'), true);
  await page.waitForFunction(() => document.querySelector('[data-screen="result"] [data-out="msg"]').textContent.trim() === 'Lock opened.');
  d.assertClean();
  await d.close();
});

test('classic: hint halves the points; Next gives a fresh puzzle; a solved seed is never replayed', async () => {
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend() });
  const { page } = d;
  await H.signUp(d, 'Hint Hana');
  await H.startClassic(page, 'rookie');
  const p1 = await H.currentPuzzle(page);

  const hintBtn = '[data-screen="play"] [data-action="hint"]';
  assert.equal(await page.getAttribute(hintBtn, 'aria-disabled'), null);
  await page.click(hintBtn);
  await page.waitForFunction(() => /Hint used: dial \d is \d\./.test(document.querySelector('[data-screen="play"] [data-out="msg"]').textContent));
  assert.equal(await page.getAttribute(hintBtn, 'aria-disabled'), 'true', 'hint is single-use');
  const locked = await page.$$eval('[data-screen="play"] [data-slot="dials"] > button', (bs) =>
    bs.map((b, i) => ({ i, v: b.textContent.trim(), dis: b.getAttribute('aria-disabled'), label: b.getAttribute('aria-label') })).filter((x) => x.dis === 'true'));
  assert.equal(locked.length, 1, 'exactly one dial is revealed');
  assert.equal(Number(locked[0].v), p1.answer[locked[0].i], 'the revealed digit is the true digit');
  assert.match(locked[0].label, /revealed by hint/);
  // typing the full answer still works (locked dial is skipped by the keypad)
  await page.click('[data-screen="play"] [data-action="clear"]');
  const free = p1.answer.filter((_, i) => i !== locked[0].i);
  for (const dgt of free) await page.click(`[data-screen="play"] [data-slot="keypad"] [data-digit="${dgt}"]`);
  assert.deepEqual(await H.dialValues(page), p1.answer.map(String), 'locked digit kept, others filled');
  await H.pressCheck(page);
  await d.waitScreen('result');
  const e = await lastSolve(page);
  assert.equal(e.h, 1);
  assert.equal(e.w, 0);
  const noHint = puzzleScore({ difficulty: 'rookie', secs: e.s, wrong: 0, usedHint: false, blood: false });
  assert.equal(e.pts, puzzleScore({ difficulty: 'rookie', secs: e.s, wrong: 0, usedHint: true, blood: false }));
  assert.ok(Math.abs(e.pts - noHint / 2) <= 1, `hint halves: ${e.pts} vs ${noHint}/2`);

  // Next puzzle: new id, play screen, wrong-guess counter reset, hint available again
  const seen = new Set([p1.id]);
  for (let i = 0; i < 4; i++) {
    await page.click('[data-screen="result"] [data-action="next"]');
    await d.waitScreen('play');
    const p = await H.currentPuzzle(page);
    assert.ok(!seen.has(p.id), `Next never repeats a seen puzzle (${p.id})`);
    seen.add(p.id);
    assert.equal(await page.textContent('[data-screen="play"] [data-out="attempts-left"]'), '0');
    assert.equal(await page.getAttribute(hintBtn, 'aria-disabled'), null);
    await H.solveClassic(page);
  }
  assert.equal((await history(page)).length, 5);

  // no replay: a crash between "recorded" and "cleared" leaves a run record for a solved seed; it must be dropped
  const solved = await page.evaluate(async () => {
    const sess = JSON.parse(localStorage.getItem('lp1.session'));
    const h = JSON.parse(localStorage.getItem('lp1.save.' + sess.id)).history.at(-1);
    return { id: sess.id, puzzleId: h.id };
  });
  const seed = parseInt(solved.puzzleId.split('-')[1], 36);
  await page.evaluate(({ id, seed }) => {
    localStorage.setItem('lp1.run.' + id, JSON.stringify({ v: 1, mode: 'classic', difficulty: 'rookie', seed, guesses: [], usedHint: false, hintPos: null, elapsedMs: 0 }));
  }, { id: solved.id, seed });
  await page.goto(srv.url);
  await d.booted();
  assert.equal(await d.screen(), 'home', 'a solved seed is not restored into play');
  assert.equal(await page.evaluate((id) => localStorage.getItem('lp1.run.' + id), solved.id), null, 'stale run record is cleared');
  d.assertClean();
  await d.close();
});

test('classic: every difficulty is solvable from its clues; clue kinds render; no clue text is empty', async () => {
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend() });
  const { page } = d;
  await H.signUp(d, 'Variety Vic');
  const kindsSeen = new Set();
  for (const [diff, len] of [['rookie', 3], ['agent', 3], ['hacker', 4], ['master', 5]]) {
    await H.startClassic(page, diff);
    assert.equal((await H.dialValues(page)).length, len, `${diff}: ${len} dials`);
    assert.equal(await page.getAttribute('[data-screen="play"] [data-slot="dials"]', 'dir'), 'ltr');
    const texts = await page.$$eval('[data-screen="play"] [data-slot="clues"] > li', (l) => l.map((x) => ({ kind: x.dataset.kind, text: x.textContent.trim() })));
    for (const t of texts) {
      kindsSeen.add(t.kind);
      assert.ok(t.text.length > 8, `${diff} ${t.kind} clue has text: "${t.text}"`);
      assert.ok(!/\{|undefined|NaN|clue\./.test(t.text), `no raw placeholders in "${t.text}"`);
    }
    const { puzzle } = await H.solveClassic(page);
    assert.equal(puzzle.solutions.length, 1);
    await page.click('[data-screen="result"] [data-action="go-home"]');
    await d.waitScreen('home');
  }
  assert.ok(kindsSeen.has('feedback'));
  d.assertClean();
  await d.close();
});

test('classic: Quit asks first; Keep Playing returns focus to the Quit button; confirming goes home and scores nothing', async () => {
  const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend() });
  const { page } = d;
  await H.signUp(d, 'Quitter');
  await H.startClassic(page, 'rookie');
  await page.click('[data-screen="play"] [data-action="quit"]');
  await page.waitForSelector('dialog[data-dialog="confirm-quit"][open]');
  await page.keyboard.press('Escape'); // Esc is allowed to dismiss this one (nothing is lost by it)
  await page.waitForSelector('dialog[data-dialog="confirm-quit"]:not([open])', { state: 'attached' });
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'quit', 'focus returns to the trigger');
  await H.quitRound(page);
  await d.waitScreen('home');
  assert.equal((await H.homeTotals(page)).total, '0');
  assert.equal((await history(page)).length, 0);
  d.assertClean();
  await d.close();
});
