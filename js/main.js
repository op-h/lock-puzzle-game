// Boot. The only module with top-level side effects. Screens other than auth are loaded on demand so the
// first load stays inside the JS budget (see docs/perf.md): play (and with it the puzzle engine), result,
// board, help and home are dynamic imports; home is requested early when a session exists.

import { createStore } from './store.js';
import { createRouter } from './router.js';
import { loadLang, onLangChange, resolveLang, setLang, t } from './i18n/index.js';
import { createAppSync } from './sync/index.js';
import { $$, toast } from './ui/dom.js';
import { createChrome } from './ui/chrome.js';
import { createAuth } from './ui/auth.js';

const doc = document;
const win = window;

const SCREENS = {
  home: () => import('./ui/home.js').then((m) => m.createHome),
  play: () => import('./ui/play.js').then((m) => m.createPlay),
  result: () => import('./ui/result.js').then((m) => m.createResult),
  board: () => import('./ui/board.js').then((m) => m.createBoard),
  help: () => import('./ui/help.js').then((m) => m.createHelp),
};

// Service workers need https (or localhost); on file: or plain http they would only throw.
function registerWorker() {
  const nav = win.navigator;
  const { protocol, hostname } = win.location;
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  if (!('serviceWorker' in nav) || !(protocol === 'https:' || (protocol === 'http:' && local))) return;
  // reg.update() on every load: the new worker installs in the background and takes over on the NEXT load.
  const go = () => nav.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => reg.update()).catch(() => {});
  if (doc.readyState === 'complete') go();
  else win.addEventListener('load', go, { once: true });
}

async function boot() {
  const { sync, local, remote } = createAppSync({ events: win });
  const sections = {};
  for (const s of $$(doc, '[data-screen]')) sections[s.getAttribute('data-screen')] = s;
  const store = createStore({ session: null, round: null, result: null, codePending: false });
  const hadSession = local.getSession() !== null;

  const ctrls = {};
  const loading = {};
  /** Per page load; names this tab in the Blood-run ownership record (a reload releases the run on pagehide). */
  const tabId = Array.from(win.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
  const app = { doc, win, sync, local, remote, store, sections, clock: null, router: null, chrome: null, sound: null, tabId };

  function ensure(name) {
    if (ctrls[name]) return Promise.resolve(ctrls[name]);
    loading[name] ??= SCREENS[name]()
      .then((factory) => (ctrls[name] = factory(app)))
      .catch((err) => {
        delete loading[name]; // allow a retry (e.g. the network came back)
        throw err;
      });
    return loading[name];
  }

  const fail = (key, tone = 'bad') => toast(t(key), tone);
  app.toast = fail;
  app.ensure = ensure;
  app.startClassic = (d) => ensure('play').then((p) => p.startClassic(d)).catch(() => fail('error.generic'));
  app.startBlood = () => ensure('play').then((p) => p.startBlood()).catch(() => fail('error.generic'));
  app.abandonRound = () => {
    if (ctrls.play) ctrls.play.abandon();
  };
  app.dropRound = () => {
    if (ctrls.play) ctrls.play.drop();
  };
  app.rerender = () => {
    app.chrome.applyAll();
    authCtrl.rerender();
    for (const c of Object.values(ctrls)) if (c.rerender) c.rerender();
  };
  app.afterLogout = () => {
    authCtrl.reset();
    void app.router.go('auth', { replace: true });
  };

  // Language first, before anything renders text. The catalog is a dynamic import (one per language), which
  // index.html should modulepreload; if it cannot load (offline, uncached) English is the floor.
  let startLang = local.getLang() || resolveLang(win.navigator.language);
  if (!(await loadLang(startLang))) {
    startLang = 'en';
    await loadLang('en');
  }
  setLang(startLang);

  if (hadSession) void ensure('home').catch(() => {});

  const chrome = createChrome(app);
  app.chrome = chrome;
  app.sound = chrome.sound;
  const authCtrl = createAuth(app);
  chrome.applyAll();
  sync.subscribe(chrome.setStatus);
  // Never silent: a cloud save from a newer app, or a device that refuses to store, each get a visible notice.
  sync.subscribeIssue((kind) => {
    if (kind) fail('status.issue.' + kind);
  });
  sync.subscribeSave(() => {
    void chrome.onSave();
    for (const n of ['home', 'result']) if (ctrls[n]) ctrls[n].refresh();
  });
  onLangChange(() => app.rerender());

  app.router = createRouter({
    win,
    names: Object.keys(sections),
    fallback: 'home',
    sections,
    load: (name) => (name === 'auth' ? Promise.resolve(authCtrl) : ensure(name)),
    guard(name) {
      const s = store.get();
      if (!s.session) return name === 'help' ? 'help' : 'auth';
      // Stay on auth while the one-time code is on screen: the code dialog owns that moment.
      if (name === 'auth') return s.codePending ? 'auth' : 'home';
      if (name === 'play') return s.round ? 'play' : 'home';
      if (name === 'result') return s.result ? 'result' : 'home';
      return name;
    },
    canLeave: (from, to) => !(from === 'play' && store.get().round && to !== 'play'),
    onBlocked(from) {
      // Back/forward during a round opens the quit confirmation instead of silently abandoning it.
      if (from === 'play') ensure('play').then((p) => p.askQuit()).catch(() => {});
    },
    onShow(name) {
      chrome.updateTitle(name);
      chrome.measure(); // the play dock exists only on the play screen
      if (name !== 'play' && name !== 'result') delete doc.body.dataset.mode;
    },
    onError: () => fail('error.generic'),
  });

  // No session means nothing on this device belongs to a live account: sweep leftovers (a sign-up whose code was
  // never acknowledged, an older crash) so no orphan save or run resurrects later.
  if (!local.getSession()) local.clearAccount();

  // Totally local first: the cached save is on screen before any network answer.
  const resumed = await sync.resume();
  let landing = null;
  if (resumed.session) {
    store.set({ session: resumed.session });
    chrome.setSession(resumed.session);
    resumed.pulled.catch(() => {});
    // Only a raw presence check here: validating it needs game/progress.js, which drags in the puzzle engine.
    const rec = local.loadRun(resumed.session.id);
    if (rec) {
      try {
        landing = (await ensure('play')).restore(rec, sync.getSave());
      } catch {
        landing = null;
      }
    }
    if (landing === 'play' || landing === 'result') win.history.replaceState(null, '', '#' + landing);
  }
  await app.router.start(resumed.session !== null);
  if (landing === 'other-tab') fail('home.blood.otherTab', 'info');

  // Cross-tab: a logout elsewhere signs this tab out; another tab's solves are merged into this one.
  // Loaded after first paint: it is not needed to show the first screen, so it stays out of the first-load budget.
  import('./sync/tabs.js')
    .then((m) =>
      m.watchTabs({
        win,
        sync,
        onSignedOut: () => {
          app.dropRound(); // writes nothing: the account is already wiped from storage
          store.set({ session: null, result: null, round: null, codePending: false });
          chrome.setSession(null);
          app.afterLogout();
        },
      }),
    )
    .catch(() => {});
}

// ---- global safety net: one non-blocking message, never a loop, nothing in the console ----
let lastReport = 0;
let reporting = false;
function report() {
  const now = Date.now();
  if (reporting || now - lastReport < 5000) return;
  reporting = true;
  lastReport = now;
  try {
    toast(t('error.generic'), 'bad');
  } catch {
    // nothing sensible left to do
  } finally {
    reporting = false;
  }
}
win.addEventListener('error', (e) => {
  if (!e.target || e.target === win) report();
});
win.addEventListener('unhandledrejection', report);

// Hidden until the first route is chosen so a signed-in player never sees the sign-in screen flash.
// (Only effective once PRISM styles html[data-boot="pending"]; see RISKS.)
doc.documentElement.dataset.boot = 'pending';
boot()
  .catch(report)
  .finally(() => {
    delete doc.documentElement.dataset.boot;
    registerWorker();
  });
