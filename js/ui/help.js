// Help copy lives in the markup (swapped by data-i18n, numbers from config.js). This wires Back and puts the
// localised symbol form (clue.sym.*) into the legend, so the legend IS the same glyph the clue rows draw.

import { getLang } from '../i18n/index.js';
import { $$, onAction } from './dom.js';
import { symbolText } from './clues.js';

/** Sample clue behind each legend symbol (the legend row names the kind in data-sym). */
const SAMPLES = {
  sum: { kind: 'sum', value: 12 },
  parity: { kind: 'parity', pos: 1, parity: 'even' },
  compare: { kind: 'compare', a: 0, b: 1, rel: 'gt' },
  evencount: { kind: 'evenCount', value: 2 },
};

/** @param {any} app */
export function createHelp(app) {
  const root = app.sections.help;
  onAction(root, { back: () => app.router.back(app.store.get().session ? 'home' : 'auth') });
  function symbols() {
    for (const s of $$(root, '[data-sym]')) {
      const sample = SAMPLES[s.getAttribute('data-sym')];
      if (sample) s.textContent = symbolText(/** @type {any} */ (sample), getLang()) || '';
    }
  }
  return { enter: symbols, rerender: symbols };
}
