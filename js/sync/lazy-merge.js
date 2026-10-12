// merge.js (4.4 KB gzipped) is not needed to show the sign-in screen, so it stays out of the cold first-load graph.
// Every code path that touches a save runs only after loadMerge() has resolved: sign-up, sign-in and resume
// await it first, and everything else is gated on a session, which only exists after one of those three.

/** Filled in place by loadMerge(); callers use M.mergeSaves(...) etc. at call time, never at import time. */
export const M = {};
let loading = null;

export function loadMerge() {
  loading ??= import('./merge.js').then(
    (m) => Object.assign(M, m),
    (err) => {
      loading = null; // offline and uncached: allow a retry instead of staying broken for the whole session
      throw err;
    },
  );
  return loading;
}
