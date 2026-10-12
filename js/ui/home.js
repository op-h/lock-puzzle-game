// Home: the three stat cells, the difficulty selector and the two mode buttons. Re-renders live when sync pulls
// newer data. (No "recent rounds" list any more: design-v2 removed it from Home.)

import { DIFFICULTY_ORDER, DIFFICULTIES } from '../config.js';
import { formatNumber, getLang, t } from '../i18n/index.js';
import { derive } from '../sync/index.js';
import { $, el, onAction, setName, setOut } from './dom.js';

const MAX_STAT_CHARS = 6;

/**
 * A stat that must fit a 96 px cell: grouped digits up to 6 characters ("12,450"), compact notation beyond ("1.2M").
 * @param {number} n @param {'en'|'ar'} [lang]
 */
export function statText(n, lang = getLang()) {
  const full = formatNumber(n, lang);
  if (full.length <= MAX_STAT_CHARS) return full;
  try {
    // Latin K/M in both languages: it is a number glyph in the pixel face, and Arabic's "1.2 مليون" would not fit the cell.
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch {
    return full;
  }
}

/** @param {any} app */
export function createHome(app) {
  const { sync, local, store } = app;
  const root = app.sections.home;
  const picker = $(root, '[data-slot="difficulty-picker"]');

  const chosen = () => {
    const d = local.loadPref().difficulty;
    return DIFFICULTY_ORDER.includes(d) ? d : 'rookie';
  };

  function renderPicker() {
    const cur = chosen();
    picker.replaceChildren(
      ...DIFFICULTY_ORDER.map((d) => {
        const id = `diff-${d}`;
        const n = DIFFICULTIES[d].length;
        const input = el('input', { type: 'radio', name: 'difficulty', id, value: d });
        input.checked = d === cur;
        // The squares are the visible digit count; the words stay as hidden text. The custom property goes through
        // CSSOM (a style attribute would break the CSP); data-n is the same number for CSS that prefers attr().
        const dig = el('span', { class: 'lp-dig', 'data-n': String(n), 'aria-hidden': 'true' });
        dig.style.setProperty('--n', String(n));
        const label = el('label', { for: id }, el('span', {}, t('diff.' + d)), dig, el('span', { class: 'visually-hidden' }, t('diff.digits', { count: n })));
        return el('li', {}, input, label);
      }),
    );
  }

  function render() {
    const s = store.get().session;
    if (!s) return;
    const d = derive(sync.getSave());
    for (const n of root.querySelectorAll('[data-out="name"]')) setName(n, s.name);
    setOut(root, 'classic', statText(d.classic));
    setOut(root, 'blood', statText(d.blood));
    setOut(root, 'total', statText(d.total));
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
