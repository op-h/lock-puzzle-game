// prefers-contrast: more and forced-colors: active render check (dev-only): layout audit + contrast + screenshots.
//   node tests/e2e/matrix/run-modes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../support/harness.mjs';
import { layoutAudit, contrastAudit } from '../support/measure.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'modes');
fs.mkdirSync(OUT, { recursive: true });
const srv = await H.startServer();
const br = await H.launchBrowser();
const d = await H.openDevice(br, { baseUrl: srv.url, backend: H.createBackend(), viewport: { width: 390, height: 844 }, mobile: true, allow: [/./] });
const { page } = d;
const rows = [];
const modes = [
  { name: 'contrast-more-dark', media: { contrast: 'more', scheme: 'dark' } },
  { name: 'contrast-more-light', media: { contrast: 'more', scheme: 'light' } },
  { name: 'forced-colors-dark', media: { forced: true, scheme: 'dark' } },
  { name: 'forced-colors-light', media: { forced: true, scheme: 'light' } },
];
async function sweep(state) {
  for (const m of modes) {
    await d.pin({ motion: 'no-preference', scheme: 'dark', contrast: 'no-preference', forced: false, ...m.media });
    await page.waitForTimeout(80);
    const a = await page.evaluate(layoutAudit);
    const probe = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('main button, header button')].filter((b) => b.getBoundingClientRect().width > 0 && !b.closest('[hidden]'));
      const border = (b) => parseFloat(getComputedStyle(b).borderTopWidth) > 0 || /\d/.test(getComputedStyle(b).outlineWidth) && getComputedStyle(b).outlineStyle !== 'none';
      const dials = [...document.querySelectorAll('[data-slot="dials"] > button')];
      return {
        buttons: btns.length,
        withVisibleBorder: btns.filter((b) => parseFloat(getComputedStyle(b).borderTopWidth) >= 1).length,
        frameMissing: btns.filter((b) => parseFloat(getComputedStyle(b).borderTopWidth) < 1 && getComputedStyle(b).boxShadow === 'none').map((b) => b.dataset.action || b.textContent.trim().slice(0, 12)),
        selectedDialMarked: dials.length ? dials.some((b) => getComputedStyle(b).outlineStyle !== 'none' || getComputedStyle(b).borderTopWidth !== '0px') : null,
        fg: getComputedStyle(document.body).color,
        bg: getComputedStyle(document.body).backgroundColor,
        forced: matchMedia('(forced-colors: active)').matches,
        more: matchMedia('(prefers-contrast: more)').matches,
      };
    });
    const c = m.name.startsWith('forced') ? null : await page.evaluate(contrastAudit);
    rows.push({ state, mode: m.name, hscroll: a.hscroll, clipped: a.clipped.length, under24: a.under24.length, under44: a.under44.length, probe, contrast: c && { min: c.min, fails: c.fails, ui: c.uiFail } });
    await page.screenshot({ path: path.join(OUT, `${state}-${m.name}.png`) });
  }
  await d.pin({ motion: 'no-preference', scheme: 'dark', contrast: 'no-preference', forced: false });
}
await d.goto('');
await sweep('auth');
await H.signUp(d, 'Modes Mo');
await sweep('home');
await H.startClassic(page, 'hacker');
const p = await H.currentPuzzle(page);
await H.typeWithKeypad(page, H.wrongGuess(p.answer, 0));
await H.pressCheck(page);
await sweep('play');
await H.quitRound(page);
await H.startBlood(page);
await sweep('play-blood');
await br.close();
await srv.close();
fs.writeFileSync(path.join(OUT, 'modes.json'), JSON.stringify(rows, null, 1));
for (const r of rows) console.log(r.state.padEnd(10), r.mode.padEnd(20), `hscroll=${r.hscroll} clipped=${r.clipped} <24=${r.under24} <44=${r.under44}`, `buttons ${r.probe.withVisibleBorder}/${r.probe.buttons} bordered`, r.probe.frameMissing.length ? 'noFrame:' + r.probe.frameMissing.join(',') : '', r.contrast ? `minText=${r.contrast.min.r} fails=${r.contrast.fails.length} uiFails=${r.contrast.ui.length}` : '', `forced=${r.probe.forced} more=${r.probe.more}`);
