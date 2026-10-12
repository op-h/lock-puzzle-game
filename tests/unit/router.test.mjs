// Router behaviour against a fake window: guards, ignored fragments, blocked leaves, racing loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../../js/router.js';

function harness({ hash = '', guard, canLeave = () => true, load, transition } = {}) {
  const listeners = {};
  const hist = [];
  const win = {
    location: { hash },
    history: {
      state: null,
      pushState(s, _t, u) {
        this.state = s;
        win.location.hash = u;
        hist.push(['push', u]);
      },
      replaceState(s, _t, u) {
        this.state = s;
        win.location.hash = u;
        hist.push(['replace', u]);
      },
      back() {
        hist.push(['back']);
      },
    },
    addEventListener: (t, f) => (listeners[t] = f),
  };
  const names = ['auth', 'home', 'play', 'result', 'board', 'help'];
  const focused = [];
  // Minimal focus model: an element knows which screen it lives in, h1.focus() really moves document.activeElement.
  const body = { name: 'body' };
  const doc = { body, activeElement: body, hidden: false };
  const el = (inside, rendered = true) => ({ inside, getClientRects: () => (rendered ? [{}] : []) });
  const sections = Object.fromEntries(
    names.map((n) => {
      const h1 = el(n);
      h1.focus = () => {
        focused.push(n);
        doc.activeElement = h1;
      };
      return [n, { hidden: n !== 'auth', querySelector: () => h1, contains: (a) => !!a && a.inside === n }];
    }),
  );
  // A view transition the test steps by hand: swap() runs the update callback, finish() ends the transition.
  const vt = { cb: null, finish: null };
  if (transition === 'manual') {
    doc.startViewTransition = (cb) => {
      vt.cb = cb;
      return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: new Promise((r) => (vt.finish = r)) };
    };
  }
  win.document = doc;
  const events = [];
  const ctrls = Object.fromEntries(names.map((n) => [n, { enter: () => events.push('enter ' + n), leave: () => events.push('leave ' + n) }]));
  const blocked = [];
  const router = createRouter({
    win,
    names,
    fallback: 'home',
    sections,
    load: load || ((n) => Promise.resolve(ctrls[n])),
    guard: guard || ((n) => n),
    canLeave,
    onBlocked: (from, to) => blocked.push([from, to]),
    onShow: (n) => events.push('show ' + n),
    onError: () => events.push('error'),
  });
  const visible = () => names.filter((n) => !sections[n].hidden);
  /** the user (or a link) changes the fragment, the browser fires popstate */
  const userHash = (h) => {
    win.location.hash = h;
    listeners.popstate();
  };
  return { win, doc, el, vt, router, hist, events, blocked, focused, visible, userHash };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('router: start shows the guarded target, rewrites the URL, and shows exactly one screen', async () => {
  const h = harness({ hash: '', guard: (n) => (n === 'home' ? 'auth' : n) });
  await h.router.start(false);
  assert.deepEqual(h.visible(), ['auth']);
  assert.deepEqual(h.hist.at(-1), ['replace', '#auth']);
  assert.equal(h.focused.length, 0, 'no focus grab on first paint when asked not to');
});

test('router: a fragment that is not a screen (skip link #main) is ignored: no navigation, no prompt', async () => {
  const h = harness({ hash: '#home', canLeave: () => false });
  await h.router.start(true);
  const before = [h.events.length, h.hist.length];
  h.userHash('#main');
  await tick();
  assert.deepEqual([h.events.length, h.hist.length], before, 'nothing happened');
  assert.deepEqual(h.blocked, [], 'the quit prompt is not triggered');
  assert.deepEqual(h.visible(), ['home']);
});

test('router: a typed hash for a screen the player cannot be on is corrected, not shown', async () => {
  const h = harness({ hash: '#home', guard: (n) => (n === 'play' ? 'home' : n) });
  await h.router.start(true);
  h.userHash('#play');
  await tick();
  assert.deepEqual(h.visible(), ['home']);
  assert.equal(h.win.location.hash, '#home');
});

test('router: leaving is blocked (Back during a round): URL restored, screen kept, handler told', async () => {
  let round = true;
  const h = harness({ hash: '#play', canLeave: (from) => !(from === 'play' && round) });
  await h.router.start(true);
  assert.deepEqual(h.visible(), ['play']);
  h.userHash('#home');
  await tick();
  assert.deepEqual(h.visible(), ['play']);
  assert.deepEqual(h.blocked, [['play', 'home']]);
  assert.equal(h.win.location.hash, '#play', 'entry pushed back so Back does not silently leave');
  assert.equal(await h.router.go('home'), false);
  round = false;
  assert.equal(await h.router.go('home'), true);
  assert.deepEqual(h.visible(), ['home']);
});

test('router: leave() runs on the old screen before enter() on the new one, then focus moves to the new h1', async () => {
  const h = harness({ hash: '#home' });
  await h.router.start(false);
  h.events.length = 0;
  await h.router.go('board');
  assert.deepEqual(h.events, ['leave home', 'enter board', 'show board']);
  assert.deepEqual(h.focused, ['board']);
});

test('router: of two racing navigations only the latest is shown (slow lazy import)', async () => {
  let release;
  const slow = new Promise((r) => (release = r));
  const h = harness({
    hash: '#home',
    load: async (n) => {
      if (n === 'board') await slow;
      return { enter() {}, leave() {} };
    },
  });
  await h.router.start(false);
  const a = h.router.go('board');
  const b = h.router.go('help');
  await b;
  release();
  await a;
  assert.deepEqual(h.visible(), ['help']);
});

test('router: a failing screen load reports an error and keeps the current screen', async () => {
  const h = harness({
    hash: '#home',
    load: async (n) => {
      if (n === 'board') throw new Error('offline');
      return {};
    },
  });
  await h.router.start(false);
  await h.router.go('board');
  assert.deepEqual(h.visible(), ['home']);
  assert.ok(h.events.includes('error'));
});

test('router: back() uses history when the app pushed an entry, else replaces to the fallback', async () => {
  const h = harness({ hash: '#home' });
  await h.router.start(false);
  h.router.back('home');
  await tick();
  assert.ok(!h.hist.some((e) => e[0] === 'back'), 'first entry: nothing to go back to');
  await h.router.go('help');
  h.router.back('home');
  assert.deepEqual(h.hist.at(-1), ['back']);
});

// ---- F-23: the heading must not steal focus the user already moved into the new screen ----

/** Navigate to `to` with a hand-stepped transition; `during` runs after the swap and before the transition ends. */
async function navigate(h, to, during) {
  const nav = h.router.go(to);
  await tick();
  h.vt.cb();
  during && during();
  h.vt.finish();
  return nav;
}
async function started(opts) {
  const h = harness({ hash: '#home', transition: 'manual', ...opts });
  const p = h.router.start(false); // first screen is instant: no transition to step
  await p;
  h.focused.length = 0;
  return h;
}

test('router focus: normal navigation from a nav control (still focused) moves focus to the new h1', async () => {
  const h = await started();
  const navBtn = h.el(null); // header menu item: rendered, outside every screen, and it is what was activated
  h.doc.activeElement = navBtn;
  await navigate(h, 'board');
  assert.deepEqual(h.focused, ['board']);
});

test('router focus: focus already inside the new screen when the transition ends is left alone', async () => {
  const h = await started();
  const tab = h.el('board');
  await navigate(h, 'board', () => (h.doc.activeElement = tab));
  assert.deepEqual(h.focused, []);
  assert.equal(h.doc.activeElement, tab);
});

test('router focus: focus on <body> or nowhere after navigation moves to the h1', async () => {
  for (const none of [undefined, null, 'body']) {
    const h = await started();
    await navigate(h, 'board', () => (h.doc.activeElement = none === 'body' ? h.doc.body : none));
    assert.deepEqual(h.focused, ['board'], String(none));
  }
});

test('router focus: focus left on an element of the previous (now hidden) screen moves to the h1', async () => {
  const h = await started();
  const old = h.el('home');
  h.doc.activeElement = old;
  await navigate(h, 'board', () => (h.doc.activeElement = old));
  assert.deepEqual(h.focused, ['board']);
  // ... and so does an element that is simply no longer rendered
  const h2 = await started();
  await navigate(h2, 'board', () => (h2.doc.activeElement = h2.el(null, false)));
  assert.deepEqual(h2.focused, ['board']);
});

test('router focus: a header control the user moved to on purpose keeps focus', async () => {
  const h = await started();
  h.doc.activeElement = h.el(null);
  const other = h.el(null);
  await navigate(h, 'board', () => (h.doc.activeElement = other));
  assert.deepEqual(h.focused, []);
  assert.equal(h.doc.activeElement, other);
});

test('router focus: a transition callback that fires twice swaps and focuses once', async () => {
  const h = await started();
  h.events.length = 0;
  const nav = h.router.go('board');
  await tick();
  h.vt.cb();
  h.vt.cb();
  h.vt.finish();
  await nav;
  assert.deepEqual(h.events, ['leave home', 'enter board', 'show board']);
  assert.deepEqual(h.focused, ['board']);
});

test('router focus: the popstate path and the instant path still focus the heading', async () => {
  const h = harness({ hash: '#home' });
  await h.router.start(true);
  assert.deepEqual(h.focused, ['home'], 'instant first screen');
  await h.router.go('help');
  h.focused.length = 0;
  h.userHash('#home');
  await tick();
  assert.deepEqual(h.focused, ['home'], 'Back');
});
