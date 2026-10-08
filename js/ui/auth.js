// Sign-up (name -> code dialog) and sign-in (name + code). Errors always say what to do next, and a failed
// sign-in never reveals whether the name or the code was the wrong half.

import { getLang, t } from '../i18n/index.js';
import { NAME_MAX, formatCode, parseCode, validateName } from '../sync/index.js';
import { $, $$, closeDialog, onAction, openDialog, say, setDisabled } from './dom.js';

const FAIL_KEYS = { offline: 'auth.err.offline', denied: 'auth.err.denied', quota: 'auth.err.quota', unsupported: 'auth.err.unsupported', newer: 'auth.err.newer' };
const NAME_KEYS = { too_long: 'auth.err.name.too_long', control_chars: 'auth.err.name.control_chars', invisible: 'auth.err.name.invisible' };

export function createAuth(app) {
  const { doc, win, sync, store } = app;
  const root = app.sections.auth;
  const up = $(root, '[data-form="signup"]');
  const inn = $(root, '[data-form="signin"]');
  const dlg = $(doc, '[data-dialog="code"]');
  const codeOut = $(dlg, '[data-out="code"]');
  const ack = $(dlg, '#code-ack');
  const cont = $(dlg, '[data-action="ack-code"]');
  let busy = false;
  let rawCode = null;
  let acked = false;
  let localNotice = false;
  let copied = false;
  // <output> is an implicit live region; the code is read as part of the dialog description instead.
  codeOut.setAttribute('aria-live', 'off');

  const errOf = (form) => $(form, '[data-error]');
  const fieldsOf = (form) => $$(form, '[data-field]');

  function clearErrors(form) {
    const e = errOf(form);
    e.textContent = '';
    delete e.dataset.tone;
    for (const f of fieldsOf(form)) f.removeAttribute('aria-invalid');
  }

  function fail(form, msgs, bad) {
    const e = errOf(form);
    e.textContent = msgs.join(' ');
    e.dataset.tone = 'bad';
    for (const f of bad) f.setAttribute('aria-invalid', 'true');
    if (bad[0]) bad[0].focus();
  }

  /**
   * Progress is NOT written to the role=alert region (that carries only final, actionable errors). The form
   * is marked busy and the submit label changes in place; aria-disabled keeps focus on the button.
   */
  function setBusy(form, on, key) {
    busy = on;
    if (on) form.setAttribute('aria-busy', 'true');
    else form.removeAttribute('aria-busy');
    const b = $(form, '[type="submit"]');
    const label = $(b, '[data-i18n]') || b;
    label.textContent = on ? t(key) : t(label.getAttribute('data-i18n'));
    setDisabled(b, on);
  }

  const nameMsg = (reason) => t(NAME_KEYS[reason] || 'auth.err.name.empty', { max: String(NAME_MAX) });

  // ---- code dialog ----
  const onUnload = (e) => {
    e.preventDefault();
    e.returnValue = '';
  };

  function dialogMsg(tone) {
    const text = [copied ? t('dialog.code.copied') : '', localNotice ? t('dialog.code.localNotice') : ''].filter(Boolean).join(' ');
    say(dlg, text, tone || 'info', { sticky: true });
  }

  function showCode(code, local) {
    rawCode = code;
    acked = false;
    copied = false;
    localNotice = local;
    codeOut.textContent = formatCode(code);
    ack.checked = false;
    cont.disabled = true;
    dialogMsg();
    // The code exists nowhere else: leaving the tab before saving it would lose the account.
    win.addEventListener('beforeunload', onUnload);
    openDialog(dlg);
  }

  function selectCode() {
    const sel = win.getSelection && win.getSelection();
    if (!sel) return;
    const r = doc.createRange();
    r.selectNodeContents(codeOut);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  async function copyCode() {
    let ok = false;
    try {
      await win.navigator.clipboard.writeText(rawCode);
      ok = true;
    } catch {
      // no clipboard API, insecure context, or permission denied: fall back to selecting the text
    }
    if (rawCode === null) return;
    if (ok) {
      copied = true;
      dialogMsg('ok');
    } else {
      selectCode();
      say(dlg, [t('dialog.code.copyFail'), localNotice ? t('dialog.code.localNotice') : ''].filter(Boolean).join(' '), 'info', { sticky: true });
    }
  }

  function finishSignup() {
    if (!ack.checked || rawCode === null) return;
    acked = true;
    rawCode = null;
    win.removeEventListener('beforeunload', onUnload);
    closeDialog(dlg);
    // Only now does the account exist on this device (session + save are written on acknowledge).
    sync.acknowledge();
    // Wipe the code only after the dialog is gone, so assistive tech is not told "------" while it closes.
    codeOut.textContent = '------';
    acked = false;
    const session = sync.getSession();
    store.set({ session, codePending: false });
    app.chrome.setSession(session);
    void app.router.go('home');
  }

  dlg.addEventListener('cancel', (e) => {
    if (rawCode !== null) e.preventDefault();
  });
  // Chrome lets a second Esc through even when `cancel` is prevented; reopen rather than lose the code.
  dlg.addEventListener('close', () => {
    if (rawCode !== null && !acked) openDialog(dlg);
  });
  ack.addEventListener('change', () => {
    cont.disabled = !ack.checked;
  });
  onAction(dlg, { 'copy-code': () => void copyCode(), 'ack-code': finishSignup });

  // ---- forms ----
  function showForm(which) {
    clearErrors(up);
    clearErrors(inn);
    up.hidden = which !== 'signup';
    inn.hidden = which !== 'signin';
    const f = $(which === 'signup' ? up : inn, '[data-field="name"]');
    f.focus();
  }

  up.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    clearErrors(up);
    const nameEl = $(up, '[data-field="name"]');
    const v = validateName(nameEl.value);
    if (!v.ok) return fail(up, [nameMsg(v.reason)], [nameEl]);
    setBusy(up, true, 'auth.creating');
    let r;
    try {
      r = await sync.signUp(v.name);
    } catch {
      r = { ok: false, reason: 'error' };
    }
    setBusy(up, false);
    if (r.ok) {
      store.set({ codePending: true });
      // Sound defaults to OFF: write that explicitly, because a brand-new save defaults to ON.
      sync.updateSettings({ lang: getLang(), sound: false });
      nameEl.value = '';
      showCode(r.code, r.local === true);
    } else if (r.reason === 'already_signed_in') {
      void app.router.go('home');
    } else if (r.reason === 'invalid_name') {
      fail(up, [nameMsg(r.detail)], [nameEl]);
    } else {
      fail(up, [t(FAIL_KEYS[r.reason] || 'auth.err.error')], [nameEl]);
    }
  });

  inn.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    clearErrors(inn);
    const nameEl = $(inn, '[data-field="name"]');
    const codeEl = $(inn, '[data-field="code"]');
    const v = validateName(nameEl.value);
    const codeOk = parseCode(codeEl.value) !== null;
    if (!v.ok || !codeOk) {
      const msgs = [];
      const bad = [];
      if (!v.ok) {
        msgs.push(nameMsg(v.reason));
        bad.push(nameEl);
      }
      if (!codeOk) {
        msgs.push(t('auth.err.code.format'));
        bad.push(codeEl);
      }
      return fail(inn, msgs, bad);
    }
    setBusy(inn, true, 'auth.checking');
    let r;
    try {
      r = await sync.signIn(v.name, codeEl.value);
    } catch {
      r = { ok: false, reason: 'error' };
    }
    setBusy(inn, false);
    if (r.ok || r.reason === 'already_signed_in') {
      nameEl.value = '';
      codeEl.value = '';
      const session = sync.getSession();
      store.set({ session });
      app.chrome.setSession(session);
      void app.router.go('home');
    } else if (r.reason === 'invalid') {
      // Generic on purpose, and both fields are flagged: the message must not say which half was wrong.
      fail(inn, [t('auth.err.invalid')], [nameEl, codeEl]);
    } else if (r.reason === 'invalid_name') {
      fail(inn, [nameMsg(r.detail)], [nameEl]);
    } else if (r.reason === 'invalid_code') {
      fail(inn, [t('auth.err.code.format')], [codeEl]);
    } else {
      fail(inn, [t(FAIL_KEYS[r.reason] || 'auth.err.error')], [nameEl]);
    }
  });

  for (const f of [up, inn]) {
    f.addEventListener('input', (e) => {
      if (e.target instanceof Element) e.target.removeAttribute('aria-invalid');
    });
  }

  onAction(root, {
    'show-signin': () => showForm('signin'),
    'show-signup': () => showForm('signup'),
    'show-help': () => void app.router.go('help'),
  });

  return {
    /** Back to a pristine sign-up form (after logout). */
    reset() {
      for (const f of [up, inn]) {
        clearErrors(f);
        for (const i of fieldsOf(f)) i.value = '';
      }
      up.hidden = false;
      inn.hidden = true;
    },
    rerender() {
      // Error text is in the old language; the player can simply submit again.
      clearErrors(up);
      clearErrors(inn);
      if (rawCode !== null) dialogMsg();
    },
  };
}
