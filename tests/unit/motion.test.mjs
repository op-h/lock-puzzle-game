// View-transition wrapper (fallbacks, exactly-once, never stuck) and the score count-up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTransition, prefersReducedMotion } from '../../js/ui/motion.js';
import { countUp, countDuration, easeOut } from '../../js/ui/countup.js';

const win = (reduce = false) => ({ matchMedia: (q) => ({ matches: reduce && q.includes('reduce') }) });

/** A scripted startViewTransition: `callbackAt` decides when/if the update callback runs. */
function fakeDoc(mode = 'ok', extra = {}) {
  const calls = { started: 0 };
  const doc = {
    hidden: false,
    calls,
    startViewTransition(cb) {
      calls.started++;
      if (mode === 'throws') throw new Error('InvalidStateError');
      const vt = {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
      };
      if (mode === 'ok') Promise.resolve().then(cb);
      if (mode === 'rejects') {
        vt.ready = Promise.reject(new Error('skipped'));
        vt.finished = Promise.reject(new Error('skipped'));
        vt.updateCallbackDone = Promise.reject(new Error('boom'));
        Promise.resolve().then(cb);
      }
      if (mode === 'never') vt.updateCallbackDone = new Promise(() => {}); // callback is never invoked, promise never settles
      return vt;
    },
    ...extra,
  };
  return doc;
}

test('no startViewTransition, hidden document, or reduced motion: the swap runs immediately and synchronously', async () => {
  for (const [doc, w] of [[null, win()], [{}, win()], [fakeDoc('ok', { hidden: true }), win()], [fakeDoc('ok'), win(true)]]) {
    let ran = 0;
    const t = runTransition(doc, w, () => ran++);
    assert.equal(ran, 1, 'already ran before any await');
    await t.done;
    await t.finished;
    assert.equal(ran, 1);
    if (doc && doc.calls) assert.equal(doc.calls.started, 0, 'never even starts a transition');
  }
});

test('supported and allowed: the swap runs exactly once inside the transition; done/finished resolve', async () => {
  const doc = fakeDoc('ok');
  let ran = 0;
  const t = runTransition(doc, win(), () => ran++);
  assert.equal(doc.calls.started, 1);
  await t.done;
  await t.finished;
  assert.equal(ran, 1);
});

test('startViewTransition throwing falls back to a plain swap', async () => {
  const doc = fakeDoc('throws');
  let ran = 0;
  const t = runTransition(doc, win(), () => ran++);
  await t.done;
  assert.equal(ran, 1);
});

test('rejected transition promises are swallowed (no unhandled rejection) and the swap still happened once', async () => {
  const unhandled = [];
  const h = (e) => unhandled.push(e);
  process.on('unhandledRejection', h);
  try {
    const doc = fakeDoc('rejects');
    let ran = 0;
    const t = runTransition(doc, win(), () => ran++);
    await t.done;
    await t.finished;
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ran, 1);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', h);
  }
});

test('a transition that never calls back cannot strand the UI: the watchdog runs the swap (once)', async () => {
  const doc = fakeDoc('never');
  let ran = 0;
  const timers = [];
  const t = runTransition(doc, win(), () => ran++, { setTimeout: (f) => timers.push(f) && timers.length, clearTimeout() {} });
  assert.equal(ran, 0);
  assert.equal(timers.length, 1, 'watchdog armed');
  timers[0](); // the watchdog fires
  timers[0]();
  assert.equal(ran, 1, 'exactly once, even if it fires twice');
  void t;
});

test('an update that throws makes `done` reject once, with the same error, and is not run twice', async () => {
  for (const doc of [null, fakeDoc('ok')]) {
    let ran = 0;
    const err = new Error('swap failed');
    const t = runTransition(doc, win(), () => {
      ran++;
      throw err;
    });
    await assert.rejects(t.done, (e) => e === err);
    assert.equal(ran, 1);
  }
});

test('prefersReducedMotion tolerates a missing or throwing matchMedia', () => {
  assert.equal(prefersReducedMotion(null), false);
  assert.equal(prefersReducedMotion({}), false);
  assert.equal(prefersReducedMotion({ matchMedia: () => { throw new Error('x'); } }), false);
  assert.equal(prefersReducedMotion(win(true)), true);
  assert.equal(prefersReducedMotion(win(false)), false);
});

// ---- count-up ----

function fakeFrames() {
  let t = 1000;
  const queue = [];
  return {
    now: () => t,
    raf: (f) => queue.push(f) && queue.length,
    caf: () => {},
    advance(ms) {
      t += ms;
      const f = queue.shift();
      if (f) f();
    },
    pending: () => queue.length,
  };
}

test('count-up: integer steps, monotone, ends EXACTLY on the final value, onDone once', () => {
  const clock = fakeFrames();
  const shown = [];
  let done = 0;
  countUp({ to: 150, ms: 500, now: clock.now, raf: clock.raf, caf: clock.caf, onFrame: (v) => shown.push(v), onDone: () => done++ });
  while (clock.pending()) clock.advance(16);
  assert.ok(shown.length > 3);
  assert.ok(shown.every(Number.isInteger));
  assert.deepEqual(shown, [...shown].sort((a, b) => a - b), 'never goes backwards');
  assert.equal(shown.at(-1), 150);
  assert.ok(shown.filter((v) => v === 150).length >= 1);
  assert.equal(done, 1);
  assert.ok(shown[0] <= 150);
});

test('count-up: a skipped frame (tab was busy) still lands on the final value', () => {
  const clock = fakeFrames();
  const shown = [];
  countUp({ to: 999, ms: 400, now: clock.now, raf: clock.raf, onFrame: (v) => shown.push(v) });
  clock.advance(10_000);
  assert.deepEqual(shown, [999]);
});

test('count-up: zero score or non-positive duration (reduced motion) jumps straight to the end with no frames scheduled', () => {
  for (const o of [{ to: 0, ms: 500 }, { to: 80, ms: 0 }, { to: 80, ms: -5 }]) {
    const clock = fakeFrames();
    const shown = [];
    let done = 0;
    countUp({ ...o, now: clock.now, raf: clock.raf, onFrame: (v) => shown.push(v), onDone: () => done++ });
    assert.deepEqual(shown, [o.to]);
    assert.equal(done, 1);
    assert.equal(clock.pending(), 0);
  }
});

test('count-up: cancel stops it and never calls onDone', () => {
  const clock = fakeFrames();
  let done = 0;
  const shown = [];
  const cancel = countUp({ to: 100, ms: 400, now: clock.now, raf: clock.raf, onFrame: (v) => shown.push(v), onDone: () => done++ });
  clock.advance(100);
  cancel();
  const n = shown.length;
  while (clock.pending()) clock.advance(100);
  assert.equal(shown.length, n);
  assert.equal(done, 0);
});

test('count duration: 200 ms + 2 ms per point, never above 600 ms, sane for junk', () => {
  assert.equal(countDuration(0), 200);
  assert.equal(countDuration(50), 300);
  assert.equal(countDuration(200), 600);
  assert.equal(countDuration(5000), 600);
  assert.equal(countDuration(-10), 200);
  assert.equal(countDuration(NaN) >= 200 || Number.isNaN(countDuration(NaN)), true);
  assert.ok(easeOut(0) === 0 && easeOut(1) === 1 && easeOut(0.5) > 0.5, 'ease-out is front-loaded');
  assert.equal(easeOut(2), 1);
  assert.equal(easeOut(-1), 0);
});
