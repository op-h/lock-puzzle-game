// In-page audits shared by the keyboard spec and the viewport matrix. Everything is computed in the browser
// from real layout (bounding boxes, computed style, hit testing); nothing is inferred from the CSS source.

/** Walk the document with the Tab key and record, per stop, focus-ring style and whether it is obscured. */
export async function tabWalk(page, { max = 90, reverse = false } = {}) {
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    window.scrollTo(0, 0);
    // blur() alone leaves the sequential-focus starting point where focus was. Focusing a tabindex=-1 <body>
    // moves the starting point to the top of the document, as a fresh page load has it.
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
  const stops = [];
  const seen = new Set();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
    const s = await page.evaluate((idx) => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { body: true };
      const insideDialog = !!el.closest('dialog');
      const label = el.matches('input[type="radio"], input[type="checkbox"]') ? document.querySelector(`label[for="${el.id}"]`) : null;
      const ringEl = el.matches('input[type="radio"]') && label ? label : el;
      const cs = getComputedStyle(ringEl);
      const r = el.getBoundingClientRect();
      const box = label && el.matches('input[type="radio"]') ? label.getBoundingClientRect() : r;
      const header = document.querySelector('header');
      const hr = header.getBoundingClientRect();
      const dockEl = document.querySelector('[data-screen="play"]:not([hidden]) > section[aria-labelledby="play-guess-title"]');
      const dr = dockEl ? dockEl.getBoundingClientRect() : null;
      const dockSticky = dockEl && getComputedStyle(dockEl).position === 'sticky';
      const toast = document.querySelector('[data-toast]');
      const tr = toast && toast.textContent.trim() ? toast.getBoundingClientRect() : null;
      const hsticky = getComputedStyle(header).position === 'sticky' || getComputedStyle(header).position === 'fixed';
      const inter = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      // hit test the centre of the focused control: whatever is on top must be the control (or its label/descendant)
      const cx = Math.min(innerWidth - 1, Math.max(0, box.left + box.width / 2));
      const cy = Math.min(innerHeight - 1, Math.max(0, box.top + box.height / 2));
      const top = document.elementFromPoint(cx, cy);
      const hitOk = el.classList.contains('skip-link') || (!!top && (el.contains(top) || top.contains(el) || (label && (label.contains(top) || top === label))));
      const key = el.id ? '#' + el.id : el.dataset.action ? `[${el.dataset.action}]` : el.dataset.digit !== undefined ? `[digit ${el.dataset.digit}]` : el.dataset.dial !== undefined ? `[dial ${el.dataset.dial}]` : el.dataset.tab ? `[tab ${el.dataset.tab}]` : el.tagName.toLowerCase();
      const name = `${el.tagName.toLowerCase()}${key.startsWith('#') || key.startsWith('[') ? key : ''}`;
      const already = el.hasAttribute('data-ts');
      if (!already) el.setAttribute('data-ts', String(idx));
      const sig = name + '#' + el.getAttribute('data-ts');
      return {
        already,
        skip: el.classList.contains('skip-link'),
        sig,
        name,
        text: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 40),
        inDialog: insideDialog,
        inHeader: header.contains(el),
        inDock: !!dockEl && dockEl.contains(el),
        focusVisible: ringEl.matches(':focus-visible') || el.matches(':focus-visible'),
        ring: { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor, boxShadow: cs.boxShadow, outlineOffset: cs.outlineOffset },
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height },
        hitOk,
        inViewport: box.top >= -0.5 && box.bottom <= innerHeight + 0.5 && box.left >= -0.5 && box.right <= innerWidth + 0.5,
        // the skip link is meant to paint over the header (it has the top z-index); everything else must not be covered
        underHeader: !el.classList.contains('skip-link') && !header.contains(el) && hsticky && inter(box, hr),
        underDock: !!dockEl && !dockEl.contains(el) && dockSticky && inter(box, dr),
        underToast: tr && !(toast.contains(el)) && inter(box, tr),
        headerBottom: hr.bottom,
        dockTop: dr ? dr.top : null,
        scrollY: Math.round(scrollY),
      };
    }, i);
    if (s.body) {
      stops.push(s);
      if (stops.length > 1 && stops[stops.length - 2].body) break;
      continue;
    }
    if (s.already) {
      stops.push({ wrapped: true, sig: s.sig });
      break;
    }
    seen.add(s.sig);
    stops.push(s);
  }
  return stops;
}

/**
 * Do the Tab stops come in the order a sighted user reads the page? Positions are taken in the document flow with the
 * sticky header and dock set to static (they would otherwise reorder by scroll position). Returns the list of
 * adjacent pairs that go backwards visually.
 */
export async function readingOrderViolations(page, stops) {
  const real = stops.filter((s) => !s.body && !s.wrapped && !s.inDialog && !s.skip);
  const sigs = real.map((s) => s.sig);
  return page.evaluate((sigsIn) => {
    const restore = [];
    for (const el of [document.querySelector('header'), document.querySelector('[data-screen="play"]:not([hidden]) > section[aria-labelledby="play-guess-title"]')]) {
      if (!el) continue;
      restore.push([el, el.style.position]);
      el.style.position = 'static';
    }
    window.scrollTo(0, 0);
    const tsOf = (sig) => sig.split('#').pop();
    const els = sigsIn.map((sig) => document.querySelector(`[data-ts="${tsOf(sig)}"]`));
    const names = sigsIn.map((sig) => sig.split('#')[0]);
    const pos = (el) => {
      const label = el.matches('input[type="radio"]') ? document.querySelector(`label[for="${el.id}"]`) : null;
      const r = (label || el).getBoundingClientRect();
      return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, cy: r.top + scrollY + r.height / 2, h: r.height, rtl: getComputedStyle(el).direction === 'rtl' };
    };
    const sameRow = (a, b) => Math.abs(a.cy - b.cy) < Math.min(a.h, b.h) * 0.5;
    // A later stop that sits entirely in the next COLUMN (inline-end side) is normal column reading order (left column, then right).
    const nextColumn = (a, b) => (a.rtl ? b.right <= a.left + 1 : b.left >= a.right - 1);
    const before = (a, b) => (sameRow(a, b) ? (a.rtl ? a.left > b.left + 1 : a.left < b.left - 1) : a.cy < b.cy);
    const bad = [];
    for (let i = 0; i + 1 < els.length; i++) {
      if (!els[i] || !els[i + 1]) continue;
      const a = pos(els[i]);
      const b = pos(els[i + 1]);
      // Tab goes forward: the next stop must not be visually BEFORE the previous one
      if (before(b, a) && !nextColumn(a, b) && !(sameRow(a, b) && Math.abs(a.left - b.left) <= 1)) bad.push(`${names[i]} -> ${names[i + 1]}`);
    }
    for (const [el, p] of restore) el.style.position = p;
    document.querySelectorAll('[data-ts]').forEach((e) => e.removeAttribute('data-ts'));
    return bad;
  }, sigs);
}

/** Pure judgement of a walk: returns an array of human-readable problems. */
export function judgeWalk(stops, { requireRing = true, obscured = true } = {}) {
  const out = [];
  const real = stops.filter((s) => !s.body && !s.wrapped);
  if (real.length === 0) out.push('no tab stops at all');
  for (const s of real) {
    const ringStyle = s.ring.outlineStyle !== 'none' && parseFloat(s.ring.outlineWidth) >= 2;
    const shadow = s.ring.boxShadow && s.ring.boxShadow !== 'none';
    if (requireRing && !(ringStyle && shadow) && !(ringStyle && parseFloat(s.ring.outlineWidth) >= 3)) out.push(`${s.name} "${s.text}": weak/missing focus ring ${JSON.stringify(s.ring)}`);
    if (!obscured) continue;
    if (s.underHeader) out.push(`${s.name} "${s.text}": focused control is under the sticky header (top ${Math.round(s.rect.top)} < header bottom ${Math.round(s.headerBottom)})`);
    if (s.underDock) out.push(`${s.name} "${s.text}": focused control is under the sticky dock`);
    if (s.underToast) out.push(`${s.name} "${s.text}": focused control is under a toast`);
    if (!s.hitOk && !s.inDialog) out.push(`${s.name} "${s.text}": something else is on top of the focused control's centre`);
    if (!s.inViewport) out.push(`${s.name} "${s.text}": focused control is not fully inside the viewport (rect ${Math.round(s.rect.left)},${Math.round(s.rect.top)} ${Math.round(s.rect.w)}x${Math.round(s.rect.h)})`);
  }
  return out;
}
