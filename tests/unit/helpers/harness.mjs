// Shared test scaffolding: a manual timer queue, a network guard, and a one-call "device" factory.

import { createRemote } from '../../../js/sync/remote.js';
import { createLocal, createMemoryStorage } from '../../../js/sync/local.js';
import { createSync } from '../../../js/sync/sync.js';
import { PROJECT, API_KEY } from './fake-firestore.mjs';

/**
 * Deterministic timers: nothing fires until advance() is called, and nothing real is left pending
 * to keep the Node process alive.
 */
export function createFakeTimers() {
  let now = 0;
  let seq = 0;
  /** @type {Map<number, {at: number, fn: Function}>} */
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      const id = ++seq;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    /** Run every timer due within `ms`, in order. Callbacks may schedule more. */
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let nextId = null;
        for (const [id, t] of pending) if (t.at <= end && (nextId === null || t.at < pending.get(nextId).at)) nextId = id;
        if (nextId === null) break;
        const t = pending.get(nextId);
        pending.delete(nextId);
        now = Math.max(now, t.at);
        t.fn();
      }
      now = end;
    },
    get pending() {
      return pending.size;
    },
    /** delays (ms from now) of currently scheduled timers, sorted */
    delays() {
      return [...pending.values()].map((t) => t.at - now).sort((a, b) => a - b);
    },
  };
}

/**
 * Replace the global fetch with one that throws and counts. Tests that inject their own fetch must
 * never reach it; assert `calls === 0` in `after()`.
 */
export function guardGlobalFetch() {
  const original = globalThis.fetch;
  const guard = { calls: 0 };
  globalThis.fetch = () => {
    guard.calls++;
    throw new Error('test attempted a real network call');
  };
  guard.restore = () => {
    globalThis.fetch = original;
  };
  return guard;
}

/** A fetch that fails the test loudly if anything uses it. */
export const throwingFetch = () => {
  throw new Error('unexpected fetch');
};

/**
 * One simulated device: its own Storage, timers, clock and network switch, sharing the backend.
 * @param {ReturnType<import('./fake-firestore.mjs').createFakeFirestore>} backend
 * @param {{start?: number, rngValues?: number[], events?: EventTarget}} [o]
 */
export function createDevice(backend, o = {}) {
  const net = backend.device();
  const storage = createMemoryStorage();
  const timers = createFakeTimers();
  const events = o.events || new EventTarget();
  let now = o.start ?? 1_000_000;
  const clock = () => now;
  const local = createLocal({ storage });
  const remote = createRemote({ projectId: PROJECT, apiKey: API_KEY, fetch: net.fetch, timeoutMs: 50 });
  const rng = o.rngValues
    ? (() => {
        let i = 0;
        return (buf) => {
          buf[0] = o.rngValues[i++ % o.rngValues.length];
        };
      })()
    : undefined;
  const sync = createSync({ remote, local, clock, timers, events, rng, isHidden: () => false });
  return {
    net,
    storage,
    timers,
    events,
    local,
    remote,
    sync,
    tick(ms = 1) {
      now += ms;
      return now;
    },
    set now(v) {
      now = v;
    },
    get now() {
      return now;
    },
  };
}

/** @param {string} id @param {number} pts @param {Partial<import('../../../js/sync/merge.js').HistoryEntry>} [over] */
export function solve(id, pts, over = {}) {
  return { id, m: 'c', d: 'rookie', pts, s: 30, w: 0, h: 0, t: 1_000_000, ...over };
}
