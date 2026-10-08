// Header and global furniture: language toggle, sound toggle, sync chip, account menu, logout flow, titles.

import { getLang, setLang, loadLang, dirFor, t } from '../i18n/index.js';
import { $, applyI18n, onAction, openDialog, closeDialog, setName } from './dom.js';
import { copyParams } from './params.js';

const STATUS_ICON = { synced: 'lp-check', saving: 'lp-clock', offline: 'lp-x', local: 'lp-user' };

/**
 * Whole-pixel height for a CSS custom property: rounded UP (a fractional height rounded down would leave a 1px
 * sliver of sticky UI over the content it is meant to clear), clamped to a sane range, and null for anything that
 * is not a real measurement (NaN, undefined, negative) so a bad read never overwrites a good value.
 * @param {unknown} h
 * @returns {number | null}
 */
export function pxHeight(h) {
  if (typeof h !== 'number' || !Number.isFinite(h) || h < 0) return null;
  return Math.min(4000, Math.ceil(h));
}

/**
 * Which status transitions deserve to be SPOKEN: going offline, and recovering to synced from offline/local.
 * The chip itself flips constantly (saving/synced on every solve) and must stay silent.
 */
export function statusAnnouncement(prevStable, next) {
  if (next === 'offline' && prevStable !== 'offline') return 'status.say.offline';
  if (next === 'synced' && (prevStable === 'offline' || prevStable === 'local')) return 'status.say.synced';
  return null;
}

export function createChrome(app) {
  const { doc, local, sync, store } = app;
  const header = $(doc, 'header');
  const dlg = $(doc, '[data-dialog="confirm-logout"]');
  const muteBtn = $(header, '[data-action="mute"]');

  // ---- sound facade: nothing loads until a sound is actually due ----
  let soundOn = false;
  let mod = null;
  const loadSound = () => (mod ??= import('./sound.js').then((m) => m.createSound()).catch(() => ({ play() {} })));
  const sound = {
    enabled: () => soundOn,
    play(name) {
      if (soundOn) loadSound().then((s) => s.play(name));
    },
    vibrate(ms) {
      try {
        if (app.win.navigator.vibrate) app.win.navigator.vibrate(ms);
      } catch {
        // some browsers throw without user activation
      }
    },
  };

  function paintMute() {
    muteBtn.setAttribute('aria-pressed', String(soundOn));
    const use = $(muteBtn, 'use');
    if (use) use.setAttribute('href', soundOn ? muteBtn.dataset.iconOn : muteBtn.dataset.iconOff);
  }

  /** Account setting once signed in (default OFF: a never-touched setting has at === 0); device pref before. */
  function readSound() {
    const s = store.get().session && sync.getSave();
    soundOn = s ? s.settings.sound === true && s.settings.at > 0 : local.loadPref().sound === true;
    paintMute();
  }

  function setSound(on) {
    soundOn = on;
    paintMute();
    if (store.get().session) sync.updateSettings({ sound: on });
    else local.storePref({ ...local.loadPref(), sound: on });
    if (on) sound.play('key'); // confirms the toggle and creates the AudioContext inside the click gesture
  }

  // ---- real header and dock heights for CSS (--lp-header-h, --lp-dock-h) ----
  // Sticky UI is taller than any guess in CSS (wrapping, language, font), and WCAG 2.4.11 needs focus scrolled clear
  // of it, so CSS gets the MEASURED values on :root. Only CSSOM property writes (CSP-safe), batched in one rAF.
  const root = doc.documentElement;
  const playSection = app.sections.play;
  let measureFrame = 0;
  const last = { header: null, dock: null };

  function measureNow() {
    measureFrame = 0;
    const dock = playSection && !playSection.hidden ? $(playSection, 'section[aria-labelledby="play-guess-title"]') : null;
    // Reads first, writes after: no layout thrash.
    const headerH = pxHeight(header.getBoundingClientRect().height);
    const dockH = dock ? pxHeight(dock.getBoundingClientRect().height) : null;
    if (headerH !== null && headerH !== last.header) {
      last.header = headerH;
      root.style.setProperty('--lp-header-h', headerH + 'px');
    }
    if (dockH !== last.dock) {
      last.dock = dockH;
      // No dock on screen (or no measurement): fall back to the CSS default instead of a stale number.
      if (dockH === null) root.style.removeProperty('--lp-dock-h');
      else root.style.setProperty('--lp-dock-h', dockH + 'px');
    }
  }

  function measure() {
    if (measureFrame) return;
    measureFrame = typeof app.win.requestAnimationFrame === 'function' ? app.win.requestAnimationFrame(measureNow) : (measureNow(), 0);
  }

  if (typeof app.win.ResizeObserver === 'function') {
    const ro = new app.win.ResizeObserver(measure);
    ro.observe(header);
    const dockEl = $(playSection, 'section[aria-labelledby="play-guess-title"]');
    if (dockEl) ro.observe(dockEl);
  }
  // Fallback and complement: viewport/orientation changes, the visual viewport (zoom, on-screen keyboard), web fonts.
  app.win.addEventListener('resize', measure);
  app.win.addEventListener('orientationchange', measure);
  if (app.win.visualViewport) app.win.visualViewport.addEventListener('resize', measure);
  if (doc.fonts) {
    if (doc.fonts.ready) doc.fonts.ready.then(measure, () => {});
    if (typeof doc.fonts.addEventListener === 'function') doc.fonts.addEventListener('loadingdone', measure);
  }

  // ---- text, language, title ----
  function updateTitle(name) {
    if (name) doc.title = `${t('title.' + name)} | ${t('brand.name')}`;
  }

  function applyAll() {
    const lang = getLang();
    doc.documentElement.lang = lang;
    doc.documentElement.dir = dirFor(lang);
    applyI18n(doc, copyParams(lang));
    // The toggle names the language you will GET, so its lang attribute is that language's, not the page's.
    $(header, '[data-action="lang"]').setAttribute('lang', lang === 'ar' ? 'en' : 'ar');
    setStatus(sync.getStatus());
    paintMute();
    updateTitle(app.router && app.router.current());
    measure(); // new language = new text = new heights
  }

  async function toggleLang() {
    const next = getLang() === 'en' ? 'ar' : 'en';
    if (!(await loadLang(next))) {
      app.toast('error.generic');
      return;
    }
    setLang(next);
    local.setLang(next);
    if (store.get().session) sync.updateSettings({ lang: next });
  }

  // ---- status chip, account ----
  // The chip's <output> is an implicit live region: turn that off and announce only what matters, from a
  // separate visually hidden status element.
  const chipOut = $(header, '[data-out="status"]');
  chipOut.setAttribute('aria-live', 'off');
  const announcer = doc.createElement('p');
  announcer.className = 'visually-hidden';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('data-live', 'sync');
  doc.body.append(announcer);
  let stable = null;

  function setStatus(s) {
    const chip = $(header, '.lp-chip');
    chipOut.textContent = t('status.' + s);
    chipOut.dataset.status = s;
    if (chip) {
      chip.dataset.status = s;
      const use = $(chip, 'use');
      if (use) use.setAttribute('href', use.getAttribute('href').split('#')[0] + '#' + STATUS_ICON[s]);
    }
    const key = statusAnnouncement(stable, s);
    if (s !== 'saving') stable = s;
    if (key) announcer.textContent = t(key);
  }

  function setSession(sess) {
    const acct = $(header, '[data-account]');
    acct.hidden = !sess;
    acct.open = false;
    if (sess) setName($(acct, '[data-out="name"]'), sess.name);
    readSound();
  }

  /** Pulled/updated saves can carry another device's language or sound choice. */
  async function onSave() {
    const sess = sync.getSession();
    if (!sess) return;
    setName($(header, '[data-out="name"]'), sess.name);
    const s = sync.getSave();
    if (s && s.settings.at > 0 && s.settings.lang !== getLang() && (await loadLang(s.settings.lang))) {
      setLang(s.settings.lang);
      local.setLang(s.settings.lang);
    }
    readSound();
  }

  // ---- logout (header button asks; the dialog confirms) ----
  let force = false;

  function dialogMode(pending) {
    force = pending;
    $(dlg, 'h2').setAttribute('data-i18n', pending ? 'dialog.logout.pendingTitle' : 'dialog.logout.title');
    $(dlg, 'p').setAttribute('data-i18n', pending ? 'dialog.logout.pendingDesc' : 'dialog.logout.desc');
    $(dlg, '[data-action="logout"]').setAttribute('data-i18n', pending ? 'dialog.logout.pendingConfirm' : 'dialog.logout.confirm');
    applyI18n(dlg, {});
  }

  async function confirmLogout(btn) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      // End a running round first so a Blood run is recorded instead of silently vanishing with the session.
      app.abandonRound();
      const r = await sync.signOut(force ? { force: true } : {});
      if (r.ok) {
        closeDialog(dlg);
        store.set({ session: null, result: null, round: null });
        setSession(null);
        app.afterLogout();
      } else if (r.pending) {
        dialogMode(true);
        const h = $(dlg, 'h2');
        h.tabIndex = -1;
        h.focus();
      } else {
        app.toast('error.generic');
        closeDialog(dlg);
      }
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }

  onAction(header, {
    lang: () => void toggleLang(),
    mute: () => setSound(!soundOn),
    logout: () => {
      dialogMode(false);
      openDialog(dlg);
    },
  });
  onAction(dlg, { logout: (b) => void confirmLogout(b) });
  dlg.addEventListener('close', () => dialogMode(false));

  return { sound, applyAll, setStatus, setSession, onSave, updateTitle, readSound, measure };
}
