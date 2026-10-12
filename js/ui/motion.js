// Screen swaps through the View Transitions API. DOM-free apart from the objects passed in, so the fallbacks are
// testable. Nothing here may ever block navigation or leave the UI stuck. (The score count-up is in countup.js: it is
// only needed on Result, so it stays out of the first-load graph.)

/** @param {{matchMedia?: (q: string) => {matches: boolean}} | null | undefined} win */
export function prefersReducedMotion(win) {
  try {
    return !!(win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/**
 * Run `update` (the whole DOM swap) inside a view transition when the browser has one and the player has not
 * asked for reduced motion; otherwise run it right now. `update` runs EXACTLY once, whatever the browser does: a
 * watchdog runs it anyway if the transition never calls back, and a rejected transition promise is swallowed.
 * @param {{startViewTransition?: Function, hidden?: boolean} | null | undefined} doc
 * @param {any} win
 * @param {() => void} update
 * @param {{watchdogMs?: number, setTimeout?: Function, clearTimeout?: Function}} [o]
 * @returns {{done: Promise<void>, finished: Promise<void>}} `done`: update has run (rejects if update threw);
 *   `finished`: the animation is over (already resolved when there is none)
 */
export function runTransition(doc, win, update, o = {}) {
  const st = o.setTimeout || setTimeout;
  const ct = o.clearTimeout || clearTimeout;
  let called = false;
  /** @type {unknown} */
  let error = null;
  let failed = false;
  const run = () => {
    if (called) return;
    called = true;
    try {
      update();
    } catch (e) {
      failed = true;
      error = e;
    }
  };
  const settle = () => (failed ? Promise.reject(error) : Promise.resolve());
  const noop = () => {};

  if (!doc || typeof doc.startViewTransition !== 'function' || doc.hidden || prefersReducedMotion(win)) {
    run();
    return { done: settle(), finished: Promise.resolve() };
  }
  let vt;
  try {
    vt = doc.startViewTransition(run);
  } catch {
    run();
    return { done: settle(), finished: Promise.resolve() };
  }
  // Every promise of the transition is observed so a skipped or failed one is never an unhandled rejection.
  Promise.resolve(vt && vt.ready).catch(noop);
  const finished = Promise.resolve(vt && vt.finished).then(noop, noop);
  const timer = st(run, o.watchdogMs ?? 1000);
  const done = Promise.resolve(vt && vt.updateCallbackDone)
    .then(noop, noop)
    .then(() => {
      ct(timer);
      run(); // no-op unless the callback never ran
      return settle();
    });
  return { done, finished };
}
