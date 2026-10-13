# Performance budgets and measurements (QUARTZ)

Owner: QUARTZ. Gates for DoD item 6: **LCP < 2.5 s, INP < 200 ms, CLS < 0.1** on a throttled mid-tier
Android over 4G (profile in section 7). Budgets below are pass/fail.

**Budget definition (ADR 0004, supersedes the earlier "wire number prevails" rule).** A budget is the sum of
**compressed response bodies (`gzip -9`) for a cold first visit of a signed-out player**. HTTP headers are
informational only: their size depends on the host (GitHub Pages / Fastly), which the project does not control.
Font, PNG and woff2 bodies are counted as sent (already compressed). A returning, signed-in visitor is served from the
service worker / HTTP cache and is not a cold load. **Record both numbers from now on** (bodies decide; the
on-the-wire figure, `encodedDataLength`, is reported next to it for information). Units: the **first-load JS budget is
45 KiB = 46,080 B**; the other budgets are written in decimal KB (14 KB = 14,000 B, and so on).

Last updated: 2026-10-12 (Jersey 10 is live and the Pixelify files are deleted; HTML, CSS, JS, font and sprites re-measured from the files on disk on that date; section 1.2 is still SENTRY's 2026-10-07 run). The app is feature-complete enough to measure; the
measurements in section 1.2 are **throttled desktop Chromium, not a real mid-tier Android**, and INP has not been
measured on a real device.

## 1. Budgets and current state (cold first visit, signed out, gzip -9 response bodies)

| Part | Budget | Now (2026-10-12) | Status |
|---|---|---|---|
| HTML (`index.html`) | <= 14,000 B | **10,078 B** bodies (46,285 B raw) | PASS |
| CSS (`css/main.css`, one file) | <= **20,000 B** (ADR 0005 section 7; was 18,000 B) | **17,623 B** bodies (70,947 B raw). **Pre-fix, re-measure before release:** PRISM was editing `main.css` while I measured (file stamp 2026-10-08 14:31) | PASS, provisional |
| JS first load, excl. tests | <= **46,080 B (45 KiB)** | **English / default: 45,114 B bodies** = 39,460 static closure of `main.js` (15 files) + 4,838 `i18n/en.js` + 816 `sync/tabs.js` (both loaded by `import()` at boot); equals SENTRY's 45,114 B. **Arabic start: 46,204 B** (`i18n/ar.js` 5,928 B replaces `en.js`; `loadLang(startLang)` in `main.js`, English is loaded only if that fails) | EN PASS by 966 B (2.1%); **AR FAIL by 124 B** |
| Font | <= 20,000 B | `jersey10-latin.woff2` **2,488 B** body (woff2 is not re-gzipped). Pixelify is gone | PASS, final |
| Sprites (`sprites.svg`) | <= 8,000 B | **1,259 B bodies (6,183 B raw), 24 symbols** | PASS, final |
| First-load total (excl. OG/icons) | <= 120,000 B | **English: 76,562 B bodies** = 10,078 + 17,623 + 45,114 + 2,488 + 1,259. Arabic start: 77,652 B (JS +1,090). 2026-10-12, arithmetic over the bodies measured above, not a network trace | PASS |
| Third-party origins at first paint | 0 | 0 (SENTRY, 2026-10-07; not re-run) | PASS (the game API only on user action or session resume, architecture.md) |
| Dependencies (gzipped cost) | 0 KB | 0 KB (ADR 0001) | PASS |

Reported by others and **not reproduced** by this method: CIRCUIT 44,304 B (EN) / 45,394 B (AR). Their EN/AR gap (1,090 B) equals mine, but the base differs by 810 B, so
they likely measured a different file set or an earlier tree; SENTRY's 45,114 B matches mine to the byte. Wire sizes (`encodedDataLength`) were last taken 2026-10-07 and are stale after the CSS/HTML/JS edits.
The Arabic overage is a defect for CIRCUIT/ATLAS to resolve (the JS budget is per cold first visit and does not name a language): trim comments or lazy-load `sync/merge.js` (4,394 B), see 1.1.

The 2026-10-12 figures were computed from the files on disk with gzip level 9 (JS: zlib level 9 over the static
`import`/`export ... from` closure of `js/main.js` plus the two boot-time dynamic imports; HTML and CSS: `gzip -9 -n`, the `-n` matters because the CLI
otherwise stores the file name and adds 10 to 15 bytes); they were not taken from a network trace. The English JS total matches SENTRY's to the byte
(45,114). The wire figures in section 1.2 and 6 come from SENTRY's `tests/e2e/shots/perf.json` (5 cold runs, 2026-10-07); the tree has changed since.
**Re-measure before release.** (Earlier numbers in this file taken with plain `gzip -9 -c` were a few bytes high for that reason.)

Not part of the first-load budget (fetched on demand or by crawlers and installers): `assets/og.png` 3,273 B,
`icon-192.png` 278 B, `icon-512.png` 480 B, `icon-512-maskable.png` 479 B, `apple-touch-icon.png` 269 B,
`favicon.svg` 584 B (the page does fetch `favicon.svg`; it is small and counted by SENTRY under "other").

### 1.1 JS structure and the rule for new modules

Static closure of `js/main.js` (15 files, raw / gzip-9 bodies, measured 2026-10-12; `ui/motion.js` is new since 2026-10-07):

```
 8487  3422 js/main.js          4439  1715 js/router.js         24169  7304 js/sync/sync.js
 2949  1474 js/config.js         550   306 js/store.js          12093  4394 js/sync/merge.js
 5201  2254 js/i18n/index.js    2657  1172 js/ui/motion.js       8555  2905 js/sync/local.js
 8744  2943 js/ui/auth.js       6204  2609 js/ui/dom.js          6513  2968 js/sync/identity.js
11210  4197 js/ui/chrome.js     1993   935 js/ui/params.js       1791   862 js/sync/index.js
sum: 105,555 B raw, 39,460 B gzip-9 bodies (zlib level 9)
```
Loaded at boot by `import()` (not in the static closure, but on the first-load path): `i18n/en.js` 4,838 B (or `i18n/ar.js` 5,928 B for an Arabic start, via `loadLang`) and `sync/tabs.js` 816 B.
Lazy, not part of the cold auth load: screens `ui/home.js` 1,164 B, `ui/play.js` 8,206 B (pulls `game/*` and the engine), `ui/result.js` 1,723 B,
`ui/board.js` 1,769 B, `ui/help.js` 248 B (all via the `import()` map in `main.js`); `ui/sound.js` 990 B (on first sound use); `sync/remote.js` 4,482 B
(`sync/index.js` imports it on demand); `i18n/ar.js` 6,776 B (only for Arabic). A signed-in return pays for `home.js` and `remote.js` on top
(SENTRY: 55,613 B on the wire, 19 files).

**Rule: any new module that lands in the first-load path needs a budget line here before merge.** That means anything statically imported from
`main.js` (or its closure), any `import()` that runs at boot, and anything added to the `modulepreload` list in `index.html`. State its gzip-9 body size
and what it is for; default to a lazy `import()` behind the user action that needs it. The margin is 966 B in English and **negative (124 B over) in Arabic** (see section 1), so any new first-load module breaks the gate.
Next candidates if the margin vanishes (SENTRY's list, confirmed by the sizes above): load `sync/merge.js` (4,394 B) only when a remote save is pulled, and trim
the long comment blocks in shipped modules (about 39% of raw JS bytes are comment lines when I counted on 2026-10-07; no build step, so comments ship).
ATLAS records any budget move in `docs/decisions/`, not before.

### 1.2 SENTRY's throttled measurement (copied from `docs/qa.md` section 5 and `tests/e2e/shots/perf.json`; QUARTZ did not re-run it)

**Throttled desktop Chromium, not a real mid-tier Android.** CDP 1.6 Mbps down / 750 Kbps up / 150 ms RTT, CPU x4, 360x800 @2x mobile
emulation, fresh context and cleared cache per run, motion `no-preference`, scheme `dark`, served by `tests/e2e/support/static-server.mjs`
(gzip level 9) from a staged copy. 5 cold runs. Date: 2026-10-07 (file stamp 2026-10-08T01:04Z).

| Metric | Median | Worst | Gate | |
|---|---|---|---|---|
| LCP (element: the intro `<p>`, static HTML) | 1,308 ms | 1,324 ms | < 2,500 ms | PASS |
| FCP | 688 ms | 820 ms | n/a | |
| CLS, cold | 0 | 0 | < 0.1 | PASS |
| CLS, returning signed-in (shift source `DETAILS`, 3 runs) | 0.0001 | 0.0001 | < 0.1 | PASS |
| TBT proxy | 25 ms | 29 ms | n/a | |
| Load event | 1,211 ms | 1,217 ms | n/a | |
| INP-like (dispatch to second frame, includes about 80 ms of harness frames), worst step | | 154 ms (Play Blood: route + generate + render); Check 133 ms; Hint 113 ms | < 200 ms | PASS as a proxy only |
| Browser event timing, worst `duration` (threshold 16 ms) | | 88 ms | < 200 ms | PASS as a proxy only |

**INP has not been measured on a real device.** The "INP-like" figure is a harness proxy on a desktop CPU with a 4x slowdown, not the field metric; a
real mid-tier Android may be slower than 4x. Treat LCP and CLS the same way: lab figures from desktop Chromium. The manual device script in
`docs/qa.md` section 7 is the open item (needs a human with a phone).

**Font preload.** The `<link rel="preload" as="font" ... crossorigin>` tag is shipped in `index.html`. SENTRY did **not** run a with/without comparison, so the
verdict in 2.3 stays arithmetic, not measured. `docs/qa.md` reports zero "preloaded but not used" warnings in EN and AR.

## 2. Font (Jersey 10, ADR 0005 section 1; supersedes Pixelify Sans)

**Status 2026-10-12: live.** `index.html`, `css/main.css` and `sw.js` no longer reference Pixelify (scanned 2026-10-12); `assets/fonts/pixelify-sans-latin.woff2` and
`assets/fonts/OFL.txt` are deleted (still in git history, commit `f6b73fb`). Remaining mentions of "Pixelify" in the repo are a CI guard (`.github/scripts/verify-site.mjs`), tests asserting it is gone,
and the stale `fonts.pixelify` key name in `tests/e2e/**` (SENTRY).

Jersey 10, SIL OFL 1.1, from the official `google/fonts` repo (`ofl/jersey10/`; METADATA: designer Sarah Cadigan-Fried, upstream
`github.com/scfried/soft-type-jersey`, commit `d8446c4c`). One static weight (400), no italics, 77,732 B TTF (sha256 `db9cbd09...3e82`).
Licence kept verbatim at `assets/fonts/OFL-jersey10.txt` (4,395 B, re-downloaded from the same directory); its first line is
`Copyright 2023 The Soft Type Project Authors (https://github.com/scfried/soft-type-jersey)`. The copyright line carries no Reserved Font
Name declaration (the words appear only in the licence boilerplate), so a subset may keep the family name. The old `assets/fonts/OFL.txt`
(Pixelify) was removed together with the Pixelify file.

Result: `assets/fonts/jersey10-latin.woff2` = **2,488 B** (`gzip -9 -n` 2,511 B; woff2 is not re-gzipped, so the body that counts is 2,488 B).
Budget (ADR 0004 definition, unchanged): **<= 20,000 B woff2; the task target was <= 12 KB**. Margin 17,512 B against the budget, 9,512 B against the
target. Saving versus Pixelify (6,292 B) on the first-load total: 3,804 B (arithmetic). Full first-load total re-measured 2026-10-12 in section 1.

Contents: 115 glyphs, 104 code points = U+0020-007E plus the characters the shipped copy actually uses, computed by script over `index.html`,
`js/i18n/en.js`, `ar.js`, `js/**` and `css/`: U+00A0 (`&nbsp;`, ` `), U+00B7, U+00D7, U+2013 (number placeholder in `js/i18n/index.js`), U+2019,
U+2026, U+2212. U+201C/U+201D are not used today and are kept only as cheap insurance (about 30 B). Dropped from the old list: U+2014 and U+2022
(no longer in the markup or copy). No arrows are used and Jersey 10 has no U+2192; do not add `→` to copy. U+2066/U+2069 (bidi isolates in
`i18n/index.js`/`dom.js`) are default-ignorable and need no glyph. Arabic stays on the system stack.

Layout features: **`tnum` kept, `kern` not present.** Jersey 10's GPOS holds only `mark` (no `kern` lookup), so the old `--layout-features=kern`
would be an empty no-op; GPOS, GDEF, `gasp`, `fpgm`, `prep`, `cvt` and hinting are dropped. `tnum` costs 72 B and gives all ten digits the same advance
(525/1400 = 0.375 em; without it `1` is 300 and 2/3/6/8/9 are 600), so **`font-variant-numeric: tabular-nums` now works** and is the right fix for the Blood timer and
the score count-up (no fixed `ch` min-width hack needed). Name table trimmed to IDs 0-6, 13, 14.

Build command (dev-only; system Python fontTools, nothing installed or added to the project):

```
python3 -m fontTools.subset Jersey10-Regular.ttf \
  --unicodes=U+0020-007E,U+00A0,U+00B7,U+00D7,U+2013,U+2019,U+201C,U+201D,U+2026,U+2212 \
  --layout-features=tnum --no-hinting --flavor=woff2 --notdef-outline \
  --name-IDs=0,1,2,3,4,5,6,13,14 --drop-tables+=DSIG,gasp,prep,fpgm,cvt,GDEF,GPOS \
  --output-file=jersey10-latin.woff2
```

**Render check (headless Chromium, `font-display: block`, 16/20/24/32 px, looked at at 3x; font status `loaded`, no console messages).** Honest result:
- C vs O: **distinguishable** (C is open on the right, O is a closed ring), also in "Create" vs "Oreate" and "Code" vs "Oode".
- G vs B: **distinguishable** (G has the open upper right and the inward bar, B is closed with a centre bar).
- 5 vs S: **distinguishable at 20 px and up; close at 16 px** (both are made of the same horizontal bars; the 5 has a hard square top-left corner).
- 1 vs I: **weak.** `1` has a small flag and is 300 wide; capital `I` (225 wide) and lowercase `l` are plain bars and are effectively the same glyph. Do not rely
  on I/l being told apart (IDs, codes with letters). Dial and keypad digits are never confused with them because digits are the only characters there.
- **0 vs O: nearly identical** (`0` is 525 wide, `O` 600, no slash or dot). Fine for a digits-only context (dials, keypad, timer, score); a mixed code
  that contains both `0` and `O` would be ambiguous. Report to MUSE/CIRCUIT if any visible alphanumeric code is shown (e.g. an "I have a code" field): keep that field's
  text in the system monospace stack, not Jersey.
- 2 vs Z, 8 vs B: distinguishable.

Font facts PRISM and CIRCUIT need:
- Units: upm **1400**. `hhea` = typo: ascent **1125** (0.8036 em), descent **375** (0.2679 em), line gap 0; so `line-height: normal` = **1.0714** (Pixelify: 1.2). `winAscent 1130`,
  `winDescent 375`; USE_TYPO_METRICS is set, so Windows and Mac agree.
- Cap height 750 (**0.5357 em**), x-height 600 (**0.4286 em**) and ascender height = cap height (0.5357); all glyphs sit on the baseline (no descender overshoot).
  Pixelify measured the same way: cap 0.631 em, x-height 0.45 em.
- Compact in both directions. Average advance over the real English copy (index.html text + en.js values, 18,650 characters): Jersey 0.3436 em vs Pixelify 0.4850 em = **0.71x as wide**.
  Cap height is **0.85x** and x-height **0.95x** of Pixelify at the same `font-size`; the line box is **0.89x** (1.0714 vs 1.2).
- Retune guide for PRISM (same visual size as before): multiply font sizes by **1.18 to match cap height, by 1.05 to match x-height**; pick about 1.12 to 1.18 for body and labels,
  and keep >= 16 px (prefer 18 px) for body text and >= 14 px for the smallest label, since the glyphs are small for their em. At the same `font-size`, lines are shorter
  and rows are 11% tighter, so `--lp-lh-body`/`--lp-lh-tight` values chosen for Pixelify's 1.2 box leave less air: check that the 44x44 targets still hold when a control's height comes
  from `line-height` (give them an explicit `min-block-size`).
- **One weight.** The `font-face` declares 400 only; with `font-synthesis: none` a `font-weight: 700` request renders the regular face (no faux bold). Set `--lp-fw-bold` to 400
  (or stop using bold) and build hierarchy from size, colour and spacing; do not leave `700` in the CSS because the *fallback* face would then pick a bold system font and the swap would jump. CSS today uses `--lp-fw-bold` on h1-h3, strong, brand,
  buttons, table headers, timer and dd values (about 20 places).
- Only the Latin subset is shipped. Arabic falls through to the system font by design.

### 2.1 `@font-face` for PRISM (URL is relative to the CSS file in `css/`)

```css
@font-face {
  font-family: "Jersey 10";
  src: url("../assets/fonts/jersey10-latin.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  /* swap: text paints at once in the metric-matched fallback; the font never blocks the LCP text */
  font-display: swap;
  unicode-range: U+0020-007E, U+00A0, U+00B7, U+00D7, U+2013, U+2019, U+201C, U+201D, U+2026, U+2212;
}
```
Keep `font-synthesis: none` on `html`.

### 2.2 Size-adjusted fallback (computed from the real metrics)

`size-adjust` = average advance of Jersey 10 / average advance of Arial (Liberation Sans, metric-compatible, was the measuring face, `hmtx`), over the printable-ASCII
characters of the English copy: 0.3436 / 0.4367 = **78.69%**, written 78.7%. Sensitivity (four corpus choices: HTML text only, en.js values, en.js strings with a space, both): 78.66 to 78.77%,
so the ratio is stable even though ADR 0005 is rewriting the copy; recompute only if the copy changes character mix a lot.
Override formula (percentages apply before `size-adjust`, so divide by it): `ascent-override = 1125 / 1400 / 0.787 = 102.1%`, `descent-override = 375 / 1400 / 0.787 = 34.0%`, `line-gap-override = 0%`.

```css
@font-face {
  font-family: "Jersey Fallback";
  src: local("Arial"), local("Helvetica"), local("Liberation Sans");
  font-weight: 400;
  size-adjust: 78.7%;
  ascent-override: 102.1%;
  descent-override: 34%;
  line-gap-override: 0%;
}
```
Single face, weight 400 only (do not add a bold face: Jersey has none). Delete both `Pixelify Fallback` faces.
Stack (insert one family, as before):
`--lp-font-latin: "Jersey 10", "Jersey Fallback", ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace;`
and in `--lp-font-arabic` insert `"Jersey 10", "Jersey Fallback"` before `system-ui`, as `"Pixelify Sans", "Pixelify Fallback"` is today.

**Not measured:** the wrap-mismatch test of the old fallback (1-6 of 93 strings re-wrapped) was **not re-run** for Jersey, because the copy is being rewritten under
ADR 0005; only the ratios above are computed. Re-run it (and Android Roboto / iOS, which were never measured either) after PRISM's CSS and the new copy land.
Note: at this `size-adjust` the Arial fallback glyphs are drawn at 78.7% of the font size, so the fallback looks slightly smaller than Jersey (fallback x-height
1082/2048 x 0.787 = 0.416 em vs Jersey 0.4286 em, from Liberation Sans' OS/2 `sxHeight`); that is the price of matching widths and line breaks.

### 2.3 Preload

Same reasoning as before, now cheaper (arithmetic, not a measured A/B): 2,488 B at 1.6 Mbps is about 12 ms of transfer; the gain is that the request leaves with the HTML head instead of
after `main.css` is parsed (about one RTT, 150-200 ms). It does not move LCP (`font-display: swap`). `crossorigin` is required. Do not add `fetchpriority`.

```html
<link rel="preload" as="font" type="font/woff2" crossorigin href="./assets/fonts/jersey10-latin.woff2">
```
If a with/without run (section 7) shows no difference in swap time or CLS, delete the tag.

### 2.4 Switch from Pixelify (done 2026-10-12)

The CSS, preload, service-worker precache and CI required-files list now point at `jersey10-latin.woff2`; the Pixelify font and licence files are deleted. The service-worker cache name
carries the build id (`lp1-${VERSION}`), so returning visitors pick up the new font on the next release. Left for SENTRY: rename the `fonts.pixelify` key (see the handoff of 2026-10-12)
in `tests/e2e/support/measure.mjs`, `tests/e2e/matrix/run-matrix.mjs` and the generated `tests/e2e/shots/matrix.json`.

## 3. Sprites, icons, social card

`assets/sprites.svg` is generated mechanically from design.md section 9 maps (the maps are read from the doc,
every row length is asserted, every pixel is asserted covered exactly once by the emitted rectangles). 18 symbols:
`lp-lock-closed lp-lock-open lp-vault-door lp-check lp-x lp-clock lp-bulb lp-skull lp-drop lp-trophy lp-user
lp-speaker-on lp-speaker-off lp-arrow-left lp-sum lp-parity lp-compare lp-even-count`, plus six added 2026-10-08 from `docs/design-v2.md` section 8 (3.1).
`lp-d0..lp-d9` are omitted (MUSE allows it; unused at launch; add back about 1 KB raw if Plan B digits are needed).
- Before the 2026-10-08 addition: 5,073 B raw, 1,118 B gz (now 6,183 B raw, 1,259 B gz, see 3.1). One `<path>` per colour; rows merged into horizontal runs and identical runs stacked into taller rectangles;
  relative `m` after `z`. Well-formed XML (`xmllint --noout`), no `<script>`, no `<style>`.
- Single-colour icons: `fill="currentColor"` on the `<symbol>`. Multi-colour: `fill="var(--lp-spr-k,#0A0C12)"` etc.
  (`K` outline, `B` body, `H` highlight, `S` steel, `L` lamp = `--lp-spr-lamp`). **Deviation from design.md 9.1, intentional:**
  the colour is a `fill` presentation attribute instead of `style="fill:var(...)"`, so it is not subject to a future
  `style-src` CSP and is a few bytes smaller; it renders identically (checked in Chromium with all four schemes through
  an external `<use href="sprites.svg#...">`). The fallback after the comma is the Classic-dark token value (design.md 2.1),
  not `#000`, so a sprite is readable even if the tokens are missing. That duplicates four hex values; if a token changes,
  update `gen`/sheet or accept the stale fallback (tokens always win when defined).
- Contact sheet over 4 schemes (Classic/Blood x dark/light) was rendered and looked at: every sprite matches its map.
- The root `<svg>` carries `width="0" height="0"`; consumers size their own `<svg width height>`. Mind design.md 9.6: lock sprites
  are 16 grid units, draw at 64 px; the current `index.html` header uses `width="32" height="32"` on `lp-lock-closed`
  (2 px per art pixel). If PRISM's CSS does not override that, the lock is half-size and breaks the pixel grid rule.
- External `<use>` is one extra same-origin request (about 1.1 KB gz, cached, off the LCP path). Inlining the sheet into the HTML
  would save the request but resend 5 KB raw in every HTML response; not worth it while the service worker caches the file.

### 3.1 Sprites added for design-v2 (2026-10-08)

Six single-colour 8x8 symbols (`viewBox="0 0 8 8" fill="currentColor"`, same format as `lp-check`) appended after `lp-even-count`, built mechanically from the maps in
`docs/design-v2.md` section 8 (every row 8 characters; path -> pixel grid round trip compared with the map for all six, no overlap). Ids: `lp-help`, `lp-backspace`, `lp-skip`,
`lp-alert`, `lp-none`, `lp-key`. All 18 earlier ids are unchanged and the earlier bytes of the file are identical. Cost: +1,110 B raw, +141 B gz
(`gzip -9 -n` 1,118 -> 1,259). `xmllint --noout` clean, no `<script>`, no `<style>`, 24 unique ids. The generator also reproduces all 15 existing single-colour symbols byte for byte, so the path style is the same.
Contact sheet (Chromium, 128 px, 32 px and 16 px, light and dark) was looked at: help reads as `?`, backspace as a left-pointing tag with an x cut-out (the x is centred on art row 3 of 8, so it sits half a
pixel above the tag's centre; that is how the map in design-v2 is drawn and it reads fine), skip as a right-pointing triangle plus bar, alert as `!`, none as a slashed circle, key as a ring-and-stem key. No pixel mistakes
found. Usage: 16 px = 2 px per art pixel, 32 px = 4 px per art pixel; `skip` is directional, so mirror it with CSS in RTL (`.lp-icon--flip`, design-v2). The sheet has no `lp-d0..lp-d9`, so there is nothing to prune.

Icons (all opaque, 4-colour palette PNG from the lock map by exact nearest-neighbour drawing, no resampling blur):

| File | Size px | Bytes | Notes |
|---|---|---|---|
| `assets/icons/favicon.svg` | 16 grid | 584 (329 gz) | fixed colours on a `#12151C` tile: legible on light and dark tab bars |
| `assets/icons/icon-192.png` | 192 | 278 | lock at 9x (144 px), 24 px margin |
| `assets/icons/icon-512.png` | 512 | 480 | lock at 24x (384 px) |
| `assets/icons/icon-512-maskable.png` | 512 | 479 | lock at 20x (320 px): content half-diagonal 198 px < 204.8 px (80% safe circle); verified visually with the circle overlaid |
| `assets/icons/apple-touch-icon.png` | 180 | 269 | lock at 9x, opaque (iOS paints transparency black) |
| `assets/og.png` | 1200x630 | 3,273 | vault door + "Lock Puzzle" + "Made by OPH"; text only, no stats; 16-colour palette |

For BEACON (head) and the manifest owner:
```html
<link rel="icon" href="./assets/icons/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="./assets/icons/apple-touch-icon.png">
```
`manifest.webmanifest` icons: `icon-192.png` (192x192, `purpose: any`), `icon-512.png` (512x512, `any`),
`icon-512-maskable.png` (512x512, `maskable`). `og:image` must be an absolute URL on the final Pages origin
(`TODO(content):` the repo/Pages URL is not known to QUARTZ) with `og:image:width=1200`, `og:image:height=630` and `og:image:alt`.
Safari ignores SVG favicons and will probe `/favicon.ico`; a 404 there is a console error, so BEACON should also
decide whether to ship a tiny `.ico` or accept it for Safari only.

## 4. LCP element and CLS plan

**LCP element (measured by SENTRY, `perf.json`): the intro `<p>` of the Auth screen, static HTML** (5 of 5 cold runs, plus the 3 returning-user runs).
My first guess, the `<h1 id="auth-title">`, came from an unstyled smoke test and was wrong for the styled page. The text is in the HTML, but
**LCP is now gated on JS**: `index.html` ships `<html data-boot="pending">` and `css/main.css` (about line 1146) keeps every `[data-screen]` at
`visibility: hidden` until `boot()` in `js/main.js` deletes the flag, with a 3 s CSS fail-safe. That removes the Auth flash for signed-in players (good),
but it means LCP is at best "time until the boot modules have loaded and run" (median 1,308 ms here) and, if JS fails or stalls, **the fail-safe reveals at
3 s, which is over the 2.5 s gate.** I read this from the code; I have not measured LCP with the guard removed. Rules that protect LCP:
- Keep the boot path short: everything `boot()` awaits is first-load JS (section 1.1); the six `modulepreload` links in `index.html` exist for this.
- No `opacity: 0` / reveal animation on Auth's h1 or first paragraph; no `content-visibility: hidden` above the fold.
- One render-blocking resource only, the CSS (a single `main.css`; its only `@import` mention is in a comment, so there is no serial CSS chain). The module script is deferred by nature.
- ES-module waterfall: every `import` depth level costs about one RTT before boot finishes. Keep `modulepreload` aligned with the real boot graph (SENTRY saw no unused-preload warnings).
- If the 3 s fail-safe ever shows in a trace, treat it as an LCP failure, not a corner case; shorten it only with CIRCUIT and ATLAS agreement.

**CLS plan (target < 0.1; aim for 0):**
1. Font swap: `font-display: swap` plus the size-adjusted `Jersey Fallback` face (2.2). The old Pixelify fallback measured 1-6 of 93 strings re-wrapping
   (vs 22-31 with the bare monospace stack); the Jersey fallback ratios are computed but its wrap test is **not yet run** (2.2).
2. Sprite hosts: every `<svg>` has `width` and `height` attributes in the markup (GRANITE does this) and PRISM sets
   `inline-size/block-size: calc(var(--lp-px) * W)` plus `aspect-ratio: 1`, so a late-arriving `sprites.svg` paints into reserved space.
3. Reserved dock height: the play dock/keypad uses CSS-derived `--lp-dock-h: calc(var(--lp-px) * 100)` (design.md 10.2); `main` gets
   `padding-block-end: var(--lp-dock-h)`; no `ResizeObserver`-driven height unless CSS cannot derive it.
4. Screen swaps: exactly one `[data-screen]` is visible; the swapped-in screen must not push the persistent header/footer: `main` keeps
   `min-block-size` of the viewport minus header and footer (`100dvh`), so footer position is stable.
5. Dynamic lists (clues, history, board rows): render in a container whose `min-block-size` is reserved, or append below the fold;
   status/toast live regions are `position: fixed` (no flow impact). Empty `[data-error]`/`[data-out="msg"]` collapse with `:empty`, so
   filling them shifts content below; put them below the control that triggers them, or reserve one line, because only shifts within
   500 ms of a discrete input are excluded from CLS and async results (network sign-in) arrive later than that.
6. No images other than sprites; the OG/icons are not in the page. No ads/embeds/iframes.

## 5. Dependencies and third parties

| Item | Gzipped cost | Justification |
|---|---|---|
| Jersey 10 subset (self-hosted) | 2,488 B | ADR 0005's single family; no third-party request, no SRI needed |
| `sprites.svg` | 1,259 B | first-party, generated |
| Everything else | 0 | no framework, no bundler, no CDN (ADR 0001) |

Cross-origin at runtime: only the game API (`*.workers.dev`) via `fetch`, after user action or on session resume (not part of first paint).
Tooling used by QUARTZ, **all dev-only, none shipped or added to the project**: Python 3 with fontTools 4.62.1 + brotli (font subset and metrics),
Pillow 12.3 (PNG palette quantize), `xmllint`, system Chromium (contact sheets, OG render, font fallback test), `playwright-cli` with
`--config` pointing at `/usr/bin/chromium` (harness smoke test). `pngquant` and `optipng` are not installed; PIL palette quantization was used instead.
Generator and test scripts live in the session scratchpad, not the repo.

## 6. Re-measure now (no scripts needed; zsh or bash, from the project root)

```sh
gzs() { for f in "$@"; do gzip -9 -n -c "$f" | wc -c; done | paste -sd+ | bc; }   # sum of per-file gzip sizes
echo "HTML  $(gzs index.html)   (budget 14000)"
echo "CSS   $(gzs css/*.css)    (budget 20000, ADR 0005 section 7)"
echo "FONT  $(wc -c < assets/fonts/jersey10-latin.woff2)   (budget 20000; woff2 is not re-gzipped)"
echo "SPR   $(gzs assets/sprites.svg)    (budget 8000)"
```
First-load JS is not `find js`: that over-counts the lazy screens, `ar.js`, `remote.js` and `sound.js`. Sum the static import closure of `js/main.js` plus the
boot-time dynamic imports (`i18n/en.js`, `sync/tabs.js`; re-check the `import()` calls at boot in `main.js` if they change). Budget **46,080 B (45 KiB)**:

```sh
node - <<'EOF'
const fs=require('fs'),path=require('path'),z=require('zlib');
const seen=new Map();
const walk=f=>{ if(seen.has(f))return; const s=fs.readFileSync(f,'utf8'); seen.set(f,s);
  for(const m of s.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'";]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g))
    walk(path.normalize(path.join(path.dirname(f),m[1]||m[2]))); };
walk('js/main.js'); const closure=[...seen].reduce((n,[,s])=>n+z.gzipSync(s,{level:9}).length,0);
const extra=['js/i18n/en.js','js/sync/tabs.js'].reduce((n,f)=>n+z.gzipSync(fs.readFileSync(f),{level:9}).length,0);
console.log('static closure',seen.size,'files',closure,'+ boot imports',extra,'=',closure+extra,'(budget 46080)');
EOF
```
(On 2026-10-12 this printed `static closure 15 files 39460 + boot imports 5654 = 45114`. It measures the English start; for Arabic swap `js/i18n/en.js` for `js/i18n/ar.js`: 46,204.)

Snapshot taken 2026-10-12 (bodies, gzip -9, English start): HTML 10,078 | CSS 17,623 (pre-fix) | JS first load 45,114 (39,460 closure + 4,838 + 816) | FONT 2,488 | SPR 1,259 | total 76,562. On the wire: not re-taken since SENTRY's 2026-10-07 run (HTML 9,770 | CSS 14,714 | JS 49,625 | FONT 6,559 (Pixelify) | SPR 1,412 | total 83,300), now stale.

## 7. Measuring on a throttled mid-tier Android over 4G

Profile: network 1.6 Mbps down, 750 Kbps up, 150 ms RTT (Chrome's "Slow 4G"-class profile, the figures the brief fixes);
CPU 4x slowdown (a mid-tier Android is roughly 4-6x slower than a desktop core; use 6 if the 4x result is within 20% of a gate);
viewport 360x800 DPR 2 mobile emulation; motion and colour scheme pinned explicitly (CLAUDE.md: headless defaults to `reduce`).
Serve the repo statically (`python3 -m http.server 8743` from the project root; no build step), then:

```sh
playwright-cli -s=perf open about:blank --config=pwcfg.json      # pwcfg.json: {"browser":{"launchOptions":{"executablePath":"/usr/bin/chromium","args":["--no-sandbox"]}}}
playwright-cli -s=perf run-code --filename=cdp-measure.js         # prints {"lcp":{"t":ms,"el":"..."},"cls":n,"transferBytes":n}
playwright-cli -s=perf close
```
`cdp-measure.js` (the `run-code` sandbox has no `process`, so edit the URL inline; run it 5 times and report the median and worst):

```js
async page => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150,
    downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-reduced-motion', value: 'no-preference' }, { name: 'prefers-color-scheme', value: 'dark' }] });
  await cdp.send('Network.clearBrowserCache');
  await page.addInitScript(() => {
    window.__m = { lcp: null, cls: 0 };
    new PerformanceObserver(l => { const e = l.getEntries().at(-1);
      window.__m.lcp = { t: Math.round(e.startTime), el: e.element && (e.element.tagName + (e.element.id ? '#' + e.element.id : '')) };
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
  });
  let bytes = 0;
  cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; });
  await page.goto('http://127.0.0.1:8743/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => window.__m);
  return JSON.stringify({ ...m, cls: +m.cls.toFixed(4), transferBytes: bytes });
}
```
Repeat with `prefers-reduced-motion: reduce`, with `prefers-color-scheme: light`, and (for INP) drive the real interactions through
`playwright-cli` (type in the name field, press Check on Play, open the language toggle) with the same throttle and read `event`
timing entries (`PerformanceObserver({type:'event', durationThreshold:16})`; INP is the worst, p98 of interactions). Lab LCP/CLS/INP from
Chromium are proxies for field data; report them as such. `playwright-cli tracing-start/stop` gives a trace for long-task attribution.
Also `playwright-cli console` must be empty and `playwright-cli requests` must list only same-origin URLs on first paint.

**Status (2026-10-07):** QUARTZ ran this harness only as a smoke test, on an unstyled page with CSS and JS returning 404, and recorded no timing from it. The real
numbers are SENTRY's run (section 1.2), made with its own staged-server harness using the same throttle profile. QUARTZ has not yet re-run this procedure on the finished app.

### If a limit fails
1. LCP > 2.5 s: look at the waterfall before touching anything. Check whether the boot guard (`data-boot="pending"`, 3 s fail-safe) is what is
   holding LCP, inline nothing large, make sure the first paragraph is not on a fade, preload the font, check the CSS is under budget and not blocked behind the sprite or module requests.
2. INP > 200 ms: find the long task (trace). Break up handlers, move the solver/generator to idle or lazy `import()`, keep dial/keypad handlers
   O(1), avoid layout reads in the click path, no `transition: all`.
3. CLS > 0.1: use the `layout-shift` entries' `sources` to find the node; usual suspects are the font swap (retune section 2.2), an unsized
   sprite, a list inserted above content, the Auth to Home swap for signed-in users.
4. Bytes over budget: apply 1.1 (lazy-load, trim comments) before any ADR to raise a budget. Only ATLAS can move a budget, in `docs/decisions/`.
5. Re-measure, record the date and the numbers here, and keep the failing run in the table until a passing one replaces it.
