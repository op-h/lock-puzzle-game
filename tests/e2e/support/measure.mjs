// Self-contained in-page measurement functions (serialised by page.evaluate: no closures over Node scope).

/** Layout, overflow, clipping, targets, pixel-look and dock metrics for the visible screen. */
export function layoutAudit() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const q = (s) => document.querySelector(s);
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      let p = e.tagName.toLowerCase();
      if (e.id) p += '#' + e.id;
      else if (e.dataset && e.dataset.action) p += `[${e.dataset.action}]`;
      else if (e.dataset && e.dataset.slot) p += `[${e.dataset.slot}]`;
      else if (e.dataset && e.dataset.out) p += `[out ${e.dataset.out}]`;
      else if (e.className && typeof e.className === 'string') p += '.' + e.className.split(' ')[0];
      parts.unshift(p);
    }
    return parts.join(' > ');
  };
  const isHiddenClip = (el, cs) => {
    // visually-hidden pattern and the parked skip link are intentionally out of flow
    const r = el.getBoundingClientRect();
    return (cs.position === 'absolute' && r.width <= 2 && r.height <= 2) || el.classList.contains('skip-link');
  };
  const visible = (el) => {
    if (el.closest('[hidden]') || el.closest('dialog:not([open])') || el.closest('noscript')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !isHiddenClip(el, cs);
  };
  const scrollerAncestor = (el) => {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const o = getComputedStyle(e).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };
  const all = [...document.body.querySelectorAll('*')].filter((e) => !['SCRIPT', 'STYLE', 'USE', 'path', 'symbol', 'defs'].includes(e.tagName) && !(e instanceof SVGElement && e.tagName !== 'svg'));
  const vis = all.filter(visible);

  const overflowEls = [];
  for (const el of vis) {
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 0.5 || r.left < -0.5) && !scrollerAncestor(el)) {
      // an element that is merely wider than the viewport but clipped by an overflow:hidden parent is a clipping bug too
      overflowEls.push(`${path(el)} [${Math.round(r.left)}..${Math.round(r.right)}] vw=${vw}`);
    }
  }

  const clipped = [];
  for (const el of vis) {
    const cs = getComputedStyle(el);
    if (cs.display === 'inline') continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const clipX = ['hidden', 'clip'].includes(cs.overflowX);
    const clipY = ['hidden', 'clip'].includes(cs.overflowY);
    if (clipX && el.scrollWidth > el.clientWidth + 1) clipped.push(`${path(el)} x ${el.scrollWidth}>${el.clientWidth} "${el.textContent.trim().slice(0, 30)}"`);
    if (clipY && el.scrollHeight > el.clientHeight + 1) clipped.push(`${path(el)} y ${el.scrollHeight}>${el.clientHeight} "${el.textContent.trim().slice(0, 30)}"`);
    if (cs.textOverflow === 'ellipsis' && (cs.overflowX !== 'visible')) clipped.push(`${path(el)} uses text-overflow:ellipsis`);
  }

  // interactive targets (WCAG 2.5.8 minimum 24, project rule 44)
  const targets = [];
  const ctl = document.body.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="tab"], [tabindex="0"]');
  for (const el of ctl) {
    if (el.closest('[hidden]') || el.closest('dialog:not([open])') || el.closest('noscript')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    let box = el.getBoundingClientRect();
    let label = null;
    if (el.matches('input[type="radio"], input[type="checkbox"]')) {
      label = document.querySelector(`label[for="${el.id}"]`);
      if (label) {
        const lr = label.getBoundingClientRect();
        // the overlay radio and its label share the target; take the union
        box = { width: Math.max(box.width, lr.width), height: Math.max(box.height, lr.height), left: Math.min(box.left, lr.left), top: Math.min(box.top, lr.top) };
      }
    }
    if (box.width === 0 && box.height === 0) continue;
    if (isHiddenClip(el, cs)) continue;
    // inline links inside a sentence are exempt from 2.5.8 ("inline" exception)
    const inline = el.tagName === 'A' && cs.display === 'inline' && !!el.closest('p, li, dd') && [...el.parentNode.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 3);
    targets.push({ p: path(el), w: Math.round(box.width * 10) / 10, h: Math.round(box.height * 10) / 10, inline, disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true' });
  }
  const under24 = targets.filter((t) => !t.inline && (t.w < 24 || t.h < 24)).map((t) => `${t.p} ${t.w}x${t.h}`);
  const under44 = targets.filter((t) => !t.inline && (t.w < 44 || t.h < 44) && !(t.w < 24 || t.h < 24)).map((t) => `${t.p} ${t.w}x${t.h}`);

  // pixel look
  const radius = [];
  let transitionAll = 0;
  for (const el of all) {
    const cs = getComputedStyle(el);
    for (const k of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']) {
      if (cs[k] !== '0px') radius.push(`${path(el)} ${k}=${cs[k]}`);
    }
    const props = cs.transitionProperty.split(',').map((s) => s.trim());
    const durs = cs.transitionDuration.split(',').map((s) => parseFloat(s));
    if (props.includes('all') && durs.some((d) => d > 0)) transitionAll++;
  }
  const sprites = [...document.querySelectorAll('svg.lp-sprite, svg.lp-icon')].filter(visible);
  const sprite = {
    count: sprites.length,
    imageRendering: [...new Set(sprites.map((s) => getComputedStyle(s).imageRendering))],
    shapeRendering: [...new Set(sprites.map((s) => getComputedStyle(s).shapeRendering))],
    sizes: [...new Set(sprites.map((s) => `${Math.round(s.getBoundingClientRect().width)}x${Math.round(s.getBoundingClientRect().height)}`))],
    nonInteger: sprites.filter((s) => { const r = s.getBoundingClientRect(); return r.width % 1 > 0.01 || r.height % 1 > 0.01; }).length,
  };
  const fonts = { pixelify: document.fonts.check('16px "Pixelify Sans"'), loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family) };
  const bodyFont = getComputedStyle(document.body).fontFamily;

  // header / dock / primary controls
  const header = q('header').getBoundingClientRect();
  const dockEl = q('[data-screen="play"]:not([hidden]) > section[aria-labelledby="play-guess-title"]');
  let dock = null;
  if (dockEl) {
    const dr = dockEl.getBoundingClientRect();
    const sticky = getComputedStyle(dockEl).position === 'sticky';
    const prim = [...dockEl.querySelectorAll('[data-slot="dials"] > button, [data-slot="keypad"] > button, [data-action="check"], [data-action="clear"]')].filter((e) => !e.closest('[hidden]'));
    const outside = prim.filter((e) => { const r = e.getBoundingClientRect(); return sticky && (r.top < dr.top - 0.5 || r.bottom > dr.bottom + 0.5); }).length;
    const notInView = prim.filter((e) => { const r = e.getBoundingClientRect(); return sticky && (r.bottom > vh + 0.5 || r.top < header.bottom - 0.5); }).length;
    dock = { sticky, h: Math.round(dr.height), top: Math.round(dr.top), headerH: Math.round(header.height), freeViewportH: Math.round(Math.max(0, (sticky ? dr.top : vh) - header.bottom)), primaryOutsideDock: outside, primaryNotInView: notInView, dialsFitRow: (() => { const ds = [...dockEl.querySelectorAll('[data-slot="dials"] > button')].map((b) => b.getBoundingClientRect()); return ds.length ? { n: ds.length, w: Math.round(ds[0].width), h: Math.round(ds[0].height), wrapped: new Set(ds.map((r) => Math.round(r.top))).size > 1 } : null; })() };
  }
  // one row = every header item's vertical centre within 6 px of the header's centre (items differ in height)
  const hkids = [...q('header').children].filter((c) => !c.hidden && c.getBoundingClientRect().height > 0 && getComputedStyle(c).display !== 'none' && getComputedStyle(c).position !== 'absolute');
  const header2 = { h: Math.round(header.height), rows: hkids.some((c) => { const r = c.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - (header.top + header.height / 2)) > 6; }) ? 2 : 1 };
  const screen = (q('main > [data-screen]:not([hidden])') || {}).dataset?.screen || null;
  const de = document.documentElement;
  return {
    screen,
    vw,
    vh,
    scrollW: de.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    hscroll: de.scrollWidth > vw || document.body.scrollWidth > vw,
    overflowEls: overflowEls.slice(0, 8),
    clipped: clipped.slice(0, 8),
    under24,
    under44,
    targetCount: targets.length,
    radius: radius.slice(0, 5),
    transitionAll,
    sprite,
    fonts,
    bodyFont,
    dock,
    header: header2,
    lang: de.lang,
    dir: de.dir,
    mode: document.body.dataset.mode || null,
  };
}

/** WCAG contrast of every visible text node against its composited background, plus UI frame and focus ring pairs. */
export function contrastAudit() {
  const parse = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (!m) {
      // color(srgb r g b / a) from color-mix()
      const c = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+%?))?\)/.exec(s);
      if (c) return { r: +c[1] * 255, g: +c[2] * 255, b: +c[3] * 255, a: c[4] === undefined ? 1 : c[4].endsWith('%') ? parseFloat(c[4]) / 100 : +c[4] };
      return null;
    }
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bot) => {
    const a = top.a + bot.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a };
  };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = L(a); const y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const canvas = () => {
    // the canvas colour under an unpainted page follows color-scheme
    const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark') && matchMedia('(prefers-color-scheme: dark)').matches;
    return { r: dark ? 18 : 255, g: dark ? 18 : 255, b: dark ? 18 : 255, a: 1 };
  };
  let ditherNote = false;
  const bgOf = (el) => {
    const layers = [];
    let dither = false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const bg = parse(cs.backgroundColor);
      if (cs.backgroundImage !== 'none' && /conic-gradient/.test(cs.backgroundImage)) dither = true;
      if (bg && bg.a > 0) layers.push(bg);
      if (bg && bg.a === 1) break;
    }
    let out = layers.length && layers[layers.length - 1].a === 1 ? layers.pop() : canvas();
    while (layers.length) out = over(layers.pop(), out);
    return { bg: out, dither };
  };
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 3; e = e.parentElement) {
      let p = e.tagName.toLowerCase();
      if (e.id) p += '#' + e.id;
      else if (e.dataset && e.dataset.action) p += `[${e.dataset.action}]`;
      else if (e.dataset && e.dataset.out) p += `[out ${e.dataset.out}]`;
      else if (e.dataset && e.dataset.slot) p += `[${e.dataset.slot}]`;
      parts.unshift(p);
    }
    return parts.join(' > ');
  };
  const effOpacity = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const fails = [];
  const infos = [];
  let checked = 0;
  let min = { r: 99, where: '' };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest('[hidden], noscript, script, style') || el.closest('dialog:not([open])')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    if (cs.position === 'absolute' && r.width <= 2) continue; // visually hidden
    let fg = parse(cs.color);
    if (!fg) continue;
    const { bg, dither } = bgOf(el);
    const op = effOpacity(el);
    fg = { ...fg, a: fg.a * op };
    const fgc = over(fg, bg);
    let cr = ratio(fgc, bg);
    if (dither) {
      // body carries a 2x2 checker of text@8%: the worst cell is the bg pulled towards the text colour
      const t = parse(getComputedStyle(document.body).color);
      const worst = over({ ...t, a: 0.08 }, bg);
      cr = Math.min(cr, ratio(fgc, worst));
    }
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    const disabled = !!el.closest('[disabled], [aria-disabled="true"]');
    checked++;
    if (cr < min.r) min = { r: Math.round(cr * 100) / 100, where: path(el) };
    if (cr < need) (disabled ? infos : fails).push(`${path(el)} ${cr.toFixed(2)}:${need} fg=${cs.color} bg=rgb(${bg.r | 0},${bg.g | 0},${bg.b | 0}) "${el.textContent.trim().slice(0, 24)}"${disabled ? ' (inactive)' : ''}`);
  }
  // UI component frames (3:1): first colour in the box-shadow of buttons/inputs/dials against the surface behind them
  const ui = [];
  for (const el of document.body.querySelectorAll('button, input:not([type="radio"]):not([type="checkbox"]), [data-slot="difficulty-picker"] label, summary')) {
    if (el.closest('[hidden]') || el.closest('dialog:not([open])')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2) continue;
    const m = /(rgba?\([^)]+\)|color\(srgb[^)]+\))\s+0px\s+(-?\d+)px/.exec(cs.boxShadow) || /(rgba?\([^)]+\)|color\(srgb[^)]+\))/.exec(cs.boxShadow);
    const bgSelf = parse(cs.backgroundColor);
    const parentBg = bgOf(el.parentElement || el).bg;
    const surface = bgSelf && bgSelf.a === 1 ? bgSelf : parentBg;
    const frame = m ? parse(m[1]) : null;
    const border = parse(cs.borderTopColor);
    const bw = parseFloat(cs.borderTopWidth);
    const f = frame || (bw > 0 && border && border.a > 0 ? border : null);
    if (!f) { ui.push({ p: path(el), r: null }); continue; }
    ui.push({ p: path(el), r: Math.round(ratio(f, parentBg) * 100) / 100, surfaceVsParent: Math.round(ratio(surface, parentBg) * 100) / 100 });
  }
  const uiFail = ui.filter((u) => u.r !== null && u.r < 3 && !(u.surfaceVsParent >= 3)).map((u) => `${u.p} frame ${u.r}:3`);
  const uiNoFrame = ui.filter((u) => u.r === null).map((u) => u.p);
  return { checked, min, fails: fails.slice(0, 12), failCount: fails.length, inactiveBelow: infos.length, uiChecked: ui.length, uiFail: uiFail.slice(0, 8), uiNoFrame: uiNoFrame.slice(0, 6), scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', mode: document.body.dataset.mode || 'classic' };
}

/** Contrast of the focus ring of the currently focused element against what is behind it. */
export function focusRingAudit() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const parse = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = L(a); const y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const label = el.matches('input[type="radio"]') ? document.querySelector(`label[for="${el.id}"]`) : null;
  const ringEl = label || el;
  const cs = getComputedStyle(ringEl);
  let bg = null;
  for (let e = ringEl.parentElement; e; e = e.parentElement) {
    const c = parse(getComputedStyle(e).backgroundColor);
    if (c && c.a === 1) { bg = c; break; }
  }
  if (!bg) bg = { r: 255, g: 255, b: 255, a: 1 };
  const outline = parse(cs.outlineColor);
  const sh = /(rgba?\([^)]+\))\s+0px 0px 0px (\d+)px/.exec(cs.boxShadow.split(/,(?![^(]*\))/).pop().trim()) || /(rgba?\([^)]+\))/.exec(cs.boxShadow);
  const inner = sh ? parse(sh[1]) : null;
  return {
    el: el.tagName.toLowerCase() + (el.dataset.action ? `[${el.dataset.action}]` : el.id ? '#' + el.id : ''),
    outlineWidth: cs.outlineWidth,
    outlineStyle: cs.outlineStyle,
    outlineVsBg: outline ? Math.round(ratio(outline, bg) * 100) / 100 : null,
    innerVsBg: inner ? Math.round(ratio(inner, bg) * 100) / 100 : null,
    bestVsBg: Math.max(outline ? ratio(outline, bg) : 0, inner ? ratio(inner, bg) : 0),
    ringBands: outline && inner ? Math.round(ratio(outline, inner) * 100) / 100 : null,
  };
}
