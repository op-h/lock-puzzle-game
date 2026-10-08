// Who owns the live Blood run in lp1.run.<id>. DOM-free: storage and the clock are injected, so the state machine
// (heartbeat, release on pagehide, re-acquire on bfcache restore) is testable without a browser.
//
// The release must be FINAL for the page that wrote it. Chromium fires `pagehide` and then
// `visibilitychange(hidden)`; if the second one wrote a live heartbeat again, a reload would find the run
// "owned by another tab" for the next 6 s. So after release() every beat() is a no-op until reacquire()
// (pageshow from the bfcache), which is the only way a released page can become active again.

import { isForeignActive } from './progress.js';

/**
 * @param {{
 *   tabId: string,
 *   read: () => ReturnType<typeof import('./progress.js').sanitizeProgress>,
 *   write: (record: Record<string, unknown>) => unknown,
 *   now: () => number,
 * }} o
 */
export function createOwnership({ tabId, read, write, now }) {
  let released = false;
  const foreign = () => isForeignActive(read(), tabId, now());
  return {
    isReleased: () => released,
    /** Another tab holds a fresh heartbeat for the run on disk. */
    foreignActive: foreign,
    /**
     * Heartbeat. 'released' = this page already handed the run back (pagehide), nothing is written;
     * 'foreign' = another tab owns it now, nothing is written; 'ok' = written with a fresh heartbeat.
     * @param {Record<string, unknown>} snapshot
     * @returns {'ok'|'foreign'|'released'}
     */
    beat(snapshot) {
      if (released) return 'released';
      if (foreign()) return 'foreign';
      write({ ...snapshot, owner: tabId, hb: now() });
      return 'ok';
    },
    /**
     * pagehide: write the final state with heartbeat 0 (nobody owns it) and stay released.
     * @param {Record<string, unknown>} snapshot
     * @returns {'ok'|'foreign'}
     */
    release(snapshot) {
      if (foreign()) return 'foreign';
      write({ ...snapshot, owner: tabId, hb: 0 });
      released = true;
      return 'ok';
    },
    /** pageshow from the bfcache: this page is live again and may beat. */
    reacquire() {
      released = false;
    },
  };
}
