// Router behaviour against a fake window: guards, ignored fragments, blocked leaves, racing loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../../js/router.js';

function harness({ hash = '', guard, canLeave = () => true, load } = {}) {
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
  const sections = Object.fromEntries(names.map((n) => [n, { hidden: n !== 'auth', querySelector: () => ({ focus: () => focused.push(n) }) }]));
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
  return { win, router, hist, events, blocked, focused, visible, userHash };
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
