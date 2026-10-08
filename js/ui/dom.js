// DOM helpers. Everything dynamic goes through textContent / createElement: player names are user-controlled,
// so there is deliberately no innerHTML anywhere in js/.

import { t } from '../i18n/index.js';

export const $ = (root, sel) => root.querySelector(sel);
export const $$ = (root, sel) => Array.from(root.querySelectorAll(sel));

export const outs = (root, name) => $$(root, `[data-out="${name}"]`);

export function setOut(root, name, text) {
  for (const el of outs(root, name)) el.textContent = text;
}

/** Player names go in <bdi> so an RTL name cannot reorder the text around it. */
export function setName(el, name) {
  const b = document.createElement('bdi');
  b.textContent = name;
  el.replaceChildren(b);
}

export function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const k of kids) n.append(k);
  return n;
}

/**
 * A hardware key as a digit 0-9: ASCII, Arabic-Indic (U+0660-0669) and Eastern Arabic (U+06F0-06F9) keyboards.
 */
export function asciiDigit(key) {
  if (typeof key !== 'string' || key.length !== 1) return null;
  const c = key.charCodeAt(0);
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x660 && c <= 0x669) return c - 0x660;
  if (c >= 0x6f0 && c <= 0x6f9) return c - 0x6f0;
  return null;
}

/** aria-disabled keeps a control focusable and announced; `disabled` would drop focus to <body>. */
export const isDisabled = (b) => b.disabled === true || b.getAttribute('aria-disabled') === 'true';

export function setDisabled(b, on) {
  if (on) b.setAttribute('aria-disabled', 'true');
  else b.removeAttribute('aria-disabled');
}

/**
 * One delegated click handler per root; handlers are looked up by data-action. `other` receives clicks that
 * are not on an action (dials, keypad, tabs), so a root never needs a second listener. A disabled or
 * aria-disabled action never reaches its handler; `onDisabled` may explain why.
 */
export function onAction(root, handlers, other, onDisabled) {
  root.addEventListener('click', (e) => {
    const t0 = e.target;
    if (!(t0 instanceof Element)) return;
    const b = t0.closest('[data-action]');
    if (!b || !root.contains(b)) {
      if (other) other(t0, e);
      return;
    }
    if (isDisabled(b)) {
      if (onDisabled) onDisabled(b, e);
      return;
    }
    const h = handlers[b.getAttribute('data-action')];
    if (h) h(b, e);
  });
}

export function openDialog(dlg) {
  if (dlg.open) return;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

export function closeDialog(dlg) {
  if (!dlg.open) return;
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
}

const timers = new WeakMap();

/**
 * Message into the first data-out="msg" under `root`. Non-sticky messages clear themselves so a stale
 * "Wrong guess" never outlives the situation; tone is a CSS hook (ok|bad|info).
 */
export function say(root, text, tone = 'info', { sticky = false, ms = 4000 } = {}) {
  const m = $(root, '[data-out="msg"]');
  if (!m) return;
  clearTimeout(timers.get(m));
  m.textContent = text;
  if (text) m.dataset.tone = tone;
  else delete m.dataset.tone;
  if (text && !sticky) {
    timers.set(
      m,
      setTimeout(() => {
        m.textContent = '';
        delete m.dataset.tone;
      }, ms),
    );
  }
}

/**
 * App-level notice (errors that belong to no screen). Home/auth/help have no message sink of their own, so
 * this lazily creates one status element at the end of <body> (empty = display:none via the :empty rule).
 */
export function toast(text, tone = 'bad') {
  let n = $(document, '[data-toast]');
  if (!n) {
    n = el('p', { 'data-toast': '', role: 'status' });
    document.body.append(n);
  }
  clearTimeout(timers.get(n));
  n.textContent = text;
  n.dataset.tone = tone;
  timers.set(
    n,
    setTimeout(() => {
      n.textContent = '';
      delete n.dataset.tone;
    }, 6000),
  );
}

/** Visual direction of an element (the dial row stays LTR even on an RTL page). */
export const isRtl = (node) => getComputedStyle(node).direction === 'rtl';

/**
 * Live timers must not jitter: the font has no tabular digits and "1" is narrower, so each digit gets a
 * fixed 1ch cell. Updates in place when the shape is unchanged (no node churn each second).
 */
export function setDigits(node, text) {
  if (node.dataset.v === text) return;
  node.dataset.v = text;
  const chars = Array.from(text);
  const kids = node.children;
  if (kids.length !== chars.length) {
    node.replaceChildren(...chars.map(() => document.createElement('span')));
  }
  chars.forEach((ch, i) => {
    const s = kids[i];
    s.textContent = ch;
    const digit = ch >= '0' && ch <= '9';
    s.className = digit ? 'lp-d' : '';
    // Per-property CSSOM writes (never a style attribute) so a CSP without 'unsafe-inline' for styles allows them.
    const st = s.style;
    if (digit) {
      st.display = 'inline-block';
      st.inlineSize = '1ch';
      st.textAlign = 'center';
    } else {
      st.removeProperty('display');
      st.removeProperty('inline-size');
      st.removeProperty('text-align');
    }
  });
}

/** data-i18n -> textContent, data-i18n-attr="attr:key" -> attribute. `params` fills {placeholders}. */
export function applyI18n(root, params) {
  for (const n of $$(root, '[data-i18n]')) n.textContent = t(n.getAttribute('data-i18n'), params);
  for (const n of $$(root, '[data-i18n-attr]')) {
    for (const pair of n.getAttribute('data-i18n-attr').split(';')) {
      const i = pair.indexOf(':');
      if (i > 0) n.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim(), params));
    }
  }
}

/** Wrap an LTR run (digits, ids) so the bidi algorithm cannot reverse it inside Arabic text. */
export const ltr = (lang, s) => (lang === 'ar' ? `⁦${s}⁩` : String(s));
