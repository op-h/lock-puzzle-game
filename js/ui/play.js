// Play screen: dials, keypad, clues, Classic and Blood rounds. The game rules live in js/game/*; this file
// only turns them into DOM and input. Loaded on demand (it pulls in the puzzle engine).

import { BLOOD, SCORING } from '../config.js';
import { randomSeed } from '../engine/rng.js';
import { createClock } from '../game/clock.js';
import { createClassic } from '../game/classic.js';
import { createBlood, toRunEntry } from '../game/blood.js';
import { createOwnership } from '../game/ownership.js';
import { createProgress, isForeignActive, reconcileRunSummary, restoreBlood, restoreClassic, sanitizeProgress } from '../game/progress.js';
import { clueText, feedbackText, formatDuration, formatNumber, getLang, t } from '../i18n/index.js';
import { derive } from '../sync/index.js';
import { $, $$, asciiDigit, closeDialog, el, isDisabled, isRtl, ltr, onAction, openDialog, say, setDigits, setDisabled, setOut } from './dom.js';

const SR_MARKS = [120, 60, 30, 10, 0];
// Blood writes a heartbeat this often so another tab can tell a live run from an abandoned one (stale after 6 s).
const HEARTBEAT_MS = 2000;
const PERSIST_EVERY_MS = 5000;
// A repeating 250 ms timer that wakes up this late was throttled or frozen: treat it like a visibility change.
const TIMER_GAP_MS = 2000;
const WRONG_FLASH_MS = 1500;
const SHAKE_MS = 700;
const SOLVE_PAUSE_MS = 1100;
const KEYPAD = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

/** @param {any} app */
export function createPlay(app) {
  const { doc, win, sync, local, store } = app;
  // The monotonic clock is only needed once a round exists, so it is created here, not at boot.
  app.clock ??= createClock();
  const root = app.sections.play;
  const dialsEl = $(root, '[data-slot="dials"]');
  const keypadEl = $(root, '[data-slot="keypad"]');
  const cluesEl = $(root, '[data-slot="clues"]');
  const timerEl = $(root, '[data-out="timer"]');
  const timerWrap = timerEl.parentElement;
  const barEl = $(root, '[data-timer-bar]');
  const srEl = $(root, '[data-live="timer-sr"]');
  const checkBtn = $(root, '[data-action="check"]');
  const hintBtn = $(root, '[data-action="hint"]');
  const skipBtn = $(root, '[data-action="skip"]');
  const quitDlg = $(doc, '[data-dialog="confirm-quit"]');
  const attemptsDt = $(root, '[data-i18n="play.attempts"]');

  // Wrong guesses are listed under the dials. The markup has no slot for it yet, so make one next to the keypad.
  let attemptsEl = $(root, '[data-slot="attempts"]');
  if (!attemptsEl) {
    attemptsEl = el('ol', { 'data-slot': 'attempts' });
    keypadEl.after(attemptsEl);
  }

  /** @type {null | {mode: 'classic'|'blood', s: any, entered: boolean, finishing: boolean, completed: boolean, marks: Set<number>, lastSec: number, lastPersist: number, msgShown: boolean}} */
  let round = null;
  let digits = [];
  let sel = 0;
  let locked = -1;
  let flash = null;
  let dialEls = [];
  let tickId = null;
  const timers = { flash: 0, lock: 0, result: 0 };

  const NO_PROGRESS = { save: () => false, load: () => null, clear() {} };
  /** After logout there is no session id: nothing may be written under any key. */
  const progress = () => {
    const sess = store.get().session;
    return sess ? createProgress(local, sess.id) : NO_PROGRESS;
  };
  const puzzleOf = () => (round.mode === 'classic' ? round.s.puzzle : round.s.puzzle());
  const lang = () => getLang();

  // ---- persistence ----
  const sessionId = () => {
    const sess = store.get().session;
    return sess ? sess.id : null;
  };
  // Heartbeat / release / re-acquire for the Blood run record (see game/ownership.js).
  const own = createOwnership({
    tabId: app.tabId,
    now: () => Date.now(),
    read: () => {
      const id = sessionId();
      return id ? sanitizeProgress(local.loadRun(id)) : null;
    },
    write: (rec) => progress().save(rec),
  });
  /** Another tab holds a Blood run with a fresh heartbeat. */
  function foreignRun() {
    try {
      return own.foreignActive();
    } catch {
      return false;
    }
  }

  /** @param {boolean} [release] on pagehide: hand the Blood run back (heartbeat 0) so a reload is not "another tab" */
  function persist(release) {
    if (!round || round.completed) return;
    try {
      const snap = round.s.snapshot();
      if (round.mode === 'blood') {
        const r = release ? own.release(snap) : own.beat(snap);
        if (r === 'foreign') {
          // We lost ownership (this tab was frozen/asleep and another one took the run over): stop, never fight over it.
          app.toast('home.blood.otherTab', 'info');
          drop();
          void app.router.go('home');
        }
        return; // 'released': the page is going away or in the bfcache; a later visibilitychange must not undo it
      }
      if (!foreignRun()) progress().save(snap); // a Classic round must not overwrite another tab's live Blood record
    } catch {
      // storage trouble must never interrupt play
    }
  }

  // ---- rendering ----
  function setLock(state) {
    for (const n of $$(root, '[data-lock]')) n.dataset.lock = state;
  }

  function paintDials() {
    const n = digits.length;
    dialEls.forEach((b, i) => {
      const v = digits[i];
      b.textContent = v === null ? '' : String(v);
      b.dataset.state = flash || (i === sel ? 'selected' : v === null ? 'idle' : 'filled');
      b.tabIndex = i === sel ? 0 : -1;
      const p = { pos: i + 1, total: n, value: v === null ? '' : v };
      let label = t(i === locked ? 'play.dial.locked' : v === null ? 'play.dial.empty' : 'play.dial.value', p);
      if (flash) label = t('play.dial.suffix', { base: label, state: t('play.dial.' + flash) });
      b.setAttribute('aria-label', label);
      if (i === locked) b.setAttribute('aria-disabled', 'true');
      else b.removeAttribute('aria-disabled');
    });
    // aria-disabled, not `disabled`: the button stays focusable and announced, and focus is never dropped to <body>.
    setDisabled(checkBtn, !round || round.finishing || digits.some((d) => d === null));
  }

  function clueItem(c, i) {
    const li = el('li', { 'data-kind': c.kind });
    li.dataset.n = String(i + 1);
    if (c.kind === 'compare') li.dataset.rel = c.rel;
    if (c.kind === 'feedback') {
      for (const d of c.guess) li.append(el('span', { class: 'digit', 'aria-hidden': 'true' }, String(d)));
      // One pip per matching digit and nothing for misses: shape (filled/hollow) carries the meaning.
      for (let k = 0; k < c.bulls; k++) li.append(el('span', { 'data-pip': 'right', 'aria-hidden': 'true' }));
      for (let k = 0; k < c.cows; k++) li.append(el('span', { 'data-pip': 'wrong', 'aria-hidden': 'true' }));
      // Screen readers get the full clueText(): the guess prefix is visually hidden because the digit boxes already show it.
      const prefix = t('clue.fb.full', { guess: ltr(lang(), c.guess.join(' ')), result: '' }).trim();
      li.append(el('span', { class: 'clue-text' }, el('span', { class: 'visually-hidden' }, prefix + ' '), feedbackText(c.bulls, c.cows)));
    } else {
      li.append(el('span', { class: 'clue-text' }, clueText(c)));
    }
    return li;
  }

  function renderAttempts() {
    if (!round) return;
    const guesses = round.s.wrongGuesses();
    attemptsEl.setAttribute('aria-label', t('play.attempts.list'));
    attemptsEl.replaceChildren(
      ...guesses.map((g) => el('li', { dir: 'ltr' }, g.join(' '))),
    );
    setOut(root, 'attempts-left', formatNumber(guesses.length));
  }

  /** @param {boolean} [refocus] true for in-round rebuilds: the dials are replaced, so focus must not fall to <body> */
  function buildPuzzle(refocus) {
    const a = doc.activeElement;
    const hadFocus = refocus && (!a || a === doc.body || dialsEl.contains(a));
    const p = puzzleOf();
    digits = Array(p.length).fill(null);
    locked = -1;
    flash = null;
    const rev = round.mode === 'classic' ? round.s.revealed() : null;
    if (rev) {
      locked = rev.pos;
      digits[rev.pos] = rev.digit;
    }
    sel = Math.max(0, digits.indexOf(null));
    // The dial row and keypad stay left-to-right in Arabic (digits are Latin); say so explicitly.
    dialsEl.dir = 'ltr';
    keypadEl.dir = 'ltr';
    dialsEl.style.setProperty('--lp-n', String(p.length));
    dialEls = digits.map((_, i) => el('button', { type: 'button', 'data-dial': String(i) }));
    dialsEl.replaceChildren(...dialEls);
    if (keypadEl.children.length === 0) {
      keypadEl.replaceChildren(...KEYPAD.map((d) => el('button', { type: 'button', 'data-digit': String(d) }, String(d))));
    }
    cluesEl.replaceChildren(...p.clues.map(clueItem));
    setOut(root, 'puzzle-no', round.mode === 'classic' ? p.id : `#${formatNumber(p.n)}`);
    // The no-repeat rule is stated where the player looks while guessing: "Rookie · 3 digits, all different".
    setOut(
      root,
      'difficulty',
      t(p.repeats ? 'play.diffline.repeat' : 'play.diffline.distinct', { name: t('diff.' + p.difficulty), digits: t('diff.digits', { count: p.length }) }),
    );
    renderAttempts();
    paintDials();
    if (hadFocus && dialEls[sel]) dialEls[sel].focus();
  }

  function paintMode() {
    const blood = round.mode === 'blood';
    doc.body.dataset.mode = round.mode;
    setOut(root, 'timer', ''); // reset cache below
    delete timerEl.dataset.v;
    for (const b of $$(root, '[data-mode-badge]')) b.textContent = t('mode.' + round.mode);
    // Blood has no per-puzzle wrong-guess row (the clock is the penalty), no hints; Classic has no skip.
    attemptsDt.hidden = blood;
    attemptsDt.nextElementSibling.hidden = blood;
    skipBtn.closest('li').hidden = !blood;
    hintBtn.closest('li').hidden = blood;
    barEl.hidden = !blood;
    paintHint();
  }

  function paintHint() {
    setDisabled(hintBtn, !round || round.mode !== 'classic' || round.finishing || round.s.usedHint());
  }

  function renderTimer() {
    if (!round) return;
    if (round.mode === 'blood') {
      const rem = round.s.remainingMs();
      setDigits(timerEl, formatDuration(Math.ceil(rem / 1000)));
      const phase = rem <= 10000 ? 'last10' : rem <= 30000 ? 'last30' : 'normal';
      barEl.dataset.phase = phase;
      barEl.style.setProperty('--lp-timer-left', String(Math.min(18, Math.ceil(rem / 10000))));
      timerWrap.dataset.phase = phase;
      if (rem <= 30000) timerWrap.dataset.urgent = 'true';
      else delete timerWrap.dataset.urgent;
    } else {
      setDigits(timerEl, formatDuration(Math.floor(round.s.elapsedMs() / 1000)));
      delete timerWrap.dataset.urgent;
      timerWrap.dataset.phase = 'normal';
    }
  }

  /** Screen-reader announcements at 2:00, 1:00, 0:30, 0:10 and 0:00 only; a jump over several marks says the latest once. */
  function announce(silent) {
    const secs = Math.ceil(round.s.remainingMs() / 1000);
    const crossed = SR_MARKS.filter((m) => secs <= m && !round.marks.has(m));
    if (crossed.length === 0) return;
    for (const m of crossed) round.marks.add(m);
    if (silent) return;
    const m = Math.min(...crossed);
    srEl.textContent = m === 0 ? t('play.timer.sr.zero') : t('play.timer.sr', { time: formatDuration(m) });
  }

  // ---- input ----
  function clearFlash() {
    if (!flash && !timers.lock) return;
    flash = null;
    clearTimeout(timers.flash);
    clearTimeout(timers.lock);
    timers.lock = 0;
    setLock('idle');
  }

  const nextEmptyAfter = (i) => {
    for (let k = 1; k <= digits.length; k++) {
      const j = (i + k) % digits.length;
      if (digits[j] === null) return j;
    }
    return i;
  };

  function select(i, focus) {
    sel = Math.max(0, Math.min(digits.length - 1, i));
    paintDials();
    if (focus && dialEls[sel]) dialEls[sel].focus();
  }

  function typeDigit(d) {
    if (!round || round.finishing) return;
    clearFlash();
    if (sel === locked) {
      const n = nextEmptyAfter(sel);
      if (n === sel) return; // everything but the locked digit is filled: pick a dial to change
      sel = n;
    }
    digits[sel] = d;
    app.sound.play('key');
    sel = nextEmptyAfter(sel);
    paintDials();
  }

  function backspace() {
    if (!round || round.finishing) return;
    clearFlash();
    if (sel !== locked && digits[sel] !== null) digits[sel] = null;
    else {
      let j = sel - 1;
      if (j === locked) j -= 1;
      if (j >= 0) {
        sel = j;
        digits[sel] = null;
      }
    }
    paintDials();
  }

  function clearAll() {
    if (!round || round.finishing) return;
    clearFlash();
    digits = digits.map((d, i) => (i === locked ? d : null));
    sel = Math.max(0, digits.indexOf(null));
    paintDials();
  }

  // ---- actions ----
  function afterAction() {
    if (round && round.mode === 'blood' && round.s.isEnded()) completeBlood({});
  }

  function wrongFeedback() {
    flash = 'wrong';
    paintDials();
    setLock('fail');
    app.sound.play('wrong');
    app.sound.vibrate(80);
    clearTimeout(timers.lock);
    timers.lock = win.setTimeout(() => {
      timers.lock = 0;
      setLock('idle');
    }, SHAKE_MS);
    clearTimeout(timers.flash);
    timers.flash = win.setTimeout(() => {
      flash = null;
      paintDials();
    }, WRONG_FLASH_MS);
  }

  function check() {
    if (!round || round.finishing) return;
    if (digits.some((d) => d === null)) {
      say(root, t('play.msg.incomplete'), 'info');
      return;
    }
    const r = round.s.submit(digits.slice());
    if (!r.ok) {
      if (r.reason === 'incomplete' || r.reason === 'length') say(root, t('play.msg.incomplete'), 'info');
      // Free: nothing was counted, no attempt was listed, and in Blood the clock was not touched.
      else if (r.reason === 'repeat') say(root, t('play.msg.repeat'), 'info');
      afterAction();
      return;
    }
    if (r.dup) {
      say(root, t('play.msg.dup'), 'info');
      return;
    }
    if (round.mode === 'classic') {
      if (r.solved) return completeClassic(r);
      renderAttempts();
      wrongFeedback();
      say(root, t('play.msg.wrong', { count: r.wrong }), 'bad');
      persist();
      return;
    }
    if (r.solved) {
      app.sound.play('solve');
      // Same label as the result screen: Blood points are always named as such.
      say(root, t('play.msg.solvedBlood', { points: formatNumber(r.points) }), 'ok');
      setLock('success');
      clearTimeout(timers.lock);
      timers.lock = win.setTimeout(() => {
        timers.lock = 0;
        setLock('idle');
      }, SHAKE_MS);
      buildPuzzle(true);
      persist();
      renderTimer();
      return;
    }
    renderAttempts();
    wrongFeedback();
    say(root, t('play.msg.wrongBlood', { seconds: BLOOD.wrongPenaltyMs / 1000 }), 'bad');
    persist();
    renderTimer();
    announce(false);
    afterAction();
  }

  function skip() {
    if (!round || round.finishing || round.mode !== 'blood') return;
    const r = round.s.skip();
    if (r.ok && !r.ended) {
      say(root, t('play.msg.skipBlood', { seconds: BLOOD.skipPenaltyMs / 1000 }), 'bad');
      app.sound.play('wrong');
      buildPuzzle(true);
      persist();
      renderTimer();
      announce(false);
    }
    afterAction();
  }

  function hint() {
    if (!round || round.finishing || round.mode !== 'classic' || isDisabled(hintBtn)) return;
    const r = round.s.hint(digits);
    if (!r.ok || r.already) return;
    clearFlash();
    locked = r.pos;
    digits[r.pos] = r.digit;
    if (sel === locked) sel = nextEmptyAfter(sel);
    say(root, t('play.msg.hint', { pos: r.pos + 1, digit: r.digit, hintPct: String(Math.round(SCORING.hintFactor * 100)) }), 'info');
    paintDials();
    paintHint();
    persist();
  }

  function stopLoop() {
    if (tickId !== null) win.clearInterval(tickId);
    tickId = null;
  }

  function completeClassic(r) {
    round.finishing = true;
    round.completed = true;
    stopLoop();
    flash = 'correct';
    paintDials();
    setLock('success');
    paintHint();
    app.sound.play('solve');
    say(root, t('play.msg.solved', { points: formatNumber(r.points) }), 'ok', { sticky: true });
    sync.recordSolve({ id: r.id, m: 'c', d: r.difficulty, pts: r.points, s: r.secs, w: r.wrong, h: r.usedHint ? 1 : 0 });
    progress().clear();
    const result = {
      mode: 'classic',
      id: r.id,
      difficulty: r.difficulty,
      points: r.points,
      secs: r.secs,
      wrong: r.wrong,
      usedHint: r.usedHint,
      code: round.s.answerIfSolved(),
    };
    store.set({ round: null, result });
    // A beat on the open lock before the result: the success state is the payoff, not the navigation.
    clearTimeout(timers.result);
    timers.result = win.setTimeout(() => void app.router.go('result'), SOLVE_PAUSE_MS);
  }

  /** Blood ended by expiry, a fatal wrong guess/skip, or the player quitting. */
  function completeBlood({ quit = false, silent = false }) {
    if (!round || round.completed) return;
    round.completed = true;
    round.finishing = true;
    stopLoop();
    closeDialog(quitDlg); // the run just ended under an open "Quit?" prompt: it no longer has anything to ask
    const s = round.s;
    const summary = s.finish();
    const prevBest = derive(sync.getSave()).bestRun;
    if (summary.solved > 0) sync.recordRun(toRunEntry(summary));
    progress().clear();
    store.set({ round: null });
    if (silent) return;
    app.sound.play('end');
    if (summary.solved === 0 && quit) {
      void app.router.go('home');
      return;
    }
    store.set({ result: { mode: 'blood', runId: summary.runId, solved: summary.solved, points: summary.points, prevBest, quit } });
    void app.router.go('result');
  }

  function quitRound() {
    if (!round) return;
    if (round.mode === 'blood') {
      completeBlood({ quit: true });
      return;
    }
    round.completed = true;
    stopLoop();
    progress().clear();
    store.set({ round: null });
    void app.router.go('home');
  }

  // ---- loop, visibility, keyboard ----
  function tick() {
    if (!round || round.finishing) return;
    // Late timer = throttled or frozen page. Deadlines are re-read from the monotonic clock below anyway; also
    // persist right away so the heartbeat and the stored remaining time are fresh.
    if (app.clock.beat() > TIMER_GAP_MS) {
      app.clock.resync();
      round.lastPersist = 0;
    }
    const now = app.clock.now();
    if (round.mode === 'blood') {
      const st = round.s.tick();
      renderTimer();
      const secs = Math.ceil(st.remainingMs / 1000);
      if (!st.ended && secs <= 10 && secs > 0 && secs !== round.lastSec) app.sound.play('tick');
      round.lastSec = secs;
      announce(false);
      afterAction();
    } else if (!doc.hidden) renderTimer();
    if (!round || round.completed) return;
    if (now - round.lastPersist >= (round.mode === 'blood' ? HEARTBEAT_MS : PERSIST_EVERY_MS)) {
      round.lastPersist = now;
      persist();
    }
  }

  function onVisibility() {
    if (!round || !round.entered || round.completed) return;
    // The classic clock never pauses: hiding the tab changes nothing about the score.
    if (doc.hidden) persist();
    else {
      app.clock.resync();
      tick();
      renderTimer();
    }
  }

  const onPageHide = () => persist(true);
  // Coming back from the bfcache: this page is live again, so it may beat (and will notice if another tab took over).
  function onPageShow(e) {
    if (e && e.persisted) own.reacquire();
    onVisibility();
  }

  const pressed = new Set();
  function onKeyDown(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !round) return;
    const tg = e.target instanceof Element ? e.target : null;
    if (tg && tg.closest('input, textarea, select')) return;
    if (doc.querySelector('dialog[open]')) return;
    const onDial = !!(tg && tg.closest('[data-slot="dials"]'));
    const dg = asciiDigit(e.key); // Arabic-Indic and Eastern Arabic keyboards send their own digit glyphs
    if (dg !== null) {
      e.preventDefault();
      typeDigit(dg);
      const k = $(keypadEl, `[data-digit="${dg}"]`);
      if (k) {
        k.setAttribute('data-pressed', '');
        pressed.add(k);
      }
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      backspace();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      if (!round.finishing && sel !== locked) {
        clearFlash();
        digits[sel] = null;
        paintDials();
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      // "Left" means visually left; the row's own computed direction decides which index that is.
      const dirSign = (e.key === 'ArrowRight' ? 1 : -1) * (isRtl(dialsEl) ? -1 : 1);
      select(sel + dirSign, onDial);
    } else if (e.key === 'Enter') {
      // Enter checks unless it would activate a control (the router parks focus on the h1, which is not one).
      const plain = !tg || onDial || !tg.closest('button, a[href], summary, [role="tab"]');
      if (plain) {
        e.preventDefault();
        check();
      }
    }
    // Escape is deliberately absent: it must never destroy a round.
  }

  function onKeyUp() {
    for (const k of pressed) k.removeAttribute('data-pressed');
    pressed.clear();
  }

  // ---- delegated clicks ----
  onAction(
    root,
    {
      check,
      clear: clearAll,
      skip,
      hint,
      quit: () => openDialog(quitDlg),
    },
    (target) => {
      const dial = target.closest('[data-dial]');
      if (dial) return select(Number(dial.getAttribute('data-dial')), true);
      const key = target.closest('[data-digit]');
      if (key) typeDigit(Number(key.getAttribute('data-digit')));
    },
    // A click on an aria-disabled Check is still useful feedback: say why it does nothing.
    (btn) => {
      if (btn.getAttribute('data-action') === 'check' && round && !round.finishing) say(root, t('play.msg.incomplete'), 'info');
    },
  );
  onAction(quitDlg, {
    quit: () => {
      closeDialog(quitDlg);
      quitRound();
    },
  });

  // ---- lifecycle ----
  function begin(mode, s) {
    clearTimeout(timers.result);
    own.reacquire(); // a new round on this live page always owns its own record
    round = { mode, s, entered: false, finishing: false, completed: false, marks: new Set(), lastSec: -1, lastPersist: app.clock.now(), msgShown: false };
    store.set({ round: { mode }, result: null });
    persist();
  }

  const onSolveHook = (entry) => void sync.recordSolve(entry);

  return {
    startClassic(difficulty) {
      if (foreignRun()) return refuseForeign();
      abandon();
      begin('classic', createClassic({ difficulty, now: app.clock.now, wall: () => Date.now(), newSeed: randomSeed }));
      return app.router.go('play');
    },
    startBlood() {
      if (foreignRun()) return refuseForeign();
      abandon();
      begin('blood', createBlood({ now: app.clock.now, wall: () => Date.now(), newSeed: randomSeed, onSolve: onSolveHook }));
      return app.router.go('play');
    },

    /**
     * Continue whatever was in progress before the reload.
     * @returns {'play'|'result'|'other-tab'|null} where the player should land
     */
    restore(raw, save) {
      const rec = sanitizeProgress(raw);
      if (!rec) {
        progress().clear();
        return null;
      }
      const history = save && Array.isArray(save.history) ? save.history : [];
      // Another tab is playing this run right now: leave its record alone and do not play it twice.
      if (isForeignActive(rec, app.tabId, Date.now())) return 'other-tab';
      if (rec.mode === 'classic') {
        const s = restoreClassic(rec, { now: app.clock.now, wall: () => Date.now(), isSolved: (id) => history.some((e) => e.id === id) });
        if (!s) {
          progress().clear();
          return null;
        }
        begin('classic', s);
        return 'play';
      }
      // A solve whose progress write was lost still sits in history; never reuse its `<runId>:<n>` id.
      let n = 0;
      let pts = 0;
      for (const e of history) if (e.r === rec.runId) (n += 1), (pts += e.pts);
      if (n > rec.solvedInRun || pts > rec.points) {
        rec.solvedInRun = Math.max(rec.solvedInRun, n);
        rec.points = Math.max(rec.points, pts);
        rec.puzzle = null;
      }
      const out = restoreBlood(rec, { now: app.clock.now, wall: () => Date.now(), newSeed: randomSeed, onSolve: onSolveHook });
      if (!out) {
        progress().clear();
        return null;
      }
      if (out.expired) {
        const run = reconcileRunSummary(out.summary, save);
        const prevBest = derive(save).bestRun;
        if (run.solved > 0) sync.recordRun(run);
        progress().clear();
        store.set({ round: null, result: { mode: 'blood', runId: run.id, solved: run.solved, points: run.pts, prevBest, quit: false } });
        return 'result';
      }
      begin('blood', out.session);
      return 'play';
    },

    /** End the round without navigating (logout, starting another round). */
    abandon,
    drop,
    askQuit: () => openDialog(quitDlg),
    isActive: () => !!round && !round.completed,

    enter() {
      if (!round) return;
      round.entered = true;
      paintMode();
      buildPuzzle();
      setLock('idle');
      say(root, '', 'info');
      if (round.mode === 'blood') {
        say(root, t('play.msg.bloodStart', { wrongPen: BLOOD.wrongPenaltyMs / 1000, skipPen: BLOOD.skipPenaltyMs / 1000 }), 'info', { ms: 6000 });
        srEl.textContent = '';
        announce(true);
      }
      renderTimer();
      stopLoop();
      tickId = win.setInterval(tick, 250);
      doc.addEventListener('keydown', onKeyDown);
      doc.addEventListener('keyup', onKeyUp);
      doc.addEventListener('visibilitychange', onVisibility);
      win.addEventListener('pagehide', onPageHide);
      win.addEventListener('pageshow', onPageShow);
    },
    leave() {
      stopLoop();
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('keyup', onKeyUp);
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('pagehide', onPageHide);
      win.removeEventListener('pageshow', onPageShow);
      clearTimeout(timers.flash);
      clearTimeout(timers.lock);
      clearTimeout(timers.result);
      timers.lock = 0;
    },
    rerender() {
      if (!round || root.hidden) return;
      const keepDigits = digits.slice();
      const keepSel = sel;
      const a = doc.activeElement;
      const hadFocus = !a || a === doc.body || dialsEl.contains(a);
      paintMode();
      buildPuzzle();
      digits = keepDigits;
      sel = keepSel;
      paintDials();
      renderTimer();
      if (hadFocus) dialEls[sel].focus();
    },
  };

  function refuseForeign() {
    app.toast('home.blood.otherTab', 'info');
    return Promise.resolve(false);
  }

  /** The account is gone (another tab logged out): stop everything and write NOTHING. */
  function drop() {
    stopLoop();
    if (round) {
      round.completed = true;
      round.finishing = true;
    }
    round = null;
    store.set({ round: null });
  }

  function abandon() {
    if (!round || round.completed) {
      round = null;
      return;
    }
    if (round.mode === 'blood') completeBlood({ silent: true });
    else {
      round.completed = true;
      progress().clear();
    }
    stopLoop();
    store.set({ round: null });
    round = null;
  }
}
