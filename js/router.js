// Hash router. Guards decide where a navigation may END UP, so a screen the player cannot be on is never shown
// (play needs a round, result needs a result, everything but auth/help needs a session).

/**
 * }} o
 */
export function createRouter(o) {
  const { win } = o;
  let current = null;
  let token = 0;

  const fromHash = () => {
    const h = String(win.location.hash || '').replace(/^#/, '');
    return o.names.includes(h) ? h : null;
  };
  const stateOf = () => (win.history.state && Number.isInteger(win.history.state.d) ? win.history.state.d : 0);

  async function show(name, focus) {
    const my = ++token;
    let ctrl = null;
    try {
      ctrl = await o.load(name);
    } catch (err) {
      o.onError(err);
      return false;
    }
    if (my !== token) return false; // a newer navigation won while the screen module was loading
    const prev = current;
    if (prev) {
      const pc = await o.load(prev).catch(() => null);
      if (pc && pc.leave) pc.leave();
    }
    current = name;
    // Hide everything else, not just `prev`: on first load the auth section is visible in the static HTML.
    for (const [n, sec] of Object.entries(o.sections)) sec.hidden = n !== name;
    if (ctrl && ctrl.enter) ctrl.enter();
    o.onShow(name);
    if (focus) {
      const h1 = o.sections[name].querySelector('h1');
      if (h1) h1.focus();
    }
    return true;
  }

  function write(name, replace) {
    const d = replace ? stateOf() : stateOf() + 1;
    win.history[replace ? 'replaceState' : 'pushState']({ d }, '', '#' + name);
  }

  async function go(name, opts = {}) {
    const target = o.guard(name);
    const replace = !!opts.replace || target !== name;
    if (current && target !== current && !o.canLeave(current, target)) {
      o.onBlocked(current, target);
      return false;
    }
    if (target === current) return true;
    write(target, replace);
    return show(target, opts.focus !== false);
  }

  function onPop() {
    // A fragment that is not one of our screens (the skip link's #main) is the browser's business: it already
    // moved focus to the target. Navigating here would turn a skip link into "go home" or a quit prompt.
    const raw = String(win.location.hash || '').replace(/^#/, '');
    if (raw !== '' && !o.names.includes(raw)) return;
    const name = fromHash() || o.fallback;
    const target = o.guard(name);
    if (target === current) {
      // A typed hash for a screen the player cannot be on: keep the URL honest too.
      if (fromHash() !== current) win.history.replaceState({ d: stateOf() }, '', '#' + current);
      return;
    }
    if (current && !o.canLeave(current, target)) {
      // The browser already moved; put the entry back so Back does not silently abandon the round.
      win.history.pushState({ d: stateOf() + 1 }, '', '#' + current);
      o.onBlocked(current, target);
      return;
    }
    if (target !== name) win.history.replaceState({ d: stateOf() }, '', '#' + target);
    void show(target, true);
  }

  return {
    current: () => current,
    go,
    /** History Back when this app pushed an entry, otherwise a replace to `fallbackName`. */
    back(fallbackName) {
      if (stateOf() > 0) win.history.back();
      else void go(fallbackName, { replace: true });
    },
    start(focus) {
      win.addEventListener('popstate', onPop);
      const target = o.guard(fromHash() || o.fallback);
      write(target, true);
      return show(target, focus);
    },
  };
}
