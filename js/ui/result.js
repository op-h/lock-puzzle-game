// Result: a Classic puzzle or a Blood run summary. Every line names its source, Blood points are always
// shown as their own line, and no button ever offers replaying a solved seed.

import { formatNumber, getLang, t } from '../i18n/index.js';
import { derive } from '../sync/index.js';
import { $, $$, el, ltr, onAction, setOut } from './dom.js';

/** @param {any} app */
export function createResult(app) {
  const { doc, sync, store } = app;
  const root = app.sections.result;
  const linesEl = $(root, '[data-slot="result-lines"]');
  const nextBtn = $(root, '[data-action="next"]');
  const retryBtn = $(root, '[data-action="retry"]');
  const stampIcon = $(root, '.lp-stamp svg');
  const bloodRows = $$(root, 'dl [data-mode="blood"]');
  const msgEl = $(root, '[data-out="msg"]');
  msgEl.setAttribute('role', 'status'); // set while hidden so the region exists before its text changes
  let msgTimer = 0;

  const n = (x) => formatNumber(x);
  const line = (key, params, mode) => {
    const li = el('li', {}, t(key, params));
    if (mode) li.dataset.mode = mode;
    return li;
  };

  function bloodLines(r) {
    const save = sync.getSave();
    const solved = save ? save.history.filter((e) => e.r === r.runId) : [];
    return [
      line('result.line.bloodTotal', { points: n(r.points) }, 'blood'),
      line('result.line.bloodSolved', { count: r.solved }, 'blood'),
      ...solved.map((e, i) => line('result.line.bloodPuzzle', { n: i + 1, difficulty: t('diff.' + e.d), points: n(e.pts) }, 'blood')),
    ];
  }

  function render(deferMsg) {
    const r = store.get().result;
    if (!r) return;
    const blood = r.mode === 'blood';
    doc.body.dataset.mode = r.mode;
    for (const b of $$(root, '[data-mode-badge]')) b.textContent = t('mode.' + r.mode);
    for (const h of $$(root, '[data-lock]')) h.dataset.lock = blood ? 'idle' : 'success';
    const use = $(stampIcon, 'use');
    if (use) use.setAttribute('href', stampIcon.getAttribute(blood ? 'data-icon-blood' : 'data-icon-ok'));
    const pb = blood && r.points > r.prevBest && r.points > 0;
    const text = blood
      ? [t(r.quit ? 'result.msg.bloodQuit' : 'result.msg.blood'), pb ? t('result.msg.pb') : ''].filter(Boolean).join(' ')
      : t('result.msg.classic');
    const write = () => {
      if (msgEl.textContent !== text) msgEl.textContent = text; // identical rewrites would re-announce
      msgEl.dataset.tone = blood ? 'info' : 'ok';
      if (pb) msgEl.dataset.pb = 'true';
      else delete msgEl.dataset.pb;
    };
    clearTimeout(msgTimer);
    if (deferMsg) {
      // A live region announces CHANGES while visible: write after the screen is shown (and focus has moved),
      // not in the same frame the section is unhidden, or the outcome is never spoken.
      msgEl.textContent = '';
      msgTimer = setTimeout(write, 250);
    } else write();

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

    setOut(root, 'score', n(r.points));
    setOut(root, 'bloodpoints', n(r.points));
    for (const x of bloodRows) x.hidden = !blood;

    // Next is Classic-only (new seed, same difficulty); Retry is Blood-only (new run). Neither replays a solved seed.
    nextBtn.closest('li').hidden = blood;
    retryBtn.closest('li').hidden = !blood;
    nextBtn.setAttribute('data-i18n', 'result.nextClassic');
    nextBtn.textContent = t('result.nextClassic');
    retryBtn.setAttribute('data-i18n', 'result.retryBlood');
    retryBtn.textContent = t('result.retryBlood');
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
    leave: () => clearTimeout(msgTimer),
    rerender: () => !root.hidden && render(),
    refresh: () => !root.hidden && render(),
  };
}
