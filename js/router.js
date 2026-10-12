import { runTransition } from './ui/motion.js';

// Hash router. Guards decide where a navigation may END UP, so a screen the player cannot be on is never shown
// (play needs a round, result needs a result, everything but auth/help needs a session).

/**
 * The heading takes focus for screen-reader announcement only when focus has not already settled somewhere
 * useful: the transition ends ~180 ms after the click, and a fast keyboard user may have moved on by then, so
 * yanking focus back would swallow their next keystroke.
 */
function shouldTakeFocus(doc, origin, next, prev) {
  const a = doc && doc.activeElement;
  if (!a || a === doc.body || a === origin) return true; // nothing chosen yet, or still on the activating control
  if (next.contains(a)) return false;
  if (prev && prev.contains(a)) return true;
  // Rendered elsewhere (header controls the user chose on purpose) keeps focus; an unrendered one cannot hold it.
  return !!a.getClientRects && a.getClientRects().length === 0;
}

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

  async function show(name, focus, instant) {
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
    // Who had focus when this navigation began (typically the activated nav control). Compared again after the
    // swap so we can tell "still where the click left it" from "the user has since moved on".
    const doc = win.document;
    const origin = doc ? doc.activeElement : null;
    const prevCtrl = prev ? await o.load(prev).catch(() => null) : null;
    if (my !== token) return false;
    // The whole swap is one callback so a view transition can snapshot before and after it. It runs exactly once
    // (motion.js guarantees that), and not at all if a newer navigation overtook this one meanwhile.
    const swap = () => {
      if (my !== token) return;
      if (prevCtrl && prevCtrl.leave) prevCtrl.leave();
      current = name;
      // Hide everything else, not just `prev`: on first load the auth section is visible in the static HTML.
      for (const [n, sec] of Object.entries(o.sections)) sec.hidden = n !== name;
      if (ctrl && ctrl.enter) ctrl.enter();
      o.onShow(name);
    };
    // The very first screen is never animated (nothing to transition from; it would only delay first paint).
    const t = runTransition(instant ? null : win.document, win, swap);
    try {
      await t.done;
    } catch (err) {
      o.onError(err);
      return false;
    }
    if (my !== token || current !== name) return false;
    if (focus) {
      const h1 = o.sections[name].querySelector('h1');
      if (h1 && shouldTakeFocus(doc, origin, o.sections[name], prev && o.sections[prev])) h1.focus();
    }
    // After the animation: things that should play once the screen has settled (the clue entrance on Play).
    t.finished.then(() => {
      if (current === name && ctrl && ctrl.afterShow) ctrl.afterShow();
    });
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
      return show(target, focus, true);
    },
  };
}
