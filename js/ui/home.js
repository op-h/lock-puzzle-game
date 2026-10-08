// Home: totals, difficulty picker, recent rounds. Re-renders live when sync pulls newer data.

import { DIFFICULTY_ORDER, DIFFICULTIES } from '../config.js';
import { formatDuration, formatNumber, getLang, t } from '../i18n/index.js';
import { derive } from '../sync/index.js';
import { $, el, ltr, onAction, setName, setOut } from './dom.js';

const RECENT = 8;

/** @param {any} app */
export function createHome(app) {
  const { sync, local, store } = app;
  const root = app.sections.home;
  const picker = $(root, '[data-slot="difficulty-picker"]');
  const history = $(root, '[data-slot="history"]');

  const chosen = () => {
    const d = local.loadPref().difficulty;
    return DIFFICULTY_ORDER.includes(d) ? d : 'rookie';
  };

  function renderPicker() {
    const cur = chosen();
    picker.replaceChildren(
      ...DIFFICULTY_ORDER.map((d) => {
        const id = `diff-${d}`;
        const input = el('input', { type: 'radio', name: 'difficulty', id, value: d });
        input.checked = d === cur;
        const label = el('label', { for: id }, el('span', {}, t('diff.' + d)), ' ', el('span', {}, t('diff.digits', { count: DIFFICULTIES[d].length })));
        return el('li', {}, input, label);
      }),
    );
  }

  function renderHistory() {
    const save = sync.getSave();
    const rows = save ? save.history.slice(-RECENT).reverse() : [];
    if (rows.length === 0) {
      history.replaceChildren(el('li', {}, t('home.history.empty')));
      return;
    }
    history.replaceChildren(
      ...rows.map((e) => {
        const params = { difficulty: t('diff.' + e.d), points: formatNumber(e.pts), time: ltr(getLang(), formatDuration(e.s)) };
        const li = el('li', {}, t(e.m === 'b' ? 'home.history.blood' : 'home.history.classic', params));
        li.dataset.mode = e.m === 'b' ? 'blood' : 'classic';
        return li;
      }),
    );
  }

  function render() {
    const s = store.get().session;
    if (!s) return;
    const d = derive(sync.getSave());
    setName($(root, '[data-out="name"]'), s.name);
    setOut(root, 'classic', formatNumber(d.classic));
    setOut(root, 'blood', formatNumber(d.blood));
    setOut(root, 'total', formatNumber(d.total));
    renderHistory();
  }

  root.addEventListener('change', (e) => {
    const t0 = e.target;
    if (t0 instanceof HTMLInputElement && t0.name === 'difficulty' && DIFFICULTY_ORDER.includes(t0.value)) {
      local.storePref({ ...local.loadPref(), difficulty: t0.value });
    }
  });

  onAction(root, {
    'play-classic': () => void app.startClassic(chosen()),
    'play-blood': () => void app.startBlood(),
    'show-board': () => void app.router.go('board'),
    'show-help': () => void app.router.go('help'),
  });

  return {
    enter() {
      renderPicker();
      render();
    },
    rerender() {
      renderPicker();
      render();
    },
    refresh() {
      if (!root.hidden) render();
    },
  };
}
