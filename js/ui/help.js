// Help copy lives in the markup (swapped by data-i18n with numbers from config.js); this only wires Back.

import { onAction } from './dom.js';

/** @param {any} app */
export function createHelp(app) {
  onAction(app.sections.help, { back: () => app.router.back(app.store.get().session ? 'home' : 'auth') });
  return {};
}
