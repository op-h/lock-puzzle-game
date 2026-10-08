# QA: browser matrix, release checklist, findings (SENTRY)

Owner: SENTRY. **Re-gate 2026-10-08 on the final tree** (PRISM, CIRCUIT, GRANITE finished; ADR 0004 in force).
Everything below was measured on this machine unless it says NOT MEASURED. Nothing contacted the live Firestore project:
all Firestore traffic is answered in-process (section 8) and Chromium ran with
`--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"`, so a leaked request would fail, not leave.

## 0. RELEASE VERDICT

**SHIP WITH KNOWN RISKS.** The three hard failures of the first gate (F-03, F-05, F-01) and the strongly-recommended ones (F-04, F-09,
F-02, F-06) are fixed and verified by strict tests. No Definition-of-Done item has a known failing measurement on this machine. What stays open is
cosmetic or legibility (F-12, F-13, F-07 residual) plus things that cannot be measured here (real devices, WebKit, screen readers).
This is a verdict about *this machine*: DoD 6 on a real mid-tier Android and iOS Safari are NOT MEASURED, and the device script in
section 7 should be run before announcing.

Gate numbers: unit tests **310/310**; Chromium e2e **85 tests, 83 pass, 0 fail, 2 todo** (F-12, F-13); matrix **870 measurements**
(702 layout audits); perf, CSP, staged-deploy smoke, forced-colors and high-contrast runs all green except the open items below.

### Fixed since the first gate (each now a strict test)

| ID | Was | Evidence now |
|---|---|---|
| F-03 | Quit hidden under the sticky dock (WCAG 2.4.11) | `08-keyboard` "focus not obscured" green at 320x568, 390x844, 1280x800 EN+AR; `11-final` "Quit is reachable with a real pointer click and by keyboard" green on 5-dial Classic and Blood. Dock is now 291 px at 320x568 (was 382) |
| F-05 | open Log Out menu off-screen at 320/390 | 12 `account menu @ w x lang` tests (320, 360, 390, 480, 768, 1280; EN and AR): inside the viewport and hit-testable |
| F-01 | 404 console error on every sign-up / wrong code | existence probes use `documents:batchGet`; `01-auth-sync` strict: zero console messages and no 4xx; no plain `GET players/<id>` remains. The harness no longer has a `KNOWN_PROBE_404` filter |
| F-04 | reload mid-Blood bounced to Home for 6 s | `03-blood` real-clock reload test strict and green (ownership state machine) |
| F-02 | dead header buttons with JS off, two credits | `07-nojs` strict: no visible control or empty chip, exactly **one** visible credit (the `<noscript>` one), in both motion modes and schemes |
| F-09 | header 116-124 px + dock left 0-70 px | header one row, 56 px at 320-390. Clue area beside the dock: **221 px at 320x568 (target 170), 315 px at 360x740, 419 px at 390x844 (target 330)** in the standard states |
| F-06 | words broken in the difficulty picker and elsewhere | 2x2 picker clean at 320/390/768; word-break scan over 8 screens x 4 widths x EN/AR green apart from F-12/F-13 |
| F-07 | uppercase pixel type read "OREATE", "GEST" | ADR 0004 sentence case; screenshots reviewed (section 4). Residual below |
| F-08 | Firefox: no toast for a live Blood run in another tab | the Firefox multi-tab test passes |
| F-10 | first-load JS over budget | ADR 0004 counts gzip-9 response **bodies**: 45,537 B = 44.5 KiB against 46,080 B. PASS, **543 B of headroom** |

### Open findings

| ID | Severity | Owner | Where | Detail |
|---|---|---|---|---|
| F-12 | Low | PRISM | play status cell `[data-out="difficulty"]`, `css/main.css` status `dl` grid | At **320 px only** "Master · 5 digits, all different" is squeezed into a ~85 px column and breaks inside words (Mast/er, digi/ts, diffe/rent; AR the same); it also abuts the "Difficulty" label and the long puzzle id wraps beside it. 360 px and wider are clean. `11-final` todo F-12 |
| F-13 | Low-Medium | PRISM | leaderboard `thead th` (Rank column, ~56 px) | In **Arabic** the word الترتيب breaks as "الترتي / ب" at every width 320-768 (an Arabic word split across lines). `11-final` todo F-13. Screenshot `tests/e2e/shots/ar-board-768.png` |
| F-07b | Low | MUSE | `css/main.css:285` family, bold weight of Pixelify Sans | Sentence case fixed the shouting, but the capital **B reads as G** ("Glood" tab, "Gack" button) and capital **C as O** ("Olues") in the bold weight at small sizes, and **5 looks like S** in the dials and keypad. Unaffected for screen readers. Consider medium weight for button labels or a different face for the single-letter cases |
| F-09b | Low | PRISM | dock at its tallest | One wrong guess + a used Hint on a 5-digit puzzle (chips row + message) leaves **150 px at 320x568 (116 px in Arabic) and 301 px at 390x844**, under the 170/330 targets. Standard states meet them |
| F-11 | Info | PRISM | 1280x800, one run | `matrix.json` once saw 17 dock controls below the fold in one state; not reproduced elsewhere |
| F-14 | Info | SENTRY | `tests/e2e/shots/` | Firefox: 14 of 85 tests fail, none of them proven an app defect (section 3) |

## 1. How to re-run everything

```sh
npm ci                                   # playwright-core only; no browser is downloaded
npm run test:unit                        # node --test "tests/unit/*.test.mjs"   (310 tests; add PUZZLE_SEEDS=300 for the heavy property runs)
npm run test:e2e                         # 85 e2e tests on /usr/bin/chromium (CHROMIUM_PATH overrides): 83 pass, 2 todo
E2E_BROWSER=firefox npm run test:e2e     # Firefox 155, see section 3 for what to expect
node tests/e2e/matrix/run-matrix.mjs --zoom   # 870 viewport measurements + screenshots in tests/e2e/shots/ (~2.5 min)
node tests/e2e/matrix/run-modes.mjs      # prefers-contrast:more and forced-colors:active
node tests/e2e/perf/run-perf.mjs         # throttled run, writes tests/e2e/shots/perf.json
.github/scripts/stage-site.sh && node .github/scripts/verify-site.mjs _site
E2E_ROOT=$PWD/_site node --test tests/e2e/09-hosting.spec.mjs tests/e2e/10-csp.spec.mjs   # smoke against the deploy artifact
```

`npm run serve` starts the Pages-like server (gzip, `max-age=600`, project sub-path `/lock-puzzle-game/`, 404 outside it).
The two remaining `todo` tests (F-12, F-13) print as warnings and do not fail the suite; remove the `todo` option when the defect is fixed.

Dev dependency (not shipped, not in `_site/`): **`playwright-core@1.63.0`**, about 13.4 MB unpacked, 0 bytes to users.
Justification: the DoD needs a real browser (focus, layout, CDP media pinning, fake clock, offline, service workers) and there is no vanilla
alternative; `-core` carries no browser download and drives the system Chromium. Everything else is `node:test`, `node:http`, `node:zlib`.

Harness facts (all in `tests/e2e/support/`):
- `pinMedia()` sets `prefers-reduced-motion`, `prefers-color-scheme`, `prefers-contrast`, `forced-colors` with CDP `Emulation.setEmulatedMedia`
  (all four each call) and reads them back with `matchMedia`; it throws if the pin did not take (CLAUDE.md: headless Chromium silently reports `reduce`).
- Every device collects `pageerror`, console errors **and warnings**, failed requests, HTTP >= 400, third-party hosts, `securitypolicyviolation`
  and `unhandledrejection`; each test ends with `assertClean()`. There is no allow-list for known defects any more.
- Chromium with scripting emulated off still issues the six `modulepreload` requests and fails them with errorText `csp` (identical with the CSP
  meta removed): filtered for `js:false` devices only.
- `wrongGuess()` returns a rearrangement of the answer: a guess that repeats a digit on a no-repeat puzzle is rejected free and is not a "wrong guess".
- `quitRound()` now uses a real pointer click (it used a DOM click while F-03 was open).

## 2. Release checklist (Definition of Done, `CLAUDE.md`)

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Content and primary navigation without JS | **PASS (waived by ADR 0001), compensation PASS** | JS-off x motion(2) x scheme(2): one visible `<h1>` ("This game needs JavaScript to play"), the five rule sections, the worked example (answer 184), exactly one visible credit (in `<noscript>`), no app screen, no dead button or chip, zero console messages, no overflow, nothing changes after the 3 s boot fail-safe. Failed-boot (module blocked, JS on): the fail-safe reveals the page after ~3 s in both motion modes (documented degrade, dead form, no message) |
| 2 | Keyboard end to end, visible focus ring on every theme | **PASS** | 168 focus-ring audits (320, 390, 1280; 4 schemes): outline >= 2 px on every stop, best ring band vs background >= 14.27:1. Tab order == visual order and Shift+Tab reaches the same set on auth, sign-in, home, play 5-dial, result, board, help, Blood at 320x568 / 390x844 / 1280x800 in EN and AR. No trap; dialog Esc rules asserted; focus returns to the trigger; skip link works; ARIA-disabled Check/Hint stay focusable and say why |
| 3 | WCAG 2.2 AA: 4.5:1, 3:1 UI, 24x24, focus not obscured, no trap | **PASS** | focus not obscured at 320x568, 390x844 and 1280x800 (EN+AR, every screen) and Quit reachable by pointer; contrast and targets below |
| 3a | Text contrast, rendered | **PASS** | 13,620 text nodes over 702 layout measurements (7 widths, EN/AR, dark/light, Classic/Blood palettes, every screen): 0 failures, lowest **4.52:1** (`button[check]`, Classic light), computed from composited backgrounds incl. the 8 % dither checker |
| 3b | prefers-contrast: more | **PASS** | 4 screens x 2 schemes: 0 failures, minimum 4.69:1 (Blood light) |
| 3c | UI component contrast (3:1) | **PASS with a note** | The script's remaining flags (158 hits: `button[check]`, `button[hint]`, dials at 1.58-2.22:1) are all the *inactive* states (aria-disabled Check before the dials are full, used Hint, hint-locked dial), which WCAG 1.4.11 exempts. Enabled controls are separated by fill and frame (enabled Check is amber on the dock fill) |
| 3d | Targets | **PASS** | 0 controls under 24x24 and **0 under 44x44** in 702 measurements (radio+label counted as one target) |
| 3e | forced-colors: active | **PASS** | every button bordered (5/5, 7/7, 21/21, 20/20), wrong digits carry an X, status icons visible, no overflow; `tests/e2e/shots/modes/` |
| 4 | No horizontal scroll / clipped text 320-2560 and at 200 % zoom | **PASS** | `scrollWidth <= innerWidth` in all 702 layout measurements, 0 clipped-text hits, zoom 200 % (640x400 @2x) and 400 % (320x200 @4x) and text-only 200 %: 0 horizontal scroll. The account menu is inside the viewport at 320/360/390/480/768/1280 EN+AR. Words break mid-word only at F-12 and F-13 |
| 5 | reduced-motion and colour scheme respected | **PASS** | every measurement for `reduce` and `no-preference`, `dark` and `light`, pinned and read back; JS-off and failed-boot fail-safe in both motion modes; animations/transitions none under `reduce`; no `transition: all`; 0 `border-radius` |
| 6 | LCP < 2.5 s, INP < 200 ms, CLS < 0.1 on throttled mid-tier Android over 4G | **PASS on the throttled desktop proxy, NOT MEASURED on a device** | section 5. LCP 1,320 ms median, CLS 0, INP-like worst 154 ms; first-load JS 45,537 B body-gzip against 46,080 B |
| 7 | Zero console errors/rejections, explicit image/embed dimensions | **PASS** | all 85 tests end with a clean collector: zero console errors and warnings, zero 4xx, zero CSP violations, zero "preloaded but not used" in EN and AR, zero unhandled rejections. All 33 `<use>`/`<svg>` have `width`/`height`; no `<img>`, no iframe; CLS 0 |
| 8 | No secret, token or key in client code | **PASS** | scan of `js/`, `css/`, `assets/`, `index.html`, `sw.js`, manifest for private keys, GitHub/AWS/Slack tokens, bearer strings, `client_secret`: none; exactly one Google API key literal (the public Web key, ADR 0002); no cookies; `lp1.*` storage only; the sign-up code is in neither storage nor the backend document; `verify-site.mjs` repeats the scan on the staged artifact |

## 3. Browser matrix (what was actually run)

| Engine | Version | Result |
|---|---|---|
| Chromium (system `/usr/bin/chromium`, headless, via playwright-core 1.63.0) | 150.0.7871.181 | **Full**: 85 e2e tests (83 pass, 0 fail, 2 todo), matrix 870 measurements, modes, perf, SW, CSP, staged smoke |
| Firefox (Playwright build 1543) | 155.0 | **Partial**: 85 ran, **69 pass, 14 fail, 2 todo**. The same todos (F-12, F-13) behave identically. Failures classified: (a) harness noise, shown by the messages: `NS_ERROR_OFFLINE` / `NS_BINDING_ABORTED` / Cross-Origin console errors from the aborted fake-Firestore route (board offline test, SW update test) and Playwright's Firefox offline emulation refusing the SW-served reload (2 SW tests); (b) Tab/Shift+Tab semantics and scroll-into-view differ in headless Firefox (6 tab-order audits, the dialog cycle test, the "not fully inside the viewport" obscured test); (c) my bidi-sensitive word-break scanner reports Arabic punctuation runs (`3:00،`) as broken words in Firefox; (d) **not triaged**: "clue cards @ 390" (`li[data-kind=feedback]` not found right after start in Firefox). I did not prove (b) and (d) are not app issues; they need a Firefox pass by a human or an engine-aware harness |
| WebKit / Safari | Playwright build 2359 is cached | **NOT RUN**: the host lacks system libraries (`browserType.launch: Host system is missing dependencies`). Needs `sudo npx playwright-core install-deps webkit` (apt, root), then `E2E_BROWSER=webkit npm run test:e2e`. Real iOS Safari is **NOT MEASURED** |
| Real devices | none | **NOT MEASURED** |

Non-standard API check: no implicit global `event`; `light-dark()` (Chrome 123, Safari 17.5, Firefox 120), `@media (scripting)` (Chrome 120, Firefox 113, Safari 17), `@property`, `:has()`, `round()` (with an `@supports` guard), `color-mix()`, `interactive-widget` (ignored where unknown) and `dialog` are Baseline 2024 and rely on no polyfill. Older browsers lose the colour tokens entirely (`light-dark()` has no fallback): acceptable only because the project targets evergreen browsers.

## 4. Matrix, viewport and visual review

Screens x widths 320, 360, 390, 768, 1280, 1920, 2560 (heights 568, 740, 844, 1024, 800, 1080, 1440; mobile emulation up to 768) x EN/AR x
dark/light (Blood palette on the Blood screens) x reduce/no-preference. States: auth, sign-in, home, help, board, play Classic 3/4/5 digits,
play 5-digit after a wrong guess and a hint (tallest dock), play Blood, result Classic, result Blood.

**200 % zoom method.** A 1280x800 window at 200 % browser zoom presents a 640x400 CSS-pixel viewport at device pixel ratio 2: media queries,
`vw`, `rem` and `clamp()` respond as under real zoom. The run uses exactly that (640x400 @2x), plus 400 % (320x200 @4x, WCAG 1.4.10 reflow) and a
text-only 200 % (`html { font-size: 200% }`) at 390 and 1280. A literal browser zoom cannot be driven headless; this is a defensible stand-in.
Safe areas: not emulated; the CSS uses `max(..., env(safe-area-inset-*))` for the gutter, dock, footer and `main`. **Safe-area behaviour on a notched device is NOT MEASURED.**

Pixel-look rules, computed on every measurement: font **loaded** (`Pixelify Sans`, `Pixelify Fallback`); **0** non-zero `border-radius`; **0**
`transition: all`; sprite hosts are integer sizes with `shape-rendering: crispEdges` (computed `image-rendering` on the `<svg>` is `auto`: for vector
sprites `crispEdges` is the effective control, reported rather than failed). All 33 `<use href>` resolve; no 404 anywhere.

Dock/header budget (clue area left beside the sticky dock, `matrix.json`): 320x568 **221 px** (Classic 3 and 5 dials), 226 (Blood); 360x740 **315**;
390x844 **419** (Classic), 424 (Blood); header 56 px, one row, at 320-390. Tallest state (5 dials + wrong-guess chips + hint message): 150 / 282 / 301 px (F-09b).
Header one row at 320, 360 and 390 in EN and AR, signed out, signed in and after toggling language (including the "English" label): `11-final` green.

Screenshots I looked at (`tests/e2e/shots/`), described as seen:
- **320 auth** (`w320/auth-en-dark.png`): clean. Header is one 56 px row (lock, Arabic toggle, mute, status chip). Sentence case reads well: "Welcome to Lock Puzzle", "Create a Player", "Create Player and Get Code" on the amber button. The pixel C is readable in these sizes.
- **320 play, 5 dials** (`w320/play-classic-5-en-dark.png`): five dials in one row, keypad aligned under them, Clear | Check | Hint in one row (Hint wraps to two lines). The Check is dimmed (aria-disabled, no dials filled). The status strip is the weak spot: "Master · 5 digits, all different" is squeezed into a narrow column and breaks inside words (F-12), and the long puzzle id sits right against the "Difficulty" label.
- **390 play, Blood** (`w390/play-blood-en-dark.png`): red palette, one-row header, `3:00` with the segmented bar, difficulty text wrapping only at spaces, the first two clues readable above the dock, three dials, keypad, Clear | Check | Skip. A clear improvement on the first gate (where only a sliver of one clue was visible).
- **AR 390 play** (`w390/play-classic-5-wrong+hint-ar-dark.png`): mirrored one-row header with the "English" button, dial row and keypad LTR, wrong-guess chip in dial order, Arabic clue cards with LTR digit boxes and pips and an RTL sentence, "إنهاء الجولة" visible above the dock. The hint message is English because it was written before the language switch (transient text does not re-translate; accepted). The 5 still looks like an S (F-07b).
- **390 result** (`w390/result-classic-en-dark-full.png`): tidy: stamp "Lock opened.", Points Earned list that names Classic, the red "Total Blood points (from Blood mode)" line, Total points, Score this round, Next Puzzle and Back to Home.
- **390 home** (`w390/home-en-dark-full.png`): points panel with the explicit Blood label, a clean 2x2 difficulty picker with whole words, Play Classic (amber) and Play Blood (red) with their rules, Recent Rounds, Leaderboard, How to Play.
- **320 board** (`w320/board-en-dark-full.png`): tabs with a check mark on the selected one, ranked rows that wrap long names at hyphens and spaces. Cosmetic: the Blood tab sits about 4 px higher than All-time, and the capital B in "Blood" and "Back" reads like a G (F-07b).
- **320 help** (`w320/help-en-dark.png`): readable body text at 320; "Reading the Clues" heading shows the C as O in bold (F-07b).
- **AR board 768** (`ar-board-768.png`): mirrored layout, one-row header, "You" marker; the Rank column header is broken into "الترتي / ب" (F-13).
- **Forced colours, play** (`modes/play-forced-colors-dark.png`): black/white, every control bordered, wrong digits carry an X, icons intact.

Arabic clue cards: at 320 and 390 the feedback card is `direction: ltr` with `unicode-bidi: isolate`; digit boxes run in dial order, pips follow (wrapped to the row below at 5 digits / 320), the sentence is RTL and right-aligned on its own row; English unchanged; board points are Latin digits and fit.

## 5. Performance (DoD 6), measured as far as possible here

**Throttled desktop Chromium, not a real mid-tier Android.** CDP network 1.6 Mbps down / 750 Kbps up / 150 ms RTT, CPU x4, 360x800 @2x mobile
emulation, fresh context + `Network.clearBrowserCache` per run, motion `no-preference` and scheme `dark` pinned, served by
`tests/e2e/support/static-server.mjs` (gzip level 9, like Pages) from the *staged* copy. 5 cold runs, 2026-10-08, final CSS/HTML/JS.

| Metric | Median | Worst | Gate | |
|---|---|---|---|---|
| LCP (element: the intro `<p>`, static HTML) | 1,320 ms | 1,332 ms | < 2,500 ms | PASS |
| FCP | 664 ms | 684 ms | n/a | |
| CLS (cold) | 0 | 0 | < 0.1 | PASS |
| CLS (returning, signed in; shift source two buttons + a paragraph at ~1.3 s) | 0.0029 | 0.0029 | < 0.1 | PASS |
| TBT proxy (long tasks after FCP, excess over 50 ms) | 18 ms | 27 ms | n/a | |
| Load event | 1,214 ms | 1,228 ms | n/a | |
| INP-like, per interaction (dispatch to second frame, includes ~80 ms of harness frames) | | **154 ms** (Play Blood: route + generate + render); Check 148 ms | < 200 ms | PASS (proxy) |
| Browser event timing, worst `duration` | | 96-120 ms over 3 runs | < 200 ms | PASS (proxy) |

Transfer, cold signed-out first visit, 23 requests. **Budgets are gzip-9 response BODY bytes (ADR 0004)**; the wire figure (`encodedDataLength`, includes response headers, about 300 B per file) is shown for information:

| Part | Body gz-9 | Wire | Budget | |
|---|---|---|---|---|
| HTML | 9,465 B | 9,770 B | 14,000 | PASS |
| CSS | 15,714 B | 16,019 B | 18,000 | PASS |
| JS first load, 17 files | **45,537 B** (44.47 KiB) | 50,820 B | 46,080 B (45 KiB) | **PASS, 543 B of headroom** |
| Font | 6,292 B | 6,559 B | 20,000 | PASS |
| Sprites | 1,118 B | 1,412 B | 8,000 | PASS |
| Total (wire) | | 85,800 B | 120,000 | PASS |

CIRCUIT's own count for the same load is 44,727 B EN / 46,021 B AR; mine counts the 17 files the browser actually requested (including `sync/tabs.js`, `engine/scoring.js`, `i18n/index.js`). Both are inside 46,080 B, but the Arabic first load is within 59 B of the ceiling: the next added line of JS needs a budget conversation. Returning signed-in visitor loads 57,088 B on the wire. All six `modulepreload` targets are used on the first load (no unused-preload warning in EN or AR). Third-party requests on first paint: 0.

## 6. Security headers, CSP, and what a meta tag cannot do

`index.html` `<head>` carries (first, before any script or stylesheet):

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-VJ6ocaVW/BWlbOUIOwLiQN8XvxOywRW1dEmTKoxMvsQ=';
  style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://firestore.googleapis.com;
  manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'
<meta name="referrer" content="strict-origin-when-cross-origin">
```

The hash was **recomputed** from the actual inline script bytes (180 chars, no CR, no newline, recipe in `docs/seo.md` 3) and
is `sha256-VJ6ocaVW/BWlbOUIOwLiQN8XvxOywRW1dEmTKoxMvsQ=`, identical to the one ATLAS supplied. `verify-site.mjs` and
`10-csp.spec.mjs` recompute it on every run: changing that script by one byte fails both. `data:` in `img-src` is required by the
CSS mask icons (`url("data:image/svg+xml...")`); `style-src 'self'` works because every dynamic style is CSSOM
(`el.style.setProperty`, allowed) and there is no `style=""` in markup or JS (asserted).

Verified in a real browser (`10-csp.spec.mjs`): an injected inline `<script>` does not run; `new Function` is blocked for page
scripts; a `style=""` attribute is blocked while CSSOM styling works; an injected `<base>` is blocked; a `fetch` to another
origin is blocked; every violation fires `securitypolicyviolation`. All 85 e2e tests ran under the policy with **zero**
violations, zero console errors, and zero unused-preload warnings.

What a `<meta>` CSP **cannot** do, and GitHub Pages cannot add (no custom headers):
- `frame-ancestors`, `report-uri`/`report-to`, `sandbox` are ignored in a meta element (and log a console error), so they are
  deliberately absent. **Clickjacking is not prevented**: anyone can frame the site. Residual risk is **low**: there is no
  sensitive action (no payment, no account management beyond a game save and logout), and a framed game cannot read its
  parent. If that is not acceptable, put Cloudflare or another proxy in front to add `Content-Security-Policy: frame-ancestors 'none'`.
- No `Strict-Transport-Security` from us: Pages enforces HTTPS only if "Enforce HTTPS" is ticked, and HSTS preload needs a host we control. No
  `X-Content-Type-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`: Pages sends its own defaults only.
- The meta policy applies from the point it is parsed; the six bytes before it (`charset`, `viewport`) carry no resource.
- The service worker has its own (empty) policy; it only does same-origin `fetch`/`Cache`, never a cross-origin request
  (asserted: no request from the worker to another origin, nothing foreign cached).
- Firestore: the Web API key is public by design (ADR 0002); the rules in `firestore.rules` are the only access control and have
  **not** been run against the emulator here. Brute force of a 6-digit code per name is an accepted, documented risk.

## 7. Manual device test script (real phone, ~15 minutes)

Run on **iOS Safari** (latest and one major back) and **Android Chrome**, on https://op-h.github.io/lock-puzzle-game/ once Pages is live.
1. Load cold on mobile data. It should paint the heading in under ~2 s; no blank flash; no horizontal scroll at any rotation.
2. Add to Home Screen / Install. Icon is the pixel lock (maskable on Android, opaque on iOS); opens standalone; status bar colour matches the dark/light theme.
3. Sign up with a short name. The code dialog appears; try swiping back, Esc/hardware back and closing the tab: it must not let you lose the code. Tick the box, continue.
4. **On-screen keyboard**: in sign-in, focus the name and code fields. The keyboard must not hide the Sign In button (`interactive-widget=resizes-content`); the code field should show the numeric pad. On Play the OS keyboard must **not** open (dials are buttons).
5. Play a Classic round with taps only. Check dials, keypad, Check, Hint. Can you read the clues and see the dials together on a small phone (expect about 220 px of clue area at 568 px tall, less after a wrong guess + hint)? Can you reach Quit?
6. Start Blood. Lock the screen for 20 s, unlock: the clock must have moved on. Pull-to-refresh once mid-run: you must land back in the run (F-04 is fixed; verify on a real browser, event order differs per engine).
7. **Safe areas**: on a notched iPhone in portrait and landscape, nothing sits under the notch, home indicator or rounded corners; the dock's bottom buttons clear the home indicator.
8. **Arabic**: toggle, check mirrored header, RTL prose, LTR dials/keypad/timer, Latin digits, no clipped Arabic glyphs in buttons. Open the account menu and confirm **Log Out** is fully on screen. Look for the broken Arabic word in the leaderboard Rank header (F-13).
9. **Offline**: after one online visit, turn on airplane mode and reload: the shell loads, you can play on the device, status says "On this device"/"Offline"; reconnect and watch it return to "Synced" without a reload. (Needs the staged build: the repo tree's service worker is a deliberate no-op.)
10. Leaderboard on both tabs, then log out and sign in on the other phone with name + code: totals and Blood points must match.
11. Screen reader pass (VoiceOver and TalkBack): headings, the code announced once in the dialog, timer announcements only at 2:00, 1:00, 0:30, 0:10, 0:00, dial labels "Digit 2 of 4, value 7". **Not measured here.**

## 8. Test infrastructure notes

- Fake backend: `tests/unit/helpers/fake-firestore.mjs` (get, create with `exists=false`, patch with `updateTime` precondition,
  `runQuery`, rule-shape checks) is mounted with `context.route('https://firestore.googleapis.com/**')`, including the CORS
  preflight. One backend object is shared by several browser contexts to model several devices. `net.offline`/`net.block`
  turn a "device" off; `backend.faults.deny/quota/server5xx` model rules and quota failures.
- Served from a sub-path: `static-server.mjs` mounts the files at `/lock-puzzle-game/` and answers 404 for anything outside it
  (a root-absolute URL would fail here, as on Pages), redirects `/lock-puzzle-game` to the slash form, gzips, and can rewrite one
  file (used to serve a "v2" service worker). The same specs also run from `/` (`09-hosting.spec.mjs`).
- Service worker: the repo tree ships `const VERSION = '__BUILD_ID__'`, which makes the worker a passthrough (no caching, deletes `lp1-*`
  caches). `.github/scripts/stage-site.sh` stamps the git SHA into the **staged** copy only; the SW specs stage a copy with a test id
  and serve that. Verified: scope is the project path; install is atomic (one missing precache file leaves no half cache and no active
  worker); cache-first; offline reload, offline sign-up (status "On this device") and sync-on-reconnect; a new version waits and takes
  over on the next load; the old cache is deleted; cross-origin requests are never intercepted or cached; nothing registers on `file:`
  (on `file:` the app cannot start anyway: ES modules need http(s); the README's old "open index.html" advice is wrong).
- Not part of the gate: `docs/`, `tests/`, `package*.json`, `firestore.rules`, `README.md` are never staged (`verify-site.mjs` fails if they are).

## 9. Known limitations and residual risks

- Real mid-tier Android over 4G, real iOS, WebKit, screen readers, safe-area insets, real browser zoom, `prefers-contrast` on a real OS: NOT MEASURED.
- Firefox is only partially covered (section 3); WebKit not at all.
- A failed boot with JS enabled (module blocked or 404) reveals the Auth form after 3 s with no error message (dead form). Documented degrade, tested in both motion modes.
- Open legibility/cosmetic items F-07b, F-09b, F-12, F-13 (section 0).
- First-load JS headroom is 543 B (EN) and about 59 B (AR) under the 46,080 B ceiling.
- Pages deployment: the workflow never ran on GitHub (cannot here). Actions are pinned to full SHAs (verified with `gh api repos/actions/<name>/git/ref/tags/<tag>`): checkout v7.0.1 `3d3c42e`, setup-node v7.0.0 `8207627`, configure-pages v6.0.0 `45bfe01`, upload-pages-artifact v5.0.0 `fc324d3`, deploy-pages v5.0.1 `368f825`. Supply-chain residual: a compromised action SHA would still run; Dependabot for `github-actions` is recommended. The e2e job relies on `/usr/bin/google-chrome` being on `ubuntu-latest` (it is today); if that changes, set `CHROMIUM_PATH`. Stage + verify + hosting/CSP smoke against `_site` were run locally and pass (53 files, release id stamped, nothing forbidden staged, unstamped `sw.js` is rejected).
- `firestore.rules` untested against the emulator; accepted brute-force and honour-system leaderboard risks are in ADR 0002.

## 10. Human steps (nobody else can do these)

1. Optional before Pages: fix F-12 and F-13 (cosmetic), re-run `npm run test:e2e`.
2. GitHub: Settings > Pages > Source: **GitHub Actions**; tick **Enforce HTTPS**. Push to `main` runs `.github/workflows/pages.yml`. Settings > Environments > `github-pages` may require a first approval.
3. Firebase console: enable Firestore (Native), then **publish `firestore.rules`** (`docs/backend.md` 2). Run the smoke list in `docs/backend.md` 4 with a throwaway name. Until then the app says "On this device".
4. Google Cloud console: restrict the Web API key to HTTP referrer `https://op-h.github.io/*` (and `http://localhost/*` if wanted) and to the Cloud Firestore API only (`docs/backend.md` 3).
5. Decide on clickjacking: accept (low) or add a header-capable proxy for `frame-ancestors`.
6. Search Console / social card checks after the first deploy (`docs/seo.md` 4 and 6); `og:image` needs the final URL.
7. Run the device script in section 7 on a real iPhone and Android before announcing.

## 11. Web Interface Guidelines review (skill `web-design-guidelines`, rules fetched 2026-10-07; first-gate findings re-checked)

Files: `index.html`, `css/main.css`, `js/ui/*.js`. Terse, `file:line`. Fixed since the first pass: dock covering focus (was `css/main.css:1006`), account menu off-screen (was `:534`), mid-word breaks, dead header buttons with JS off, uppercase setting.
- ui/board.js:89 - the leaderboard tab choice is not in the URL, so tabs are not deep-linkable (keyboard handling is correct); the Classic difficulty choice is not URL state either: low
- `font-variant-numeric: tabular-nums` is absent by design (the subset has no `tnum`); live digit cells are fixed in `ui/dom.js` `setDigits`. Board point columns use proportional digits, so right-aligned points do not line their digits up: low
- hover states exist only for buttons/summary; links have none: low
- keyframes still animate a registered colour custom property and `clip-path` (paint, not compositor); 1 Hz / 1.2 s steps, removed under `prefers-reduced-motion`: low
- Pass: no `transition: all`, no `outline: none` without replacement, `:focus-visible`, `touch-action: manipulation`, deliberate `-webkit-tap-highlight-color`, `overscroll-behavior: contain` on scrolling lists, safe-area insets, `color-scheme` + two `theme-color` metas, `text-wrap: balance/pretty`, no `user-scalable`, labelled inputs with `name`/`autocomplete`/`spellcheck=false`/`inputmode`, skip link, `aria-hidden` icons, sized sprites, `translate=no` on brand/credit, no `innerHTML`, names via `textContent`/`<bdi>`, polite live regions, confirmations on logout and quit, `beforeunload` guard on the one-time code, no `autofocus`, no paste blocking, sentence-case Title Case copy with `…` and no em dashes.

## 12. Findings register

Fixed and strictly tested: F-01 (`01-auth-sync`), F-02 (`07-nojs-credit`), F-03 (`08-keyboard` obscured test + `11-final` Quit test), F-04 (`03-blood`), F-05 (`11-final` account menu x12), F-06 (`11-final` word-break scan), F-07 (ADR 0004), F-08, F-10 (ADR 0004 budget). Open: F-12 and F-13 (`11-final`, `todo`), F-07b, F-09b, F-11, F-14.
