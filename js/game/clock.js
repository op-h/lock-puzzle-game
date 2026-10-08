// The game clock is MONOTONIC and nothing else.
//
// Earlier versions topped performance.now() up with whatever the wall clock "saw" (to survive device sleep).
// That is poisonable both ways: setting the system clock forward an hour made a Blood run end instantly.
// Within a session the countdown is therefore purely performance.now(); the wall clock is only ever used to
// continue a run after a RELOAD (progress.js), where it is the only source there is.
//
// Known limit, accepted: on platforms where performance.now() stops while the device sleeps, a sleeping
// device pauses a running Blood run. Reloading does not have this gap (restore uses the wall clock).

export function createClock(src = {}) {
  const perf = src.perf || (() => globalThis.performance.now());
  const wall = src.wall || (() => Date.now());
  let perf0 = perf();
  let wall0 = wall();
  let lastBeat = perf0;
  return {
    /** monotonic ms; never adjusted */
    now: () => perf(),
    /**
     * Re-anchor and report how far the wall clock drifted from the monotonic one since the last call
     * (sleep, or a changed system clock). The drift is information only: it is NEVER applied to now().
     */
    resync() {
      const p = perf();
      const w = wall();
      const drift = w - wall0 - (p - perf0);
      perf0 = p;
      wall0 = w;
      return drift;
    },
    /**
     * Call from a repeating timer. Returns how long it has been since the previous call: a gap far above the
     * timer period means the page was throttled or frozen, which deserves the same treatment as a
     * visibilitychange (re-check deadlines, persist).
     */
    beat() {
      const p = perf();
      const gap = p - lastBeat;
      lastBeat = p;
      return gap;
    },
  };
}
