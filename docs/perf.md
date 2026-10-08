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

Last updated: 2026-10-07 (after SENTRY's gate run and ADR 0004). The app is feature-complete enough to measure; the
measurements in section 1.2 are **throttled desktop Chromium, not a real mid-tier Android**, and INP has not been
measured on a real device.

## 1. Budgets and current state (cold first visit, signed out, gzip -9 response bodies)

| Part | Budget | Now (2026-10-07) | Status |
|---|---|---|---|
| HTML (`index.html`) | <= 14,000 B | 9,431 B bodies (40,266 B raw), my re-measure of today's tree; SENTRY's run: 9,465 B bodies, 9,770 B on the wire | PASS |
| CSS (`css/main.css`, one file) | <= 18,000 B | 14,818 B bodies (my re-measure; `main.css` was edited after SENTRY's run); SENTRY: 14,409 B bodies, 14,714 B on the wire | PASS |
| JS first load, excl. tests | <= **46,080 B (45 KiB)** | **44,342 B bodies** = 38,044 static closure of `main.js` (15 files) + 5,482 `i18n/en.js` + 816 `sync/tabs.js` (both loaded by `import()` at boot); identical to SENTRY's 44,342 B bodies over 17 files; **49,625 B on the wire** (SENTRY) | PASS by 1,738 B (3.8%), thin |
| Font (`pixelify-sans-latin.woff2`) | <= 20,000 B | 6,292 B body; 6,559 B on the wire (SENTRY) | PASS, final |
| Sprites (`sprites.svg`) | <= 8,000 B | 1,118 B bodies (5,073 B raw); 1,412 B on the wire (SENTRY) | PASS, final |
| First-load total (excl. OG/icons) | <= 120,000 B | 9,431 + 14,818 + 44,342 + 6,292 + 1,118 = 76,001 B bodies; SENTRY: 83,300 B on the wire, 23 requests | PASS |
| Third-party origins at first paint | 0 | 0 (SENTRY) | PASS (Firestore only on user action or session resume, architecture.md) |
| Dependencies (gzipped cost) | 0 KB | 0 KB (ADR 0001) | PASS |

The "bodies" figures marked "my re-measure" were computed today from the files on disk with gzip level 9 (JS: zlib level 9 over the static
`import`/`export ... from` closure of `js/main.js` plus the two boot-time dynamic imports; HTML and CSS: `gzip -9 -n`, the `-n` matters because the CLI
otherwise stores the file name and adds 10 to 15 bytes); they were not taken from a network trace. The JS body total matches SENTRY's to the byte
(44,342). SENTRY's other figures come from `tests/e2e/shots/perf.json` (5 cold runs); `index.html` and `css/main.css` have been edited since that run,
hence the small differences. **Re-measure before release.** (Earlier numbers in this file taken with plain `gzip -9 -c` were a few bytes high for that reason.)

Not part of the first-load budget (fetched on demand or by crawlers and installers): `assets/og.png` 3,273 B,
`icon-192.png` 278 B, `icon-512.png` 480 B, `icon-512-maskable.png` 479 B, `apple-touch-icon.png` 269 B,
`favicon.svg` 584 B (the page does fetch `favicon.svg`; it is small and counted by SENTRY under "other").

### 1.1 JS structure and the rule for new modules

Static closure of `js/main.js` (15 files, raw / gzip-9 bodies, measured today):

```
 2949  1474 js/config.js          8292  3342 js/main.js           24169  7304 js/sync/sync.js
 2523  1262 js/engine/scoring.js  3483  1379 js/router.js         12093  4394 js/sync/merge.js
 7686  3105 js/i18n/index.js       550   306 js/store.js           8232  2819 js/sync/local.js
 8744  2943 js/ui/auth.js         6736  2541 js/ui/chrome.js       6495  2968 js/sync/identity.js
 5911  2514 js/ui/dom.js          1752   831 js/ui/params.js       1791   862 js/sync/index.js
sum: 101,406 B raw, 38,044 B gzip-9 bodies (zlib level 9)
```
Loaded at boot by `import()` (not in the static closure, but on the first-load path): `i18n/en.js` 5,482 B and `sync/tabs.js` 816 B.
Lazy, not part of the cold auth load: screens `ui/home.js` 1,164 B, `ui/play.js` 8,206 B (pulls `game/*` and the engine), `ui/result.js` 1,723 B,
`ui/board.js` 1,769 B, `ui/help.js` 248 B (all via the `import()` map in `main.js`); `ui/sound.js` 990 B (on first sound use); `sync/remote.js` 4,482 B
(`sync/index.js` imports it on demand); `i18n/ar.js` 6,776 B (only for Arabic). A signed-in return pays for `home.js` and `remote.js` on top
(SENTRY: 55,613 B on the wire, 19 files).

**Rule: any new module that lands in the first-load path needs a budget line here before merge.** That means anything statically imported from
`main.js` (or its closure), any `import()` that runs at boot, and anything added to the `modulepreload` list in `index.html`. State its gzip-9 body size
and what it is for; default to a lazy `import()` behind the user action that needs it. The margin is 1,738 B, so one more mid-size module breaks the gate.
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

## 2. Font

Pixelify Sans, SIL OFL 1.1, from the official `google/fonts` repo (`ofl/pixelifysans/`), whose METADATA
points at upstream `github.com/eifetx/Pixelify-Sans`. Variable `wght` 400..700 source, 79,160 B TTF
(sha256 `9ba86cd0...e8a5`). Licence kept verbatim at `assets/fonts/OFL.txt`; its first line is
`Copyright 2021 The Pixelify Sans Project Authors (https://github.com/eifetx/Pixelify-Sans)`. The licence
has no Reserved Font Name clause on this font, so a subset may keep the family name.

Result: `assets/fonts/pixelify-sans-latin.woff2` = **6,292 B** (gz 6,341 B), one variable file, wght 400..700 kept.
Alternatives measured the same way: two static instances (400 + 700) = 4,068 + 4,180 = 8,248 B and two requests, so
the single variable file won on both bytes and requests. Under MUSE's 16 KB preferred / 20 KB ceiling by about 10 KB.

Contents: 108 glyphs, 106 code points: U+0020-007E, U+00A0, U+00B7, U+00D7, U+2013, U+2014, U+2019,
U+201C, U+201D, U+2022, U+2026, U+2212 (MUSE's list plus the typographic quotes, en dash, minus and em dash
that the copy or placeholders use; U+2014 is only there because `index.html` has `—` as the empty-state placeholder
in several `data-out` sinks; remove it from the range if GRANITE drops those, saves a few bytes). Layout feature
`kern` only; hinting, `STAT`, `MVAR`, `gasp`, `prep` dropped; `HVAR` kept so variable advance widths are right.
Name table trimmed to IDs 0-6, 13, 14 (copyright, family, version, licence text and URL stay).

Build command (dev-only; fontTools 4.62.1 and brotli were already in the system Python, nothing was installed
and nothing was added to the project):

```
python3 -m fontTools.subset PixelifySans[wght].ttf \
  --unicodes=U+0020-007E,U+00A0,U+00B7,U+00D7,U+2013,U+2014,U+2019,U+201C,U+201D,U+2022,U+2026,U+2212 \
  --layout-features=kern --no-hinting --flavor=woff2 --notdef-outline --no-layout-closure \
  --name-IDs=0,1,2,3,4,5,6,13,14 --drop-tables+=STAT,MVAR,gasp,prep,DSIG \
  --output-file=pixelify-sans-latin.woff2
```

Font facts PRISM and CIRCUIT need:
- **No `tnum` feature, so `font-variant-numeric: tabular-nums` does nothing.** Digits 0, 2-9 are all 586/1000 em wide
  at weight 400, but **`1` is 404**. Dial and keypad digits sit in fixed-size buttons so they cannot reflow. The Blood
  timer readout and the score pop can: give those digit runs a fixed `min-inline-size` (for example `6ch`) or
  `display: inline-block; inline-size: 1ch` per digit, instead of relying on `tabular-nums`.
- Vertical metrics: upm 1000, ascent 920, descent 280, line gap 0 (`hhea` equals typo, USE_TYPO_METRICS set).
- Only the Latin subset is shipped. Arabic falls through to the system font by design (design.md 3.2).

### 2.1 `@font-face` for PRISM (paste into `css/`, URL is relative to the CSS file in `css/`)

```css
@font-face {
  font-family: "Pixelify Sans";
  src: url("../assets/fonts/pixelify-sans-latin.woff2") format("woff2");
  font-weight: 400 700;
  font-style: normal;
  /* swap: text paints at once in the fallback; the font never blocks the h1 that is our LCP element */
  font-display: swap;
  unicode-range: U+0020-007E, U+00A0, U+00B7, U+00D7, U+2013, U+2014, U+2019, U+201C, U+201D, U+2022, U+2026, U+2212;
}
```
Keep `font-synthesis: none` on `html` (design.md 3.1).

### 2.2 Size-adjusted fallback (computed from the real metrics, not guessed)

The size-adjust ratio is the average advance of Pixelify Sans divided by the average advance of Arial
(Liberation Sans, metric-compatible with Arial, was the measuring face), weighted over the actual English copy
of `index.html` text nodes plus the `js/i18n/en.js` strings (8,627 printable-ASCII characters). The copy is
not final, so recompute (average advance of the corpus in both fonts, via fontTools `hmtx`) if the copy changes a lot; the ratios move slowly.

| Weight | Pixelify avg advance | Arial avg advance | `size-adjust` | `ascent-override` | `descent-override` |
|---|---|---|---|---|---|
| 400 | 0.4840 em | 0.4387 em | 110.34% | 83.38% | 25.38% |
| 700 | 0.4985 em | 0.4705 em | 105.96% | 86.82% | 26.42% |

Override formula (the percentages apply before `size-adjust`, so divide by it): `ascent-override = 920 / (1000 x size-adjust)`,
`descent-override = 280 / (1000 x size-adjust)`, `line-gap-override = 0`.

```css
@font-face {
  font-family: "Pixelify Fallback";
  src: local("Arial"), local("Helvetica"), local("Liberation Sans");
  font-weight: 400;
  size-adjust: 110.34%;
  ascent-override: 83.38%;
  descent-override: 25.38%;
  line-gap-override: 0%;
}
@font-face {
  font-family: "Pixelify Fallback";
  src: local("Arial Bold"), local("Arial-BoldMT"), local("Helvetica-Bold"), local("Liberation Sans Bold");
  font-weight: 700;
  size-adjust: 105.96%;
  ascent-override: 86.82%;
  descent-override: 26.42%;
  line-gap-override: 0%;
}
```
Stack (this edits MUSE's 3.1 stack by inserting one family; ATLAS/MUSE to confirm):
`--lp-font-latin: "Pixelify Sans", "Pixelify Fallback", ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace;`
and the same insertion in `--lp-font-arabic` right after `"Pixelify Sans"`. If no `local()` source exists, the face is
skipped and the browser continues down the list to the monospace fallback, so nothing breaks.

Measured effect (headless Chromium 1x, this machine, `local("Arial")` resolving to Liberation Sans, 93 distinct copy
strings from the app set at 16 px / line-height 1.4 in a column of the given width; a "mismatch" means the wrapped
height differs by more than 1 px from the Pixelify rendering, i.e. a line break moved):

| Column | monospace stack (today) | raw Arial | **adjusted fallback** |
|---|---|---|---|
| 280 px, 400 | 26 / 93 | 11 / 93 | **2 / 93** |
| 320 px, 400 | 28 / 93 | 16 / 93 | **4 / 93** |
| 360 px, 400 | 31 / 93 | 11 / 93 | **1 / 93** |
| 390 px, 400 | 28 / 93 | 5 / 93 | **2 / 93** |
| 320 px, 700 | 26 / 93 | 10 / 93 | **6 / 93** |
| 390 px, 700 | 24 / 93 | 5 / 93 | **1 / 93** |

(Test: a throwaway page in the session scratchpad, not in the repo; four widths x two weights were run, six rows shown. Single-line
height was identical in every family only because `line-height` was a fixed 1.4, so the `ascent/descent-override` effect is not
exercised by this test; it matters only where `line-height: normal` is used.)
Not measured and not assumed: Android Roboto and iOS system fonts. On Android, Chrome may not resolve `local("Arial")`
to Roboto; if it does not, the stack falls back to the unadjusted monospace and the real shift is bounded by the layout
rules in section 4. Re-check on a real device or with the Playwright `Pixel` profile once CSS exists.

### 2.3 Is preloading the font worth it?

Yes, narrowly; recommended, with `crossorigin` (required even for same-origin fonts, otherwise the file downloads twice):

```html
<link rel="preload" as="font" type="font/woff2" crossorigin href="./assets/fonts/pixelify-sans-latin.woff2">
```
Reasoning (arithmetic on the stated throttle profile, **not a measured A/B**): 6,292 B at 1.6 Mbps is about 31 ms of
transfer, so bytes are not the issue; the latency is. Without preload the browser only learns it needs the font after
`main.css` has arrived and been parsed and layout has found Pixelify text: one extra round trip (150 ms RTT plus TTFB)
after the CSS. With preload the request leaves with the HTML head, in parallel with the CSS. The cost is about 31 ms of
shared bandwidth, the file is always used on first paint, and the URL resolves to the same absolute URL as the
`@font-face` one (`./assets/fonts/...` from `/`, `../assets/fonts/...` from `/css/`), so it is a cache hit, not a double fetch.
Gain: the swap from fallback to pixel font lands roughly one RTT (~150-200 ms) earlier, which shortens the window in which
a reflow can happen. It does **not** move LCP, because `font-display: swap` paints the h1 in the fallback immediately.
To confirm, once CSS exists, run section 7 twice (with and without the tag) and compare the time of the swap
(`document.fonts` `loadingdone`) and CLS; delete the tag if the difference is nil. Do not add `fetchpriority`.

## 3. Sprites, icons, social card

`assets/sprites.svg` is generated mechanically from design.md section 9 maps (the maps are read from the doc,
every row length is asserted, every pixel is asserted covered exactly once by the emitted rectangles). 18 symbols:
`lp-lock-closed lp-lock-open lp-vault-door lp-check lp-x lp-clock lp-bulb lp-skull lp-drop lp-trophy lp-user
lp-speaker-on lp-speaker-off lp-arrow-left lp-sum lp-parity lp-compare lp-even-count`.
`lp-d0..lp-d9` are omitted (MUSE allows it; unused at launch; add back about 1 KB raw if Plan B digits are needed).
- 5,073 B raw, 1,118 B gz. One `<path>` per colour; rows merged into horizontal runs and identical runs stacked into taller rectangles;
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
1. Font swap: `font-display: swap` plus the size-adjusted `Pixelify Fallback` face (2.2). Weighted copy shows 1-6 of 93 strings re-wrap
   (vs 22-31 with the bare monospace stack).
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
| Pixelify Sans subset (self-hosted) | 6,292 B | MUSE's single family; no third-party request, no SRI needed |
| `sprites.svg` | 1,118 B | first-party, generated |
| Everything else | 0 | no framework, no bundler, no CDN (ADR 0001) |

Cross-origin at runtime: only `firestore.googleapis.com` via `fetch`, after user action or on session resume (not part of first paint).
Tooling used by QUARTZ, **all dev-only, none shipped or added to the project**: Python 3 with fontTools 4.62.1 + brotli (font subset and metrics),
Pillow 12.3 (PNG palette quantize), `xmllint`, system Chromium (contact sheets, OG render, font fallback test), `playwright-cli` with
`--config` pointing at `/usr/bin/chromium` (harness smoke test). `pngquant` and `optipng` are not installed; PIL palette quantization was used instead.
Generator and test scripts live in the session scratchpad, not the repo.

## 6. Re-measure now (no scripts needed; zsh or bash, from the project root)

```sh
gzs() { for f in "$@"; do gzip -9 -n -c "$f" | wc -c; done | paste -sd+ | bc; }   # sum of per-file gzip sizes
echo "HTML  $(gzs index.html)   (budget 14000)"
echo "CSS   $(gzs css/*.css)    (budget 18000)"
echo "FONT  $(wc -c < assets/fonts/pixelify-sans-latin.woff2)   (budget 20000; woff2 is not re-gzipped)"
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
(On 2026-10-07 this printed `static closure 15 files 38044 + boot imports 6298 = 44342`.)

Snapshot taken 2026-10-07 (bodies, gzip -9): HTML 9,431 | CSS 14,818 | JS first load 44,342 (38,044 closure + 5,482 + 816) | FONT 6,292 | SPR 1,118. On the wire per SENTRY: HTML 9,770 | CSS 14,714 | JS 49,625 | FONT 6,559 | SPR 1,412 | total 83,300.

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
