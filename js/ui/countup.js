// Score count-up on the Result screen (design-v2 7.6). Loaded with that screen, not on first load.

/** Cubic ease-out on 0..1. */
export const easeOut = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/** Duration of the score count-up: short for small scores, never above 600 ms. */
export const countDuration = (n) => Math.min(600, 200 + Math.max(0, Math.floor(n)) * 2);

/**
 * Count 0 -> `to` in integer steps. `onFrame` is called with every shown value and the LAST call is always exactly
 * `to`; `onDone` fires once after it. With `ms <= 0` or `to <= 0` it jumps straight to the end (reduced motion).
 * @param {{to: number, ms: number, now: () => number, raf: (f: () => void) => unknown, caf?: (id: unknown) => void,
 *   onFrame: (v: number) => void, onDone?: () => void}} o
 * @returns {() => void} cancel (does NOT call onDone)
 */
export function countUp({ to, ms, now, raf, caf, onFrame, onDone }) {
  let cancelled = false;
  let id;
  const finish = () => {
    onFrame(to);
    if (onDone) onDone();
  };
  if (!(to > 0) || !(ms > 0)) {
    finish();
    return () => {};
  }
  const t0 = now();
  const step = () => {
    if (cancelled) return;
    const p = (now() - t0) / ms;
    if (p >= 1) return finish();
    onFrame(Math.round(to * easeOut(p)));
    id = raf(step);
  };
  id = raf(step);
  return () => {
    cancelled = true;
    if (caf && id !== undefined) caf(id);
  };
}
