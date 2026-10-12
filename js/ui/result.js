// Result: a Classic puzzle or a Blood run summary. One big score, the result word as the h1, the Blood line (always
// worded as coming from Blood mode), two buttons. The points-earned list stays in the DOM as hidden text. No button
// ever offers replaying a solved seed.

import { formatNumber, getLang, t } from '../i18n/index.js';
import { derive } from '../sync/index.js';
import { $, $$, el, ltr, onAction } from './dom.js';
import { countDuration, countUp } from './countup.js';
import { prefersReducedMotion } from './motion.js';

/** @param {any} app */
export function createResult(app) {
  const { doc, win, sync, store } = app;
  const root = app.sections.result;
  const linesEl = $(root, '[data-slot="result-lines"]');
  const nextBtn = $(root, '[data-action="next"]');
  const retryBtn = $(root, '[data-action="retry"]');
  const msgEl = $(root, '[data-out="msg"]'); // the h1: the result word IS the heading, and the router focuses it
  const scoreEl = $(root, '[data-out="score"]');
  const bloodEl = $(root, '[data-out="bloodpoints"]');
  const bloodLine = bloodEl && bloodEl.closest('p');
  const solvedEl = $(root, '[data-out="solved"]');
  const pbEl = $(root, '[data-pb]');
  const pbLine = pbEl && pbEl.closest('p');
  const answerEl = $(root, '[data-out="answer"]');
  const scoreSr = $(root, '[data-live="score-sr"]');
  /** @type {Array<() => void>} running count-ups */
  let cancels = [];
  let srTimer = 0;
  let announcedFor = '';

  const n = (x) => formatNumber(x);
  const line = (key, params, mode) => {
    const li = el('li', {}, t(key, params));
    if (mode) li.dataset.mode = mode;
    return li;
  };

  function stopCounting() {
    for (const c of cancels) c();
    cancels = [];
    clearTimeout(srTimer);
  }

  /**
   * Show `final` in `out`. The element ALWAYS holds the final text at once (screen readers and anything reading the DOM
   * see the truth); the count-up runs on an aria-hidden visual copy placed next to it while the real node is
   * visually hidden. Reduced motion, a zero score, or no `animate` means no copy at all.
   */
  function showNumber(out, final, animate, delay) {
    if (!out) return;
    const text = n(final);
    if (out.textContent !== text) out.textContent = text; // identical rewrites would re-announce
    if (!animate || !(final > 0) || prefersReducedMotion(win)) return;
    const copy = doc.createElement('span');
    copy.setAttribute('aria-hidden', 'true');
    copy.className = 'lp-count';
    copy.textContent = n(0);
    out.after(copy);
    out.classList.add('visually-hidden');
    let cancel = () => {};
    const end = () => {
      copy.remove();
      out.classList.remove('visually-hidden');
    };
    const timer = setTimeout(() => {
      cancel = countUp({
        to: final,
        ms: countDuration(final),
        now: () => win.performance.now(),
        raf: (f) => win.requestAnimationFrame(f),
        caf: (id) => win.cancelAnimationFrame(id),
        onFrame: (v) => {
          copy.textContent = n(v);
        },
        onDone: end,
      });
    }, delay);
    cancels.push(() => {
      clearTimeout(timer);
      cancel();
      end();
    });
  }

  function bloodLines(r) {
    const save = sync.getSave();
    const solved = save ? save.history.filter((e) => e.r === r.runId) : [];
    return [
      line('result.line.bloodTotal', { points: n(r.points) }, 'blood'),
      line('result.line.bloodSolved', { count: r.solved }, 'blood'),
      ...solved.map((e, i) => line('result.line.bloodPuzzle', { n: i + 1, difficulty: t('diff.' + e.d), points: n(e.pts) }, 'blood')),
    ];
  }

  /** @param {boolean} [entering] true when the screen has just been shown: count up and announce */
  function render(entering) {
    const r = store.get().result;
    if (!r) return;
    const blood = r.mode === 'blood';
    doc.body.dataset.mode = r.mode;
    for (const b of $$(root, '[data-mode-badge]')) b.textContent = t('mode.' + r.mode);
    for (const h of $$(root, '[data-lock]')) h.dataset.lock = blood ? 'idle' : 'success';

    const pb = blood && r.points > r.prevBest && r.points > 0;
    const word = blood ? t(r.quit ? 'result.msg.bloodQuit' : 'result.msg.blood') : t('result.msg.classic');
    // Written before the router focuses the h1, so the first thing announced is the outcome.
    if (msgEl.textContent !== word) msgEl.textContent = word;
    msgEl.dataset.tone = blood ? 'info' : 'ok';

    if (entering) stopCounting();
    showNumber(scoreEl, r.points, entering, 0);
    if (bloodLine) bloodLine.hidden = !blood;
    if (blood) showNumber(bloodEl, r.points, entering, 160);
    if (solvedEl) {
      solvedEl.hidden = !blood;
      solvedEl.textContent = blood ? t('result.solved', { count: n(r.solved) }) : '';
    }
    if (pbLine) pbLine.hidden = !pb;
    if (answerEl) {
      answerEl.hidden = true; // a code reveal is only for a failure, and the engine never reveals a forfeited puzzle
      answerEl.textContent = '';
    }

    // The final score is announced once (the visual node may be mid-count): after the screen is up, not before.
    const key = `${r.mode}:${r.points}:${blood ? r.runId : r.id}`;
    if (entering && scoreSr && announcedFor !== key) {
      announcedFor = key;
      scoreSr.textContent = '';
      srTimer = setTimeout(() => {
        scoreSr.textContent = `${n(r.points)} ${t('result.score')}`;
      }, 250);
    }

    const d = derive(sync.getSave());
    const lines = blood
      ? bloodLines(r)
      : [
          line('result.line.classic', { id: ltr(getLang(), r.id), points: n(r.points) }, 'classic'),
          ...(r.code ? [line('result.line.code', { code: ltr(getLang(), r.code.join(' ')) }, 'classic')] : []),
        ];
    lines.push(
      line('result.line.totalClassic', { points: n(d.classic) }, 'classic'),
      line('result.line.totalBlood', { points: n(d.blood) }, 'blood'),
      line('result.line.total', { points: n(d.total) }),
    );
    linesEl.replaceChildren(...lines);

    // Next is Classic-only (new seed, same difficulty); Again is Blood-only (new run). Neither replays a solved seed.
    nextBtn.closest('li').hidden = blood;
    retryBtn.closest('li').hidden = !blood;
  }

  onAction(root, {
    next: () => {
      const r = store.get().result;
      if (r && r.mode === 'classic') void app.startClassic(r.difficulty);
    },
    retry: () => void app.startBlood(),
    'go-home': () => void app.router.go('home'),
  });

  return {
    enter: () => render(true),
    leave: stopCounting,
    rerender: () => !root.hidden && render(false),
    refresh: () => !root.hidden && render(false),
  };
}
