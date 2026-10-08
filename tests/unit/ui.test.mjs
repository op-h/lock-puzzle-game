// Static guarantees about the UI layer that do not need a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { BLOOD, DIFFICULTIES, DIFFICULTY_ORDER, SCORING } from '../../js/config.js';
import { catalogs, loadLang } from '../../js/i18n/index.js';
import { copyParams } from '../../js/ui/params.js';
import { statusAnnouncement, pxHeight } from '../../js/ui/chrome.js';
import { isDisabled, setDisabled } from '../../js/ui/dom.js';

await Promise.all([loadLang('en'), loadLang('ar')]);
const ROOT = new URL('../../', import.meta.url).pathname;
const html = readFileSync(join(ROOT, 'index.html'), 'utf8').replace(/<noscript>[\s\S]*?<\/noscript>/, '');

function jsFiles(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (n.endsWith('.js')) out.push(p);
  }
  return out;
}
const placeholders = (v) => {
  const s = typeof v === 'string' ? v : Object.values(v).join(' ');
  return [...new Set([...s.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]))];
};

test('every data-i18n / data-i18n-attr key in index.html exists in both catalogs', () => {
  const keys = new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) keys.add(pair.split(':')[1].trim());
  assert.ok(keys.size > 100);
  for (const k of keys) {
    assert.ok(k in catalogs.en, `en missing ${k}`);
    assert.ok(k in catalogs.ar, `ar missing ${k}`);
  }
});

test('placeholders in markup-bound strings are all supplied by copyParams (so none leaks as "{name}")', () => {
  const keys = new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
  for (const lang of ['en', 'ar']) {
    const params = copyParams(lang);
    for (const k of keys) for (const p of placeholders(catalogs[lang][k])) assert.ok(p in params, `${lang} ${k} uses {${p}}`);
  }
});

test('copyParams derive from config (copy cannot go stale)', () => {
  const p = copyParams('en');
  assert.equal(p.duration, '3:00');
  assert.equal(p.wrongPen, String(BLOOD.wrongPenaltyMs / 1000));
  assert.equal(p.skipPen, String(BLOOD.skipPenaltyMs / 1000));
  assert.equal(p.mult, String(BLOOD.mult));
  assert.equal(p.accStep, '8');
  assert.equal(p.accFloor, '40');
  assert.equal(p.hintPct, '50');
  assert.equal(p.exPts, '115');
  assert.equal(p.lengths, '3, 4, or 5');
  assert.equal(p.repeatName, 'Agent');
  assert.equal(copyParams('ar').repeatName, 'عميل');
});

test('static copy that still hard-codes a rule is pinned to config', () => {
  // These strings are not interpolated, so a rebalance must also edit the text: fail loudly instead.
  assert.equal(SCORING.hintFactor, 0.5, 'play.hint says "Half Points"');
  assert.deepEqual(DIFFICULTIES.rookie.kinds, ['feedback'], 'help.clues.byDifficulty');
  assert.ok(['parity', 'sum'].every((k) => DIFFICULTIES.agent.kinds.includes(k)) && !DIFFICULTIES.agent.kinds.includes('compare'));
  for (const d of ['hacker', 'master']) assert.equal(DIFFICULTIES[d].kinds.length, 5);
  assert.deepEqual(DIFFICULTY_ORDER, ['rookie', 'agent', 'hacker', 'master']);
});

test('every literal t()/tFor() key used by the UI exists, and dynamic key families are complete', () => {
  const used = new Set();
  for (const f of jsFiles(join(ROOT, 'js/ui')).concat(join(ROOT, 'js/main.js'))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/\btFor\(\s*\w+,\s*'([A-Za-z0-9_.]+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/'((?:auth|play|result|board|dialog|home)\.[A-Za-z0-9_.]+)'/g)) used.add(m[1]);
  }
  for (const k of used) {
    if (k.endsWith('.')) continue; // prefix of a dynamic key; the families below cover those
    assert.ok(k in catalogs.en, `en missing ${k}`);
    assert.ok(k in catalogs.ar, `ar missing ${k}`);
  }
  const families = {
    'diff.': DIFFICULTY_ORDER,
    'mode.': ['classic', 'blood'],
    'status.': ['synced', 'saving', 'offline', 'local'],
    'title.': ['auth', 'home', 'play', 'result', 'board', 'help'],
    'play.dial.': ['wrong', 'correct'],
    'auth.err.name.': ['empty', 'too_long', 'control_chars', 'invisible'],
    'status.issue.': ['newer', 'storage'],
    'status.say.': ['offline', 'synced'],
  };
  for (const [prefix, names] of Object.entries(families)) for (const n of names) assert.ok(prefix + n in catalogs.en && prefix + n in catalogs.ar, prefix + n);
});

test('UI copy has no em dashes (MUSE copy rule) and Arabic keeps Latin digits', () => {
  for (const lang of ['en', 'ar']) {
    for (const [k, v] of Object.entries(catalogs[lang])) {
      const s = typeof v === 'string' ? v : Object.values(v).join(' ');
      assert.ok(!s.includes('\u2014'), `${lang} ${k} has an em dash`);
      assert.ok(!/[\u0660-\u0669\u06f0-\u06f9]/.test(s), `${lang} ${k} has non-Latin digits`);
    }
  }
});

test('source hygiene: no innerHTML/Math.random/console/eval in js/, relative .js imports only', () => {
  for (const f of jsFiles(join(ROOT, 'js'))) {
    const s = readFileSync(f, 'utf8');
    const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code), `${f}: HTML injection API`);
    assert.ok(!/Math\.random/.test(code), `${f}: Math.random`);
    assert.ok(!/\bconsole\./.test(code), `${f}: console`);
    assert.ok(!/\beval\(|new Function/.test(code), `${f}: eval`);
    for (const m of code.matchAll(/(?:from|import\()\s*'([^']+)'/g)) {
      assert.match(m[1], /^\.{1,2}\/.*\.js$/, `${f}: import path ${m[1]}`);
    }
  }
});

test('the answer never reaches a data attribute or aria text before solving (UI code never reads it)', () => {
  const play = readFileSync(join(ROOT, 'js/ui/play.js'), 'utf8');
  assert.ok(!/\.answer\b/.test(play), 'play.js must not touch an answer field');
  assert.ok(play.includes('answerIfSolved'), 'the only way to the code is after the solve');
  assert.ok(!/answerIfSolved/.test(play.replace(/code: round\.s\.answerIfSolved\(\)/, '')), 'used once, inside completeClassic');
});

test('CSP: nothing in js/ writes a style ATTRIBUTE (setAttribute style, cssText, markup style=); CSSOM property writes are fine', () => {
  for (const f of jsFiles(join(ROOT, 'js'))) {
    const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/setAttribute\(\s*['"]style['"]/.test(code), `${f}: setAttribute('style')`);
    assert.ok(!/cssText/.test(code), `${f}: cssText`);
    assert.ok(!/\bstyle\s*=\s*["']/.test(code), `${f}: style= markup`);
    assert.ok(!/\bel\([^)]*\bstyle\s*:/.test(code), `${f}: el(..., {style})`);
  }
});

test('dead keys result.next / result.retry are gone and nothing references them', () => {
  for (const lang of ['en', 'ar']) {
    assert.ok(!('result.next' in catalogs[lang]) && !('result.retry' in catalogs[lang]));
  }
  assert.ok(!/result\.(next|retry)['"]/.test(html));
  for (const f of jsFiles(join(ROOT, 'js'))) assert.ok(!/['"]result\.(next|retry)['"]/.test(readFileSync(f, 'utf8')), f);
});

test('units stay glued to their numbers: a no-break space, never a plain space, before s / seconds / percent / points', () => {
  const en = /(?:[}\d]) (?:s|seconds|percent|percentage|points)(?=[\s.,;:)]|$)/;
  const ar = /(?:[}\d]) (?:ثوانٍ|ث|نقطة|بالمئة|نقاط)(?=[\s.,;:)\u060c]|$)/;
  for (const [k, v] of Object.entries(catalogs.en)) assert.ok(!en.test(typeof v === 'string' ? v : Object.values(v).join(' ')), `en ${k}`);
  for (const [k, v] of Object.entries(catalogs.ar)) assert.ok(!ar.test(typeof v === 'string' ? v : Object.values(v).join(' ')), `ar ${k}`);
  assert.ok(catalogs.en['play.msg.wrongBlood'].includes('\u00a0s'));
});

test('status announcements: only offline and recovery-to-synced are spoken, never saving or routine synced flips', () => {
  assert.equal(statusAnnouncement('synced', 'offline'), 'status.say.offline');
  assert.equal(statusAnnouncement(null, 'offline'), 'status.say.offline');
  assert.equal(statusAnnouncement('offline', 'offline'), null, 'no repeat');
  assert.equal(statusAnnouncement('offline', 'synced'), 'status.say.synced');
  assert.equal(statusAnnouncement('local', 'synced'), 'status.say.synced');
  assert.equal(statusAnnouncement('synced', 'synced'), null);
  assert.equal(statusAnnouncement(null, 'synced'), null, 'first status of the page is not news');
  assert.equal(statusAnnouncement('synced', 'saving'), null);
  assert.equal(statusAnnouncement('offline', 'saving'), null);
  assert.equal(statusAnnouncement('synced', 'local'), null);
});

test('aria-disabled helpers: set/clear/read, and a native disabled counts too', () => {
  const attrs = new Map();
  const b = { disabled: false, getAttribute: (k) => attrs.get(k) ?? null, setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) };
  assert.equal(isDisabled(b), false);
  setDisabled(b, true);
  assert.equal(b.getAttribute('aria-disabled'), 'true');
  assert.equal(isDisabled(b), true);
  setDisabled(b, false);
  assert.equal(isDisabled(b), false);
  assert.equal(b.getAttribute('aria-disabled'), null);
  b.disabled = true;
  assert.equal(isDisabled(b), true);
});

test('play.js: Check and Hint use aria-disabled (never the disabled attribute), and rebuilds restore focus', () => {
  const play = readFileSync(join(ROOT, 'js/ui/play.js'), 'utf8');
  assert.ok(!/(?:checkBtn|hintBtn)\.disabled/.test(play));
  assert.ok(/setDisabled\(checkBtn/.test(play) && /setDisabled\(hintBtn/.test(play));
  assert.ok(/isDisabled\(hintBtn\)/.test(play), 'hint handler no-ops when aria-disabled');
  assert.ok(/buildPuzzle\(true\)/.test(play) && /dialEls\[sel\]\.focus\(\)/.test(play));
});

test('auth.js: progress text never goes into the role=alert region; code output is not a live region', () => {
  const auth = readFileSync(join(ROOT, 'js/ui/auth.js'), 'utf8');
  const setBusy = auth.slice(auth.indexOf('function setBusy'), auth.indexOf('const nameMsg'));
  assert.ok(!/errOf|data-error|textContent = on \? t\(key\)\s*:\s*''/.test(setBusy.replace(/label\.textContent/g, '')), 'setBusy does not touch the error region');
  assert.ok(/aria-busy/.test(setBusy));
  assert.ok(/codeOut\.setAttribute\('aria-live', 'off'\)/.test(auth));
  const finish = auth.slice(auth.indexOf('function finishSignup'), auth.indexOf('dlg.addEventListener(\'cancel\''));
  assert.ok(finish.indexOf('closeDialog(dlg)') < finish.indexOf("codeOut.textContent = '------'"), 'wiped after the dialog closed');
});

test('minors: Blood end closes the quit dialog; the in-play Blood toast carries the Blood label; no pause/resume remains', () => {
  const play = readFileSync(join(ROOT, 'js/ui/play.js'), 'utf8');
  const completeBlood = play.slice(play.indexOf('function completeBlood'), play.indexOf('function quitRound'));
  assert.ok(/closeDialog\(quitDlg\)/.test(completeBlood), 'a run that ends under an open Quit prompt closes it');
  assert.match(play, /play\.msg\.solvedBlood/);
  assert.ok(catalogs.en['play.msg.solvedBlood'].includes('Blood points (from Blood mode)'));
  assert.ok(!/\.pause\(\)|\.resume\(\)/.test(play), 'the classic clock is never paused');
  assert.match(play, /clock\.beat\(\)/, 'timer-gap detection re-checks deadlines');
});

test('pxHeight: whole pixels rounded UP, clamped, and null for anything that is not a measurement', () => {
  assert.equal(pxHeight(382), 382);
  assert.equal(pxHeight(381.01), 382, 'a fractional height is rounded up so sticky UI never covers a sliver of content');
  assert.equal(pxHeight(0), 0);
  assert.equal(pxHeight(0.2), 1);
  assert.equal(pxHeight(1e9), 4000, 'clamped');
  for (const bad of [-1, NaN, Infinity, -Infinity, undefined, null, '40', {}, []]) assert.equal(pxHeight(bad), null, String(bad));
});

test('dock/header measurement: CSSOM writes only, feature-detected observer + resize fallback, dock var reset off the play screen', () => {
  const chrome = readFileSync(join(ROOT, 'js/ui/chrome.js'), 'utf8');
  assert.match(chrome, /typeof app\.win\.ResizeObserver === 'function'/);
  assert.match(chrome, /addEventListener\('resize', measure\)/);
  assert.match(chrome, /orientationchange/);
  assert.match(chrome, /fonts\.ready/);
  assert.match(chrome, /style\.setProperty\('--lp-header-h'/);
  assert.match(chrome, /style\.setProperty\('--lp-dock-h'/);
  assert.match(chrome, /style\.removeProperty\('--lp-dock-h'\)/, 'falls back to the CSS default when no dock is shown');
  assert.match(chrome, /requestAnimationFrame\(measureNow\)/, 'batched in one frame');
  assert.ok(!/setAttribute\(\s*['"]style['"]/.test(chrome) && !/cssText/.test(chrome));
  const main = readFileSync(join(ROOT, 'js/main.js'), 'utf8');
  assert.match(main, /chrome\.measure\(\)/, 're-measured on every screen change');
});

test('F-04 wiring: pagehide releases through the ownership module, pageshow re-acquires only from the bfcache', () => {
  const play = readFileSync(join(ROOT, 'js/ui/play.js'), 'utf8');
  assert.match(play, /const onPageHide = \(\) => persist\(true\)/);
  assert.match(play, /if \(e && e\.persisted\) own\.reacquire\(\)/);
  assert.match(play, /addEventListener\('pageshow', onPageShow\)/);
  assert.match(play, /own\.release\(snap\) : own\.beat\(snap\)/);
});
