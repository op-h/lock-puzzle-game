// Cross-tab coherence. Two tabs share one localStorage but each holds its own in-memory save, so without this a
// logout in one tab leaves the other writing the account back to disk, and solves made in one tab are invisible
// (and overwritable) in the other. DOM-free: it only needs something with addEventListener('storage').

import { KEY_SESSION } from './local.js';

const SAVE_KEY_PREFIX = 'lp1.save.';

/**
 * }} o
 */
export function watchTabs({ win, sync, onSignedOut, onSaveChanged }) {
  const signOutHere = () => {
    sync.localSignOut(); // wipes memory and refuses every later write for the id: nothing resurrects lp1.save.<id>
    onSignedOut();
  };

  const handler = (/** @type {{key: string|null, newValue: string|null}} */ e) => {
    const sess = sync.getSession();
    // A sign-up whose code has not been acknowledged lives only in memory: other tabs' storage activity is not about it.
    if (!sess || sync.isPending()) return;
    if (e.key === null) return signOutHere(); // localStorage.clear()
    if (e.key === KEY_SESSION) {
      if (e.newValue === null) return signOutHere();
      let id = null;
      try {
        id = JSON.parse(e.newValue).id;
      } catch {
        // an unreadable session value is not ours
      }
      if (typeof id === 'string' && id !== sess.id) return signOutHere(); // someone else signed in over us
      return;
    }
    if (e.key === SAVE_KEY_PREFIX + sess.id && e.newValue !== null) {
      if (sync.mergeFromStorage() && onSaveChanged) onSaveChanged();
    }
  };

  win.addEventListener('storage', handler);
  return () => win.removeEventListener('storage', handler);
}
