// Tiny observable store: shallow merge, synchronous notify. A throwing subscriber must not stop the rest.

export function createStore(initial) {
  let state = { ...initial };
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      for (const fn of [...subs]) {
        try {
          fn(state, prev);
        } catch {
          // see above
        }
      }
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
