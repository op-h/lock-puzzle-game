# Design v2: "VAULT PANEL, CALM" (MUSE)

Binding brief: `docs/decisions/0005-calm-ui-polish.md`. Owner feedback: "polish the UI more, make it simpler, less
noisy, don't explain everything with words, arrange it nicely, less scrolling, smoother."
Consumers: GRANITE (markup), CIRCUIT (copy, render, hooks), PRISM (`css/main.css`), QUARTZ (font, sprites), SENTRY (gates).

## 0. Status, scope, honesty notes

- This file amends `docs/design.md` (v1). Where v1 and v2 disagree, **v2 wins**. What still stands from v1 is listed in 0.1.
- Evidence used: ADR 0005, v1 `docs/design.md`, the current `index.html`, `css/main.css`, `js/i18n/en.js`, and the two
  screenshots `ui/home.png` (390 wide) and `ui/play-classic.png`. I could not open the live site (no browser or shell tool this
  session) and I could not locate ADR 0003 / 0004 files by name (no directory listing available). I relied on ADR 0005's
  summary of them (Blood points labelling, Jersey 10, pixel identity). If either ADR contradicts this file, ATLAS rules.
- All contrast ratios are computed by hand (WCAG 2.x, luminances in v1 section 2.2). Anything within 0.2 of a threshold is
  flagged "script-check". The Jersey 10 glyph metrics (width per character, unitsPerEm) are **estimates**, not measurements:
  QUARTZ must record real widths in `docs/perf.md` and SENTRY's 320/390 screenshot pass is the acceptance test. Every
  width budget below leaves at least 8 px of slack for that reason, and says what to do when the slack is gone.
- Pixel arithmetic convention: "box" = the control's own rectangle. A framed control also owns a 4 px margin on each side for its
  frame bars (v1 4.3), so its **outer** size is box + 8 on each axis. All heights below are outer unless marked "box".

### 0.1 What still stands from v1
Concept and lamp idea (v1 1.1 to 1.4), colour tokens and four schemes (v1 2.1, one change in 2.4), 4 px grid (4.1), stepped-corner
frame recipe (4.3), sprite build rules and all existing 8x8 / 16x16 / 24x24 maps (9), focus ring (8), hooks in v1 10.3 not
listed as removed in section 10 below, the Blood/Classic `data-mode` token switch, `light-dark()` plumbing already in `main.css`.
Superseded: v1 3 (type), 4.6 (texture), 4.8 (page chrome), 5 (layouts), 6.4 (clue card), 6.10/6.11 (timer, chip), 7 (motion).

---------------------------------------------------------------------------------------------------

## 1. Principles and the noise inventory

### 1.1 Five principles
1. **One saturated thing per screen:** the primary action in the lamp colour (amber Classic, red only inside Blood). Everything else is steel and text.
2. **Air before ornament:** flat page, no rules, no dither, no frame around a group whose children are already framed. Gaps of 16 / 24 / 32 px do the separating.
3. **Show, don't tell:** glyphs (pips, symbols, icons, digit-count squares) first; a sentence survives only where the player cannot proceed without it. Everything else is visually hidden for AT or lives in Help.
4. **One hierarchy per screen:** one hero (title, score or dials), one primary button, the rest quiet (dim text, unframed icon buttons).
5. **Soft motion, same end state:** short ease-out on `transform`/`opacity` (<= 180 ms), sprites keep `steps()`, reduced motion shows the identical final state instantly.

### 1.2 Noise inventory: delete list (from ADR 0005) and what replaces each

| # | Noise today | Replaced by |
|---|---|---|
| 1 | Checker dither on `body` | Flat `--lp-bg-0`. Dither survives only on disabled and pressed controls. |
| 2 | Dashed rule under every `h2`, under header, above footer, between list rows | Nothing. 24 px of space. Table/list rows become flat `--lp-bg-1` bands 4 px apart. |
| 3 | Home paragraphs (signed-in line, difficulty note, Classic desc, Blood desc) | Name row + 2-4 word sublines inside the two mode buttons. Full rules text is visually hidden (`aria-describedby`) and lives in Help. |
| 4 | "Your Points" framed panel with `h2` + three `dl` rows | One flat band of three stat cells (Classic / Blood / Total), no frame, `h2` visually hidden. |
| 5 | "Recent Rounds" section | Removed from DOM, from i18n use and from `render`. |
| 6 | "Pick a Mode" `h1`, "Play" `h2`, "More" nav, "Leaderboard" and "How to Play" ghost buttons on Home | `h1` "Home" visually hidden; trophy and `?` icon buttons in the header. |
| 7 | Play: Puzzle id row, Difficulty row, Time row, Wrong-guesses row (a 4-row `dl`) | One 52 px top bar: quit, lock, difficulty name, timer, wrong count, sound. Puzzle id removed from DOM. |
| 8 | Visible "Crack the Lock" `h1`, "Clues" `h2`, "Your Guess" `h2`, guess-help paragraph | All four visually hidden (kept as names / descriptions for AT). |
| 9 | Lock sprite repeated in the dock, message row in the dock | Lock lives only in the top bar (32 px). Messages are a transient in-place toast over the bottom of the clue area, not a dock row. |
| 10 | "Hint (Half Points)" wrapping label; "Skip Puzzle"; "Clear" word button; "Quit Round" button | Icon-only buttons (bulb, skip, backspace, back-arrow) with a visually hidden name that keeps "Hint, half points". |
| 11 | Two near-identical user icons (sync chip + account) | Sync chip hidden while synced; when shown it uses the new `alert` sprite, icon only. Account is an avatar button, name moves into its menu. |
| 12 | Account name text in the header summary | Avatar only; name inside the menu; accessible name still "Account, <name>". |
| 13 | Pixelify Sans + bold + UPPERCASE badges + 0.06em tracking | Jersey 10 single weight, sentence case everywhere, no tracking. |
| 14 | Frames on: points panel, chips, mode badge, stamp, timer bar, clue digit boxes, dock section, help Blood section, toast, dialog, code box | Flat fills. Frames only on interactive controls (buttons, inputs, difficulty options, keys, dials). |
| 15 | Ledge under every button, key and dial | Ledge only on the primary buttons (Start, Sign in, Classic, Check, Next). |
| 16 | Wrong-guess chip list under the dials | Visually hidden list (kept for AT); the count is in the top bar. |
| 17 | Clue `#3` index, clue sentence under every feedback clue, 4 px start bar, `bg-2` + digit boxes | Row = guess digits + pips only (or icon + symbol text). Sentence visually hidden. |
| 18 | Auth: intro paragraph, privacy paragraph, name hint, `h2` per form, "How to Play" button | Title, label, input, one button, one text link. Privacy and 20-char hint become `aria-describedby` hidden text. |
| 19 | Result: "Round Result" `h1`, points-earned list, framed stamp, mode badge, three buttons | `h1` is the result word, big score, Blood line, two buttons. List visually hidden. |
| 20 | Board: note sentence, bottom Back button, dashed row rules | One-line dim note, back arrow in the screen head, flat row bands. |
| 21 | Timer scanlines, Blood hazard strip, dialog dither shadow | Removed. |
| 22 | Sticky header (costs 52 px on every screen) | Static header; hidden on Play under 48em because the top bar replaces it. |

---------------------------------------------------------------------------------------------------

## 2. Type: Jersey 10 only

### 2.1 Face and rules
- Latin UI: **Jersey 10** (SIL OFL), single weight 400, file `assets/fonts/jersey10-latin.woff2` (<= 20 KB, ADR 0005 s1).
  Subset keeps v1 range `U+0020-007E, U+00A0, U+00B7, U+00D7, U+2013, U+2019, U+2022, U+2026, U+2212`. Preload one file.
- Arabic: system stack, **Jersey 10 listed first** so Latin letters and the Western digits 0-9 inside Arabic strings stay pixel
  (v1 3.2 trick, unchanged). No second webfont.
- `font-synthesis: none` stays. **There is no bold, italic or uppercase anywhere**, in either language. Set
  `--lp-fw-bold: 400`, and `h1, h2, h3, strong, b, th, dt, summary { font-weight: 400; font-style: normal }`. (Arabic system fonts
  would otherwise render real bold at 700, so the rule applies in Arabic too.)
- `letter-spacing: 0`, `text-transform: none` everywhere. Delete `--lp-ls-caps`.
- Pixel-grid caution (assumption, unverified): if Jersey 10's design grid is 10 units per em, edges are crispest at multiples of 10 px.
  The scale below uses 20 / 40 / 60 where it can and accepts 2 px steps elsewhere. QUARTZ confirms unitsPerEm; if crisp sizes
  differ, PRISM may move any size by at most +/-2 px without asking, provided the section 3 arithmetic still holds.

### 2.2 Size scale (CSS px; breakpoints: base = 320 to 383, `min-width: 24em` = 384+ covers 390, `min-width: 48em` = 768+)

| Role | Token | 320 | 390 | 768+ | Line height | Notes |
|---|---|---|---|---|---|---|
| label (stat caption, sublines, helper, table header, hints) | `--lp-fs-label` | 18 | 18 | 20 | 1.1 | `--lp-text-dim` unless on accent |
| body (buttons, inputs, clue symbols, messages, links) | `--lp-fs-body` | 22 | 22 | 24 | 1.1 single line, 1.3 multi-line (`--lp-lh-body`) | inputs stay >= 16 so iOS never zooms |
| h2 (Help sections) | `--lp-fs-h2` | 28 | 28 | 32 | 1.1 | |
| h1 (Auth title, Result word, screen heads, Home name) | `--lp-fs-h1` | 36 | 40 | 48 | 1.1 | `text-wrap: balance` |
| dial digit | `--lp-fs-dial` | 40 | 48 | 56 | 1 | follows dial height: 40 at 48 px dial, 48 at 64 px, 56 at 72 px (>= 80em) |
| key digit | `--lp-fs-key` | 28 | 32 | 32 | 1 | 28 when key height is 44, 32 when 52 |
| timer, Classic (top bar) | `--lp-fs-timer` | 24 | 28 | 32 | 1 | |
| timer, Blood (top bar) | `--lp-fs-timer-blood` | 32 | 40 | 48 | 1 | |
| stat number (Home cells) | `--lp-fs-stat` | 28 | 32 | 36 | 1 | 6 characters must fit a 96 px cell: 28 px x ~12 = 72, see 3.2 |
| result score | `--lp-fs-score` | 56 | 64 | 80 | 1 | count-up, section 7 |
| code in dialog | `--lp-fs-code` | 40 | 48 | 48 | 1 | 6 digits, letter-spacing 0.3em allowed here only (digits are not shaped text) |

Line-height tokens: `--lp-lh-body: 1.3` (Arabic 1.7), `--lp-lh-tight: 1.1` (Arabic 1.5). Multi-line text appears only in Help, dialogs and toasts.
Controls use `min-block-size`, never fixed `block-size`, so Arabic's taller line boxes cannot clip.

**Arabic overrides** (`html[lang="ar"]`; system face reads larger than Jersey at the same px, so the v1 `1.125` scale is dropped):
label 16 / 16 / 18, body 18 / 18 / 20, h2 24 / 24 / 28, h1 32 / 36 / 40. Digits, dial, key, timer, score, stat tokens are Latin
digits in Jersey 10 and do not change. Delete `--lp-text-scale`.

### 2.3 Emphasis without bold, italic or caps
In order of preference:
1. **Size step** (h1 / h2 / stat / score are the only emphasis sizes; never a half-step).
2. **Colour role:** `--lp-text` primary, `--lp-text-dim` secondary, `--lp-accent-text` for exactly one live value per screen
   (Result score, last-30 timer, links). Never accent-text at label size on a `--lp-bg-2` surface.
3. **Container:** filled selected state (accent fill), own-row fill (`--lp-bg-2`) on the Board, a frame on a control.
4. **Icon prefix** (16 px sprite) for mode and meaning (drop = Blood points, trophy = total).
5. **Position:** top of the stack, or the first column.
Links: accent-text + 2 px underline (the only underline in the UI). Nothing else is underlined, tracked or capitalised.

### 2.4 Contrast re-check for type changes (hand computed; luminances from v1 2.2)
Thresholds stay 4.5 for text (I treat all Jersey text as small; its 1.8 px strokes at 18 px deserve more margin, so my house target for
dim text is >= 7.0 on bg-0 and bg-1). Flat page (no dither) only raises every v1 "dithered page" figure, so no pair regresses there.

**One token must change:** `--lp-text-dim` in **Classic light** `#444C6B` (L 0.0746) to **`#3A4160`** (L 0.0552).
Reason: v1 gives 6.26 on bg-0, under the 7.0 house target for 18 px pixel strokes.
New values: on bg-0 0.7794/0.1052 = **7.41**, on bg-1 0.9626/0.1052 = **9.15**, on bg-2 0.6527/0.1052 = **6.20** (>= 4.5, used only
for disabled and digit-count squares there). Hierarchy vs `--lp-text` (12.79 on bg-0) is still clear. All other token values stand.

| Pair (label/body size) | CD | CL | BD | BL | Need | Result |
|---|---|---|---|---|---|---|
| text-dim on bg-0 | 8.57 | 7.41 (new) | 9.40 | 7.66 | 4.5 (target 7) | pass |
| text-dim on bg-1 (stats, clue icons, none glyph) | 7.60 | 9.15 (new) | 8.76 | 9.55 | 4.5 | pass |
| text on bg-1 (clue digits, stat numbers) | 14.09 | 15.79 | 16.20 | 16.63 | 4.5 | pass |
| text on bg-2 (keys, dial digits, unselected option) | 11.85 | 10.71 | 14.48 | 10.76 | 4.5 | pass |
| on-accent on accent (Check, Classic, selected option, 22 px label AND 18 px subline) | 10.35 | 8.47 | 6.42 | 5.32 | 4.5 | pass (BL: script-check) |
| Blood button: text on blood bg-1 | | | 16.20 | 16.63 | 4.5 | pass |
| Blood button: accent-text subline on blood bg-1 | | | 5.98 | 7.24 | 4.5 | pass (BD: script-check) |
| accent-text on bg-0 (Result score, last-30 timer, links) | 10.35 | 6.36 | 6.42 | 5.82 | 4.5 | pass |
| accent-text on bg-1 (links in dialogs) | 9.18 | 7.85 | 5.98 | 7.24 | 4.5 | pass |
| Frame `--lp-line` vs page bg-0 (3:1, Blood button frame on a Classic page uses Blood line) | 6.42; Blood line on Classic dark 5.29 | 12.79; Blood ink on Classic light 13.6 | 5.69 | 13.35 | 3 | pass |
| Pips (filled/hollow), `none` glyph, kind icons, `--lp-text` / dim on bg-1 | 14.09 / 7.60 | 15.79 / 9.15 | 16.20 / 8.76 | 16.63 / 9.55 | 3 | pass |
| Timer segment fill `--lp-meter` vs field (graphic) | 10.35 | 3.83 | 6.42 | 3.44 | 3 | pass |
| Header icon glyph `--lp-text` on bg-0 (unframed) | 15.87 | 12.79 | 17.39 | 13.35 | 3 | pass |
| Danger confirm (22 px) on-danger on danger | 7.28 | 7.30 | 9.68 | 7.24 | 4.5 | pass |
| Board own row: `--lp-text` on bg-2 (v2 uses text, not accent-text, because BL accent-text on bg-2 is only 4.69) | 11.85 | 10.71 | 14.48 | 10.76 | 4.5 | pass |
| "You" mark: on-accent on accent | 10.35 | 8.47 | 6.42 | 5.32 | 4.5 | pass |
| Disabled controls (exempt, still readable): text-dim on bg-2 | 6.39 | 6.20 | 7.83 | 6.18 | n/a | pass |

Focus ring (v1 8) is unchanged; the unframed header buttons use `outline-offset: 0` plus the inner dark layer, see 6.3.

---------------------------------------------------------------------------------------------------

## 3. Layouts and px budgets

### 3.0 Global frame of every screen
- `--lp-gutter`: **12 px below 360 wide, 16 px from 360 up** (plus `env(safe-area-inset-*)` via `max()`). 12 at 320 is mandatory: it makes the inner width 296,
  which is what yields integer 48 px dials (3.4).
- Page background flat `--lp-bg-0`. Header static (not sticky), flat `--lp-bg-0`, no rule. Footer: one dim line "Made by OPH" (link), 44 px hit area, shown on Auth, Home, Board, Help only.
- Centered column for Auth, Home, Result: `inline-size: min(100%, 28rem)`. Board and Help: 36rem. Play: two columns from 48em.
- Height classes (the only vertical breakpoints):
  **compact** = `max-height: 43.75em` (700 px); **tall** = `min-height: 44em` (704 px and up); **short** = `max-height: 34em` (544 px, page scrolls, dock static).
- Spacing rhythm uses v1 tokens only: 4 (`--lp-space-1`), 8 (2), 16 (4), 24 (5), 32 (6). No new spacing token.
- Header: 52 px (box 44 + 4 + 4) on phones, 64 px from 48em. Controls are **unframed 44 px icon buttons** (6.3).

### 3.1 Auth (`data-screen="auth"`)
390x844, tall (sign-up view):
```
y    0 +--------------------------------------+
       | [lock32]                  [ع][s][?]  |  header 52   (no trophy, no avatar while signed out)
y   52 |                                      |  32 air
y   84 |             [ vault door 96 ]        |  96   (hidden when height <= 600)
y  180 |                                      |  16
y  196 |            Lock Puzzle               |  h1 44 (40 px)
y  240 |                                      |  24
y  264 |  Nickname                            |  label 20 + 4
y  288 |  [______________________________]    |  input box 48 -> outer 56
y  344 |                                      |  16 (error line collapses to 0 when empty)
y  360 |  [            Start              ]   |  primary box 56 -> outer 64 (+ ledge)
y  424 |                                      |  8
y  432 |          I have a code               |  text link, 44 hit area -> 52
y  484 |                                      |
        ...air (about 260)...
y  792 |            Made by OPH               |  footer 52
y  844 +--------------------------------------+
```
Budget: 52+32+96+16+44+24+24+56+16+64+8+52 = 484 content, +52 footer = 536 <= 844. Sign-in view adds label+input (24+56) and a 16 gap: 484+96 = 580 <= 844. One viewport: **pass**.
320x568, compact (vault hidden, sign-in is the tallest view): 52 + 16 + 44 + 16 + (24+56) + 16 + (24+56) + 16 + 64 + 8 + 52 + footer 52 = **488 <= 568**. With the keyboard open `interactive-widget=resizes-content` shrinks the layout viewport, the form scrolls (acceptable, forms are exempt from the no-scroll gate in ADR 0005 s5 only when a keyboard is up; SENTRY measures with it closed).
768 / 1280: same single 28rem column, vertically top-aligned with 48 px top air; vault door 96 above the title at >= 48em and height >= 700; no two-column layout (v1's two columns removed for calm).
Code dialog (after sign-up), 320x568: pad 16 + title 32 + 8 + code box (48 px digits, pad 12 -> 72) + 8 + Copy 52 + 8 + warning (2 lines of 18 px = 48) + 8 + checkbox row 52 + 8 + Continue 64 + pad 16 = **400 <= 568**, no inner scroll.

### 3.2 Home (`data-screen="home"`)
390x844 tall:
```
y    0 +--------------------------------------+
       | [lock32] [!]    [ع][s][?][T][u]      |  header 52   ([!] sync chip only when attention)
y   52 |                                      |  24
y   76 |  (u) Sara                            |  who row 56  (name 40 px, user sprite 32)
y  132 |                                      |  24
y  156 |  +----------+ +----------+ +--------+ |  stats band 92 (3 cells, 4 px apart, flat bg-1)
       |  | [k]Classic| [d]Blood | [t]Total | |    cell: pad 16, label 20, gap 4, number 36, pad 16
       |  |   980    |   260    |  1240   | |
y  248 |  +----------+ +----------+ +--------+ |
       |       (hero vault door 96, only when height >= 760, centered in the air)
       |                                      |  air = 312 (844 total, see arithmetic)
y  560 |  [ Rookie ][ Agent ][ Hacker ][Master]|  difficulty row, option box 52 -> outer 60
y  620 |                                      |  4 (cell gap; box-to-box 12)
y  624 |  [key] Classic                       |  primary, box 72 -> outer 80 (+ ledge)
       |        No timer                      |
y  704 |                                      |  4
y  708 |  [skull] Blood                       |  Blood-tokens button, outer 80
       |          3:00 clock, x2              |
y  788 |                                      |  4
y  792 |            Made by OPH               |  footer 52 (y 792-844)
```
Arithmetic (tall, 844): header 52 + 24 + who 56 + 24 + stats 92 = 248 upper group; lower group = difficulty 60 + 4 + Classic 80 + 4 + Blood 80 = 228; footer 52 + bottom gap 4. Air = 844 - 248 - 228 - 56 = **312 px**, absorbed by `justify-content: space-between` between the upper and lower groups (the play controls sit in the thumb zone). **One viewport, no scroll: pass.**
390x664 (real phone, compact): the lower group uses compact sizes (Classic/Blood outer 72): 52+16+44+16+84+24+(60+4+72+4+72)+8+52 = **508 <= 664**.

320x568 compact (gutter 12, inner 296), the tight case:
```
y    0 | [lock][!]      [ع][s][?][T][u]       |  52   (items 32+32+5x44 = 284 + gaps 0 = fits 296 + 8 slack)
y   52 |                                      |  16
y   68 |  (u) Sara                            |  44 (name 36 px)
y  112 |                                      |  16
y  128 |  [Classic][ Blood ][ Total ]         |  84 (cell width (296-8)/3 = 96)
y  212 |                                      |  24
y  236 |  [Rookie][Agent][Hacker][Master]     |  60 (option box (296-3x4-4x8)/4 = 63 wide)
y  296 |                                      |  4
y  300 |  [key] Classic / No timer            |  72
y  372 |                                      |  4
y  376 |  [skull] Blood / 3:00 clock, x2      |  72
y  448 |  (air 8..60)                         |
y  508 |            Made by OPH               |  52 (y 508-560)   +8 bottom
```
Arithmetic: 52+16+44+16+84+24+60+4+72+4+72+52 = **500 <= 568** (68 px of slack; ADR gate is <= 1.25 screens = 710, so pass with 1.0 screen).
Width checks at 320 (estimates, see 0): stat number "12,450" at 28 px ~ 6 x 12 = 72 <= 96 - 2x8 padding = 80 (8 px slack). If a number exceeds 6 characters CIRCUIT formats with `Intl.NumberFormat('en', {notation:'compact'})` ("1.2M"). Option label "Hacker" at 22 px ~ 6 x 8 = 48 <= 63 - 8 = 55 (7 px slack); Arabic names are <= 5 letters at 18 px (~45 px).
Difficulty option content (box 52 high): padding 8 / name 24 / gap 4 / digit-count squares 8 / padding 8. The digit-count glyph is N solid 8x8 squares 4 px apart (3 digits = 32 px wide, 5 = 52 px; fits 55). Selected: accent fill, name `--lp-on-accent`, squares `--lp-on-accent`; unselected: bg-2 fill, squares `--lp-text-dim`. Selected is NOT colour-only: squares of the selected option are `--lp-on-accent` on a filled accent while unselected are dim on bg-2, plus the 1-unit frame stays `--lp-line` (the v1 corner check is removed).
768 / 1280: single centered 28rem column, same stack, tall sizes; 80 px air between upper and lower group at 768x1024 grows with height (hero door shown).
Blood stat cell uses `data-mode="blood"` locally (drop sprite, Blood tokens, `--lp-accent-text` number). ADR 0003 labelling: the cell reads "Blood" with the drop icon and a visually hidden "Blood points, from Blood mode".

### 3.3 Play (`data-screen="play"`): the screen that must be perfect
Structure on phones (`< 48em`, not short): a **fixed-viewport grid**, so the page never scrolls and only the clue area can:
```
[data-screen="play"] {
  min-block-size: 100dvh; display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;     /* top bar / clue area / dock */
}
html:has([data-screen="play"]:not([hidden])) body { block-size: 100dvh; overflow: clip; }   /* not in the short class */
```
The global `header` is `display: none` on Play below 48em (the top bar replaces it). Footer hidden on Play.

**Dock** (flat `--lp-bg-1` band, full-bleed, no frame, no rule): dials row, keypad 2 rows, actions row. Keypad and actions share one 5-column grid, so keys sit under dials and Check spans columns 2-4.

| Metric | Compact (<= 700 high) | Tall (>= 704 high) |
|---|---|---|
| dial box w x h | 48 x 48 at < 384 wide, 56 x 48 at >= 384 | 48 x 64 at < 384, 56 x 64 at >= 384 (64 x 72 at >= 80em) |
| dial / key cell (box + 8 frame room) | 56 w (< 384) or 64 w (>= 384) | same |
| dial cell height | 56 | 72 |
| key box h | 44 | 52 |
| key cell height | 52 | 60 |
| actions box h | 44 | 52 |
| row gap (cell to cell; box-to-box = gap + 8) | 4 (12) | 8 (16) |
| dock padding-block | 4 / 4 + safe-area | 8 / 8 + safe-area |
| **Dock height** | 4 + 56 + 4 + 52 + 4 + 52 + 4 + 52 + 4 = **232** | 8 + 72 + 8 + 60 + 8 + 60 + 8 + 60 + 8 = **292** |

Actions row (box height as keys): `[backspace][ Check ........ ][bulb | skip]` = columns 1 / 2-4 / 5. In Blood the bulb is replaced by skip in column 5 (same slot).
Dial row width check at 320: 5 cells x 56 + 4 x 4 gap = **296 = inner width** (zero slack by design: fixed-width integer cells; the row is centered and never wraps; gap falls back to 0 if `--lp-gutter` shrinks under safe-area insets, boxes stay 48). At 360: 296 in 328 (32 slack). At 390: 5 x 64 + 16 = 336 in 358 (22 slack). 3 or 4 dials: same cell size, row centered via `justify-content: center`; the keypad grid is always 5 columns.

**Top bar** (52 px, flat, no frame; Blood adds an 8 px bar strip below it: 60 px):
```
390:  [<-] [lock32] Rookie              [clk]0:42  [x]1  [snd]
320:  [<-] [lock32]                    [clk]0:42  [x]1  [snd]       (difficulty name visually hidden under 360)
```
Width at 390 (inner 358): quit 44 + 4 + lock 32 + 8 + name ~46 + (flex) + timer group (clock 16 + 4 + 4 characters x 13 = ~72) + 8 + wrong group (x 16 + 4 + 12 = 32) + 8 + sound 44 = 298 (60 slack). At 320 (inner 296, name hidden): 44 + 4 + 32 + 72 + 8 + 32 + 8 + 44 = **244 (52 slack)**. Under 360 the name is `visually-hidden`; its text stays in the lock host's description. Blood timer at 32 px: ~4 x 15 = 60 + 20 = 80 (still fits at 320: 252).
The lock (`data-lock`, 16x16 art at **2 px per art pixel = 32 px**; integer multiple of a device pixel, so crisp) hops/shakes (section 7). The skull sprite replaces the difficulty name's leading space in Blood (16 px, `--lp-accent-text`).
In Blood only: `[data-timer-bar]` is an 8 px strip (18 segments x 12 = 216 px, centered) directly under the bar, **no frame** (it is graphic; segments 3.44:1 minimum vs the field, v1 6.10).

**Clue area** (the only scroller; `overflow-y: auto; overscroll-behavior: contain; scroll-padding-block: 8px; tabindex="0"` so keyboard users can scroll it):
- Rows: flat `--lp-bg-1` bands, full inner width, **no frame**. Row box height **48 (tall) or 40 (compact)**, gap **8 / 4**, so pitch 56 / 44. Padding-inline 12.
- Single column at all phone widths. I rejected the 2-column grid for phones: a feedback row is digits 5 x 20 = 100 + 16 + pips up to 5 x 12 + 4 x 4 = 76 -> 192 + 24 padding = **216 px minimum**, and two of those need 440 (> 358). A 2-column grid would force pips to a second line (row height 64, pitch 72) and be taller than one column of single-line rows. One column also keeps the newest-first reading order unambiguous.
- Where width exists the list switches to two columns by container query: `@container (min-width: 28rem)` (448 px) -> `grid-template-columns: repeat(2, minmax(0, 1fr))` (applies at >= 1280, where the clue column is ~544 px).

Clue count arithmetic (area height = viewport - top bar - dock; clue list top padding 8 compact 4):

| Viewport | Top bar | Dock | Clue area | Rows pitch | 5 clues | 8 clues (Master) |
|---|---|---|---|---|---|---|
| 390x844 tall, Classic | 52 | 292 | **500** (466 with a real 34 px home-indicator inset) | 56 | 8 + 280 = 288 fits | 8 + 448 = 456 **fits, no scroll** (456 <= 466) |
| 390x844 Blood | 60 | 292 | 492 (458) | 56 | fits | 456 <= 458 fits (2 px slack; script-check, else inner scroll) |
| 390x664 compact (real Safari viewport) | 52 | 232 | **380** | 44 | 4 + 220 = 224 fits | 4 + 352 = 356 **fits** |
| 360x640 (typical Android, ~590 inner) compact | 52 | 232 | **306** | 44 | fits | 356 > 306: scrolls inside the area by 50 px |
| 320x568 compact, Classic | 52 | 232 | **284** | 44 | 224 fits | 356 > 284: scrolls inside the area by 72 px |
| 320x568 Blood | 60 | 232 | **276** | 44 | 224 fits | scrolls by 80 px |

**320x568 gate (dials + keypad + >= 2 clues): 6 rows (264 px) are fully visible in Classic, 5 in Blood.** Pass with 4 extra rows.
**8 clues decision: scroll inside the clue area with the dock fixed, never page scroll.** Reasons: the dials and keys are the thumb zone and must not leave the screen while the player reads a clue; page scroll would move them away (or need a sticky dock that then hides the last clues, WCAG 2.4.11); the clue area is the only content that varies in length; nothing in ADR 0005 s5 is exceeded (0 screens of page scroll, the gate allows 1.2). The row cut off at the bottom edge is the scroll cue (no gradient fade; v1 forbids gradients). `scroll-padding-block` on the scroller keeps a focused element clear of the edges; the scroller is `tabindex="0"` with `role="region"` and an accessible name from the hidden "Clues" `h2`.
Short viewports (< 544 high, or 200% zoom on small phones): the fixed grid is dropped, the dock becomes static and the page scrolls (v1 rule, unchanged).

**Toast over the clue area:** `p[data-live="status"]` is positioned `absolute` at the bottom of the clue area, inset 8 px, `pointer-events: none`, `--lp-inv-bg` / `--lp-inv-text` (15.87 / 15.79 / 17.39 / 16.63), body size, single line (max 8 words), no frame. CIRCUIT clears it after 3000 ms (solved and time-up never rely on it: they move to Result). It never covers the dock or a control.

**Landscape phones** (`orientation: landscape` and `max-height: 500px`): two columns: clue area left (flex), dock right (max 22rem, compact sizes, 232 px) both under the 52 px top bar: 52 + 232 = 284 <= 360 (iPhone SE landscape 667x375), clue area 375 - 52 = 323.
**768 and 1280**: header (64) stays, top bar (52, `quit` + lock + difficulty + timer + wrong; sound button hidden because the header has one), then two columns: clue area `minmax(0,1fr)` and dock `24rem` (>= 80em: `28rem`). The dock is a flat `--lp-bg-1` panel with 16 px padding, sticky under the top bar. 1280x720: 64 + 52 + 292 = 408 <= 720; both columns fit without page scroll. Dials 56 x 64 (64 x 72 at >= 80em).

Blood vs Classic differences only: tokens (`data-mode="blood"`), top bar timer size and bar strip, skip instead of hint, wrong count hidden (Blood has no cap and penalties show in the toast).

### 3.4 Result (`data-screen="result"`)
390x844 (Classic success, 28rem column):
```
y    0 | header 52                                   |
y   52 |                                             |  24
y   76 |                [lock 64]                    |  64   (16x16 at 4 px/px, lamp ok-green)
y  140 |                                             |  8
y  148 |                 Unlocked                    |  h1 44 (the result word, 40 px)
y  192 |                                             |  16
y  208 |                  +150                       |  score 72 (64 px, accent-text, count-up)
y  280 |                  points                     |  label 24 (dim)
y  304 |       [drop] Blood points (from Blood mode) |  only after Blood runs: 24
y  332 |               [trophy] New best!            |  only on a personal best: 24
y  360 |                                             |  air, then buttons pinned to the bottom
y  700 |  [ Home ]  [        Next         ]          |  box 56 -> outer 64 (1fr / 2fr), bottom pad 16 + safe
y  844 +---------------------------------------------+
```
Budget: 52+24+64+8+44+16+72+24+24+24+32 (air before buttons minimum) + 64 + 16 = **464 <= 844**, one viewport. 320x568: same stack, 36 px h1, 56 px score (64 -> 56: -8): 456 <= 568 (112 slack, Arabic +30). Footer hidden on Result (buttons own the bottom).
Variants: Blood end: h1 "Time's up" (or "Run ended"), score = Blood points of the run, label line is the explicit `Blood points (from Blood mode)` with the drop (ADR 0005 s4), plus one dim line "Solved {count}". Classic quit goes Home with no Result. If a code reveal is needed (failure) one dim line "Code 184". The points-earned list stays in the DOM, visually hidden. Colours: Blood run uses `data-mode="blood"` page tokens, lock sprite is the closed lock with the red lamp; Classic success shows the open lock and green lamp.

### 3.5 Board (`data-screen="board"`)
390x844 (scrolling allowed, one screen shown here):
```
y   52 | [<-]  Leaderboard                  |  screen head 52: back arrow icon button + h1 (28 px at this screen)
y  104 |  [ All-time ][  Blood  ]           |  tabs: box 48 -> outer 56, 2 columns
y  160 |  Scores are self-reported.         |  label 20, dim
y  188 |  #   Player                 Points |  th label row 28 (dim)
y  216 |  1   Zed                    2,410  |  row band 44 (flat bg-1), 4 px gap -> pitch 48
y  264 |  2   Maya                   2,180  |
       |  ... rows ...
       |  14  Sara [You]               980  |  own row: bg-2 fill, text --lp-text, 4 px accent start bar, "You" chip
y  792 |  Made by OPH                        |
```
Content to 10 rows: 52+52+56+4+20+8+28+(10 x 48) = 700 <= 844. Columns: rank 40 (3 digits "100" at 22 px ~ 27), points 80, player `minmax(0,1fr)` wraps with `overflow-wrap: anywhere` so a 20-char name never widens the page at 320 (player col = 296 - 40 - 80 - 2x8 row padding = 160 px).
States (one line each, body size, centered, no illustration): loading "Loading...", empty "No scores yet.", offline text + a `Retry` secondary button. 768/1280: 36rem centered column. The Blood tab uses `data-mode="blood"` locally.

### 3.6 Help (`data-screen="help"`), may scroll (<= 2 screens)
Outline (390 wide, all icons and one-liners first):
```
[<-]  How to play                                    screen head 52
Goal                                                 h2 28, 32 air above
  [d][d][d]  Find the hidden code.                   dial-row glyph + one line
             All clues are true.
Clues
  [#][#][ ]  Right digit, right place   <-- symbol is the REAL clue glyph, drawn exactly as in play
  [#][ ][ ]  Right digit, wrong place
  [none]     No digit is right
  [sum]= 12  Digits add up
  [par]2nd: even   Digit is even or odd
  [cmp]1st > 2nd   One digit is bigger
  [cnt]even: 2     How many digits are even
  Count from the left. Harder levels add more clue types.
Points
  [clock] Faster solves score more.   [x] -8% per wrong guess.   [bulb] Hint: half points.
Blood  (skull, blood tokens)
  3:00 clock . x2 per solve . wrong -5 s . skip -10 s . no hints . harder each solve
Your code
  Your 6-digit code can't be recovered.
> Example                         <details> collapsed: 4 clue rows + the solution paragraph (existing text)
Made by OPH
```
Rows: legend rows are 48 px (symbol column 120 px wide, text column flexible, 16 px gap). From 48em the legend is two columns. Height estimate: head 52 + goal 120 + clues (28+8 head + 7x56 + 48) 476 + points 200 + blood 220 + code 90 + details 52 + footer 52 = **~1,260 px = 1.5 screens at 844, 2.2 at 568**: over 2 screens at 568 is acceptable only because Help is exempt from the page-scroll gates except "<= 2 screens"; to meet it at 320x568 the Blood list collapses to a 2-column grid of 6 short rows (saves ~100 px) and the Points section uses 3 rows: target <= 1,130 px (1.99 screens). SENTRY measures.

---------------------------------------------------------------------------------------------------

## 4. Copy (English; CIRCUIT writes Arabic from the intent notes)

Rules: <= 8 words per sentence, labels 1-2 words, no em dashes, sentence case, numbers from `js/config.js` via placeholders as today.
Visibility legend: **V** visible, **H** visually hidden only (kept for AT; `class="visually-hidden"`), **D** removed from the DOM (key may stay unused until ATLAS prunes).
Icon-only buttons keep their text in a visually hidden `<span data-i18n=...>` (no `aria-label` plumbing needed).

### 4.1 Header and chrome
| String | Key | Status | Vis |
|---|---|---|---|
| Skip to content | `chrome.skip` | value changes | V on focus |
| Lock Puzzle (wordmark) | `brand.name` | same | V from 30em, else H |
| ع (shown on the English UI; `EN` on the Arabic UI) | `chrome.lang.toggle` | value changes | V |
| العربية / English (accessible name of the lang button, `lang` attr = target) | `chrome.lang.name` | **new** | H |
| Sound | `chrome.mute` | same | H (icon only) |
| Help | `chrome.help` | **new** | H (icon only) |
| Leaderboard | `chrome.board` | **new** | H (icon only) |
| Back | `chrome.back` | **new** (replaces `board.back` / `help.back`) | H (icon only) |
| Account | `chrome.account.label` | value changes ('Account:' to 'Account') | H |
| Log out | `chrome.account.logout` | value changes | V (menu) |
| Save status: | `chrome.sync.label` | same | H |
| Offline | `status.offline` | same | H (chip is icon only) |
| Device only | `status.local` | value changes ('On this device') | H |
| Synced / Saving... | `status.synced`, `status.saving` | same, **chip not shown** for these states | n/a |
| Offline. Saved on this device. | `status.say.offline` | value changes | V toast, one time per change |
| Back online. Saved. | `status.say.synced` | value changes | V toast |

Arabic intent: lang button shows `EN`; sound/help/board are plain nouns; "Device only" = "على هذا الجهاز فقط".

### 4.2 Auth
| String | Key | Status | Vis |
|---|---|---|---|
| Lock Puzzle | `auth.title` | value changes | V (`h1`) |
| Nickname | `auth.name.label` | value changes | V |
| Shown on the leaderboard. Up to 20 characters. | `auth.privacy` | value changes (merged with `auth.name.hint`) | H (`aria-describedby`) |
| Start | `auth.signup.submit` | value changes | V (primary) |
| I have a code | `auth.signup.toSignin` | value changes | V (link) |
| New player | `auth.signup.title` | value changes | H (form name) |
| Sign in | `auth.signin.title`, `auth.signin.submit` | value changes | H (name) / V (primary) |
| Code | `auth.code.label` | value changes | V |
| Given when you started. It can't be recovered. | `auth.code.hint` | value changes | H |
| New player | `auth.signin.toSignup` | value changes | V (link) |
| Checking... / Creating... | `auth.checking`, `auth.creating` | value changes | V (button busy label) |
| (intro paragraph, name-hint paragraph, `auth.help` button) | `auth.intro`, `auth.name.hint`, `auth.help` | unused | D |
Errors (V, one line next to the `x` sprite): `auth.err.name.empty` Enter a nickname. | `auth.err.name.too_long` Max {max} characters. | `auth.err.name.control_chars` Use letters and numbers. | `auth.err.name.invisible` Use letters or numbers. | `auth.err.code.format` Enter all 6 digits. | `auth.err.invalid` Name and code don't match. | `auth.err.offline` You're offline. Try again. | `auth.err.denied` Sign-in is unavailable. Try later. | `auth.err.quota` Server busy. Wait a minute. | `auth.err.unsupported` Use an up-to-date browser over https. | `auth.err.error` Something went wrong. Try again. | `auth.err.newer` Newer save found. Reload the page.
Code dialog: Your code (`dialog.code.title`, V) | Write it down. You need it to sign in elsewhere. (`dialog.code.desc`, H) | Copy (`dialog.code.copy`) | It can't be recovered. Write it down. (`dialog.code.warning`, V) | I saved it (`dialog.code.ack`) | Tick the box to continue. (`dialog.code.ackHint`, H) | Continue (`dialog.code.continue`) | Copied (`dialog.code.copied`) | Copy failed. Select it by hand. (`dialog.code.copyFail`) | Saved on this device for now. (`dialog.code.localNotice`).
Arabic intent: "ابدأ", "لدي رمز", "اللقب" (nickname), "الرمز"; warnings short and imperative ("لا يمكن استرجاعه. دوّنه.").

### 4.3 Home
| String | Key | Status | Vis |
|---|---|---|---|
| Home | `home.title` | value changes | H (`h1`) |
| Signed in as | `home.signedInAs` | same | H (before the name) |
| Sara (the name) | `[data-out="name"]` | hook | V, 40 px |
| Your points | `home.points.title` | same | H |
| Classic | `home.points.classic` | value changes | V (cell label) |
| Blood | `home.points.blood` | value changes | V (cell label, drop icon) |
| Blood points, from Blood mode | `home.points.blood.sr` | **new** | H (ADR 0003 labelling kept for AT) |
| Total | `home.points.total` | value changes | V |
| Difficulty (Classic mode) | `home.difficulty.legend` | same | H |
| Rookie / Agent / Hacker / Master | `diff.rookie` ... | same | V |
| 3 digits | `diff.digits` | same | H (the squares are the visible form) |
| Classic | `home.classic.button` | value changes | V |
| No timer | `home.classic.desc` | value changes | V (subline) |
| Faster solves, fewer wrong guesses and no hint score more. | `home.classic.sr` | **new** | H (`aria-describedby`) |
| Blood | `home.blood.button` | value changes | V |
| {duration} clock, ×{mult} | `home.blood.desc` | value changes | V (subline) |
| {duration} countdown, ×{mult} points, wrong guess −{wrongPen} s, skip −{skipPen} s, no hints. Gets harder as you solve. | `home.blood.sr` | **new** | H |
| Blood run active in another tab. | `home.blood.otherTab` | value changes | V toast |
| (difficulty note, Recent rounds title/empty/lines, `home.play.title` as a visible heading, `home.more.*`) | `home.difficulty.note`, `home.history.*`, `home.more.*` | unused | D (`home.play.title` becomes H) |

### 4.4 Play
| String | Key | Status | Vis |
|---|---|---|---|
| Crack the lock | `play.title` | value changes (case) | H (`h1`) |
| Rookie (name only in the top bar) | `diff.*` | same | V >= 360, H below |
| Rookie · 3 digits, all different | `play.diffline.distinct` / `.repeat` | same | H (description of the top bar) |
| Time | `play.timer` | same | H (timer name) |
| Wrong guesses | `play.attempts` | same | H (before the count) |
| Clues / Your guess | `play.clues.title`, `play.guess.title` | value changes (case) | H |
| Tap a dial, then a digit. Keyboard: digits, arrows, Backspace, Enter. | `play.guess.help` | value changes | H |
| Clear | `play.clear` | same | H (backspace icon) |
| Check | `play.check` | same | V |
| Skip | `play.skip` | value changes | H (skip icon, Blood) |
| Hint, half points | `play.hint` | value changes | H (bulb icon; the cost stays in the name) |
| Quit round | `play.quit` | value changes | H (back-arrow icon) |
| Wrong guesses so far / Keypad | `play.attempts.list`, `play.keypad.label` | same | H |
| (Puzzle id label, `play.puzzle`) | `play.puzzle` | unused | D |
Messages (toast / live region, V, auto-clear 3 s):
| Event | String | Key |
|---|---|---|
| Incomplete | Fill every dial. | `play.msg.incomplete` |
| Repeated guess | Already tried. No penalty. | `play.msg.dup` |
| Repeated digit (distinct levels) | Each digit is different. Not counted. | `play.msg.repeat` |
| Wrong (Classic) | Wrong guess: {count} | `play.msg.wrong` |
| Wrong (Blood) | Wrong −{seconds} s | `play.msg.wrongBlood` |
| Skip (Blood) | Skipped −{seconds} s | `play.msg.skipBlood` |
| Hint used | Hint: dial {pos} is {digit}. Half points. | `play.msg.hint` (`{hintPct}` stays available for the SR copy) |
| Solved (Classic) | Unlocked! +{points} | `play.msg.solved` |
| Solved (Blood) | +{points} Blood points (from Blood mode) | `play.msg.solvedBlood` |
| Blood start | Wrong −{wrongPen} s · Skip −{skipPen} s | `play.msg.bloodStart` |
| Blood end | Time's up. | `play.msg.timeUp` |
| Timer SR (unchanged) | {time} left / Time is up | `play.timer.sr`, `play.timer.sr.zero` |
Dial strings (`play.dial.*`) are unchanged and stay H (aria-labels).
Arabic intent: messages are fragments, not sentences ("خانة 2 هي 7. نصف النقاط."); keep "−5 ث" with a Western digit and a LTR isolate; Blood wording keeps "نقاط الدم (من وضع الدم)" per ADR 0003.

### 4.5 Result, Board
| String | Key | Status | Vis |
|---|---|---|---|
| Unlocked | `result.msg.classic` | value changes | V (`h1`, `[data-out="msg"]`) |
| Time's up | `result.msg.blood` | value changes | V (`h1`) |
| Run ended | `result.msg.bloodQuit` | value changes | V (`h1`) |
| New best! | `result.msg.pb` | value changes | V (trophy icon) |
| Round result | `result.title` | same | H (document title only) |
| points | `result.score` | value changes | V (label under the score) |
| Blood points (from Blood mode) | `result.bloodpoints` | same | V (drop icon; **explicit wording kept**, ADR 0005 s4) |
| Solved {count} | `result.solved` | **new** | V (Blood end) |
| Code {code} | `result.line.code` | value changes | V (failure only) |
| Points earned + all `result.line.*` lines | `result.lines.title`, `result.line.*` | same | H (list stays for AT) |
| Next / Again / Home | `result.nextClassic`, `result.retryBlood`, `result.home` | value changes | V |
| Leaderboard | `board.title` | same | V (`h1`) |
| Scores are self-reported. | `board.note` | value changes | V (label size) |
| All-time / Blood | `board.tab.all`, `board.tab.blood` | same | V |
| # (visible) with "Rank" hidden | `board.col.rank.short` **new**, `board.col.rank` | | V / H |
| Player / Points | `board.col.player`, `board.col.points` | value changes ('Points') | V |
| You | `board.you` | same | V |
| Loading... / No scores yet. / Offline. Try again later. / Offline. Showing last list. / Leaderboard unavailable. / Couldn't load. Try again. | `board.loading`, `board.empty`, `board.offline`, `board.offlineStale`, `board.denied`, `board.error` | value changes | V |
| (all captions) | `board.caption.*`, `board.tabs.label` | same | H |
Arabic intent: result word is one word ("فُتح" / "انتهى الوقت"), score label "نقطة"; leaderboard columns "#", "اللاعب", "النقاط".

### 4.6 Clue symbols (visual form of each clue; the full sentence `clue.*` stays H)
| Kind | EN visual | Keys (all **new**) |
|---|---|---|
| sum | [sum icon] `= 12` | `clue.sym.sum` = '= {value}' |
| parity | [parity icon] `2nd: even` / `2nd: odd` | `clue.sym.parity.even` = '{pos}: even', `clue.sym.parity.odd` = '{pos}: odd' |
| compare | [compare icon] `1st > 2nd` / `1st < 2nd` | `clue.sym.compare.gt` = '{a} > {b}', `clue.sym.compare.lt` = '{a} < {b}' |
| even-count | [even-count icon] `even: 2` | `clue.sym.evenCount` = 'even: {count}' |
| positions | `1st 2nd 3rd 4th 5th 6th 7th 8th 9th 10th` | `clue.sym.pos.1` ... `clue.sym.pos.10` |
Arabic intent: positions are plain Western digits (`1`, `2` ...), `even` = "زوجي", `odd` = "فردي", operators stay ASCII `>` `<` `=` (see 5.3 for direction).

### 4.7 Help outline and strings
All Help strings may exceed the primary-screen budget in the details block only. One-liners:
- Title `help.title` "How to play" (V, `h1`). Back = `chrome.back`.
- Goal `help.goal.title` "Goal"; `help.goal.body` "Find the hidden code. All clues are true."; `help.goal.repeat` **new** "Digits are all different, except in {repeatName}."
- Clues `help.clues.title` "Clues". Legend (all **new**): `help.legend.right` "Right digit, right place" | `help.legend.wrong` "Right digit, wrong place" | `help.legend.none` "No digit is right" | `help.legend.sum` "Digits add up" | `help.legend.parity` "Digit is even or odd" | `help.legend.compare` "One digit is bigger" | `help.legend.evencount` "How many digits are even". `help.clues.positions` "Count from the left." | `help.clues.byDifficulty` "Harder levels add more clue types."
- Points `help.scoring.title` "Points"; `help.scoring.body` "Base points × speed × accuracy × hint."; `help.scoring.speed` "Speed: ×{speedMax} falling to ×{speedFloor}."; `help.scoring.clock` **new** "The clock keeps running if you switch tabs."; `help.scoring.accuracy` "Each wrong guess: −{accStep}%, down to {accFloor}%."; `help.scoring.hint` "Hint: points drop to {hintPct}%."; `help.scoring.totals` "Classic points and Blood points (from Blood mode) stay separate."
- Blood `help.blood.title` "Blood"; `help.blood.clock` "Beat the {duration} clock."; `help.blood.points` "×{mult} points per solve."; `help.blood.wrong` "Wrong guess: −{wrongPen} s."; `help.blood.skip` "Skip: −{skipPen} s."; `help.blood.hints` "No hints."; `help.blood.ramp` "Puzzles get harder."; `help.blood.forfeit` "At zero the open puzzle is lost. Earned points stay."
- Your code `help.code.title` **new** "Your code"; `help.code.body` **new** "Your 6-digit code can't be recovered."
- Example (collapsed `<details>`): summary `help.example.title` "Example"; inside: the four clue rows drawn with the real clue-row component (their `help.example.clue1..4` sentences become H text), `help.example.solution` (existing text, unchanged), then `help.scoring.example` (existing). `help.example.intro` stays.
- Removed from DOM: `help.clues.*.term`, `help.clues.*.body` (long definitions; the legend replaces them).
Arabic intent: Help is the only place longer Arabic sentences are allowed; keep each legend line under 5 words.

### 4.8 Dialogs
Logout: `dialog.logout.title` "Log out?" | `.desc` "Sign back in with your name and code." | `.cancel` "Stay" | `.confirm` "Log out" | `.pendingTitle` "Unsynced changes" | `.pendingDesc` "Logging out loses them." | `.pendingConfirm` "Log out anyway".
Quit: `dialog.quit.title` "Quit round?" | `.desc` "This puzzle won't score. Earned points stay." | `.cancel` "Keep playing" | `.confirm` "Quit".
Dialogs: bg-1 fill, no frame, one 8 px `--lp-ledge` lip on the bottom edge, buttons in a column on phones (cancel first and focused, v1 6.9).

---------------------------------------------------------------------------------------------------

## 5. Clue card spec

### 5.1 Row anatomy (all kinds)
`li[data-kind]`: flat `--lp-bg-1` band, no frame, no start bar, no index. Padding-inline 12, height 48 (tall) / 40 (compact), `display: flex; align-items: center; gap: 12px`, `direction: ltr; unicode-bidi: isolate` (guess digits and symbols are always LTR; the only RTL text in a row is the visually hidden sentence).
Children, in order, **flat** (no wrapper elements, same constraint as v1 CSS):
- feedback: `.digit` x N, then pips (or the `none` glyph), then `.clue-text` (H).
- sum / parity / compare / even-count: a 16 px kind icon (`--lp-text-dim`), a `.sym` text span (body size, `--lp-text`), `.clue-text` (H).
Digits and pips and `.sym` carry `aria-hidden="true"`; `.clue-text` carries the sentence (`clue.*`), so a screen reader hears one sentence per clue.

### 5.2 Feedback clue
- Digits: `.digit` = 20 px wide cell, body-size Jersey digit, `--lp-text`, no box, no frame, centered (`inline-size: 20px; text-align: center`). 5 digits = 100 px.
- Pips follow after a 16 px gap, **right-place pips first, wrong-place pips second**. Count = right + wrong (not the guess length).
  - **filled = right digit, right place:** 12 x 12 px (3 units) solid `--lp-text`.
  - **hollow = right digit, wrong place:** 12 x 12 px, `border: var(--lp-px) solid var(--lp-text)` (hole 4 x 4), transparent centre. 3x3 art maps (CSS-drawn, no sprite):
    ```
    filled   hollow
    111      111
    111      1.1
    111      111
    ```
  - Gap between pips 4 px; 5 pips = 5 x 12 + 4 x 4 = 76 px. Shape carries the meaning; colour is not used (both `--lp-text`), so colour-blind and forced-colors users lose nothing. (v1's green/blue pips are dropped: two extra hues were noise, and the hollow/filled distinction already passes 3:1 = 14.09 to 16.63.)
  - **Zero match = the `none` glyph** (new 8x8 sprite, section 8) at 16 px in `--lp-text-dim`, in the pips position. Never an empty row.
- Width at 320 (inner 296, row padding 24): 100 + 16 + 76 = 192 <= 272, 80 px slack. 3 digits: 60 + 16 + 36 + ... always fits.
- Colour of a "fresh" clue: none. The entrance animation (7.5) marks new rows.

### 5.3 Symbol forms and RTL
| Kind | Visual (EN) | Notes |
|---|---|---|
| sum | [sum] `= 12` | `.sym` = `clue.sym.sum` |
| parity | [parity] `2nd: even` | position ordinal + colon + word |
| compare | [compare] `1st > 2nd` | the relation is the ASCII character `>` or `<` from the string, not the sprite; the leading compare icon is a fixed kind marker (it is **not** mirrored per relation in v2) |
| even-count | [even-count] `even: 2` | |
- Every `.sym` is `direction: ltr; unicode-bidi: isolate` (also in Arabic), so `>` is never mirrored by the bidi algorithm and the digits stay Western LTR. In Arabic the words are the only translated pieces ("2: زوجي", "1 > 2"): the whole symbol reads left to right, as the dials do. The row itself is `direction: ltr` in both languages so digit i sits above dial i.
- The kind icon sits on the start side in LTR and Arabic alike (the row is LTR); it does not flip.
- Icons are the existing v1 sprites `sum`, `parity`, `compare`, `even-count` at 16 px (2 px per art pixel). Reuse; no redraw.

### 5.4 Help legend
Help draws the exact same markup (rows of digits + pips, icon + `.sym`) so the legend IS the component; no second drawing.

---------------------------------------------------------------------------------------------------

## 6. Header spec

### 6.1 Contents and order (logical order; mirrored in RTL by flex, never by `order` hacks)
`[brand] [sync chip: only when attention] ........ [lang] [sound] [help ?] [trophy] [account avatar]`

| Item | Element | Visible form | Accessible name | Target | When |
|---|---|---|---|---|---|
| Brand | `p.lp-brand` | lock sprite 32 px (16x16 at 2 px), wordmark Jersey 22 px from 30em | "Lock Puzzle" | not interactive | always |
| Sync chip | `p.lp-chip[data-status]` | icon-only `alert` sprite 32 px (4 px per art pixel): `--lp-bad` offline, `--lp-info` device-only; no frame, no label | "Save status: Offline" (visually hidden text in `[data-out="status"]`) | not interactive | `hidden` for synced and saving; shown for `offline` and `local`; on change also one toast (`status.say.*`) |
| Language | `button[data-action="lang"]` | text `ع` (on EN) or `EN` (on AR), body size, centered | `chrome.lang.name`, with `lang` = target language | 44 x 44 | always |
| Sound | `button[data-action="mute"]` | `speaker-on` / `speaker-off` 32 px | "Sound", `aria-pressed="true"` = sound is ON | 44 x 44 | always |
| Help | `button[data-action="show-help"]` | new `help` (`?`) sprite 32 px | "Help" | 44 x 44 | always |
| Leaderboard | `button[data-action="show-board"]` | `trophy` 32 px | "Leaderboard" | 44 x 44 | signed in only (`hidden` while signed out) |
| Account | `details[data-account] > summary` | `user` sprite 32 px | "Account: <name>" | 44 x 44 | signed in only |

### 6.2 Widths and heights
- Header row 52 (box 44 + 4 + 4); 64 from 48em. Sprites 32 px centered in the 44 px box (6 px of clear padding each side, so the 4 px focus ring never touches a neighbour's glyph).
- Gap between icon buttons: 4 px from 360 up, **0 below 360**. Adjacent boxes are 44 wide with no frame, so a 0 gap still leaves a 44 px target each.
- 320 budget (inner 296): brand 32 + chip 32 + 5 buttons x 44 = 284 <= 296 (12 px slack). Signed-out (Auth): brand + chip + lang + sound + help = 196. 390 (inner 358, gaps 4): brand 32 + chip 32 + 220 + 5 x 4 = 304 (54 slack); the wordmark (~92 px) is **hidden below 30em (480 px)** because 304 + 92 + 8 = 404 > 358.
- Wrap rule: the header never wraps; if a future item is added the chip hides first, then the wordmark.

### 6.3 Button states (unframed)
Rest: glyph in `--lp-text`, transparent. Hover (pointer only): fill `--lp-bg-2`. Pressed (`:active`, `aria-pressed` on Sound shows the speaker glyph, not a fill): fill `--lp-bg-2`, translate 2 px. Focus: v1 two-layer ring with `outline-offset: 0` (ring 4 px outward fits the 4 px header padding, so it is not clipped at the viewport top). Disabled: none used.

### 6.4 Account menu
`details[data-account]`: `summary` is the avatar; the panel hangs from the header's inline-end edge (existing CSS rule), width `max-content`, min 12rem, max viewport - 2 gutters, flat `--lp-bg-1` fill with a 4 px bottom `--lp-ledge` lip, no frame. Contents, top to bottom:
1. The player name (`[data-out="name"]`, body size `--lp-text`, `overflow-wrap: anywhere`, not interactive, 44 px tall row).
2. `Log out` button (framed secondary, 48 px box). It opens the existing confirm dialog.
Closes on `Escape`, on outside click, and on selecting an item (CIRCUIT). Open/close motion: 7.7.
Not in the menu: language, sound, help, leaderboard (they are header buttons), sync detail (the chip and toast cover it).

### 6.5 Play and short screens
Under 48em the header is hidden on Play (top bar replaces it). The Play top bar contains its own `mute` button (a second `data-action="mute"`; CIRCUIT must update **every** `[data-action="mute"]` icon and `aria-pressed`, not the first match). From 48em the header is shown on Play and the top bar's sound button is `display: none`.

---------------------------------------------------------------------------------------------------

## 7. Motion

Everything below sits inside `@media (prefers-reduced-motion: no-preference)`. The default (no media match, or `reduce`) is the static final state. No flashing above 3 Hz; no looping animation except the 1 Hz Blood last-10 cue and the busy ellipsis.

### 7.1 Tokens (add to `:root`; keep v1 `--lp-dur-1..4` for sprite `steps()` work)
```
--lp-dur-press: 80ms;      /* press-in */
--lp-dur-release: 120ms;   /* press-out, exits, small fades */
--lp-dur-base: 160ms;      /* dial fill, clue entrance, toast, menu */
--lp-dur-screen: 180ms;    /* view transition: the longest UI transition */
--lp-dur-count: 600ms;     /* score count-up */
--lp-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
--lp-ease-in: cubic-bezier(0.64, 0, 0.78, 0);   /* exits only */
```
Only `transform`, `translate`, `scale`, `opacity` and `background-color` animate. Never layout properties.

### 7.2 Screen change (View Transitions API)
- CIRCUIT: `if (document.startViewTransition && !reduce) document.startViewTransition(() => swap())`, else `swap()` immediately. After the transition's `updateCallbackDone` resolves, focus the new `h1` / main (existing rule). Never hold the DOM update behind a network call.
- CSS (names only on the root and the header, so the header does not flicker):
```
header { view-transition-name: lp-header; }
::view-transition-old(root) { animation: lp-vt-out var(--lp-dur-release) var(--lp-ease-in) both; }   /* 120 ms */
::view-transition-new(root) { animation: lp-vt-in var(--lp-dur-screen) var(--lp-ease-out) both; }    /* 180 ms */
@keyframes lp-vt-out { to { opacity: 0; } }
@keyframes lp-vt-in { from { opacity: 0; transform: translateY(8px); } }
```
Total <= 180 ms (old and new overlap). Vertical 8 px only, so it needs no RTL variant. Reduced motion: `::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }` and CIRCUIT does not start a transition.

### 7.3 Buttons, dials, keys
- Press: all buttons `transition: translate var(--lp-dur-press) var(--lp-ease-out), box-shadow var(--lp-dur-press) var(--lp-ease-out), background-color var(--lp-dur-release) var(--lp-ease-out)`. `:active` sinks 4 px (`translate: 0 var(--lp-bw)`) and the ledge collapses: keep the shadow list the same length (`0 0 0 0 var(--lp-ledge)` replaces the ledge) so it tweens. The 14% checker appears instantly on `:active` (it cannot tween and is the allowed pressed dither). Release uses the same transition (120 ms via `--lp-dur-release` on the non-`:active` state).
- Dial fill: when `data-state` becomes `filled` or `selected`, `animation: lp-fill var(--lp-dur-base) var(--lp-ease-out) 1` with `@keyframes lp-fill { from { scale: 0.94; } to { scale: 1; } }`; the accent fill of `selected` changes by `background-color` transition 120 ms. Wrong/correct frames switch instantly (state, not decoration).
- Keys: same press transition; the hardware-key `data-pressed` uses the same pressed look.
- Hover is a colour change only (no motion), inside `@media (hover: hover)`.

### 7.4 Lock open / close / fail (sprites keep `steps()`)
- Success (`data-lock="success"`): sprite swap closed to open is instant; `lp-hop` 320 ms `steps(1)` (2 steps, 8 px up and back) unchanged; lamp token turns `--lp-ok` instantly. On Result the lock appears at screen entry and swaps to open after 160 ms (`animation-delay`), so it reads as "opens as you arrive".
- Fail (`data-lock="fail"` plus wrong dials): `lp-shake` 720 ms `steps(1)`, 2.8 Hz, once, horizontal 4 px (v1 7.2 unchanged). Top-bar lock is 32 px; the shake amplitude stays 4 px.
- Reduced motion: sprite is the open lock with the green lamp (or red lamp on fail), dials show correct / wrong frames and marks; the toast and the Result word carry the state.

### 7.5 Clue entrance stagger
On `[data-screen="play"][data-enter]` (CIRCUIT sets the attribute once the screen transition has finished, or immediately without View Transitions): each `[data-slot="clues"] > li` runs `lp-rise var(--lp-dur-base) var(--lp-ease-out) both` = `from { opacity: 0; translate: 0 8px; }`, delay `calc(var(--i, 0) * 40ms)` with `li:nth-child(1) { --i: 0 } ... li:nth-child(n+5) { --i: 4 }` (CSS only, **<= 40 ms apart, max 5 steps**, last starts at 160 ms, ends at 320 ms). A clue added later animates once (no delay). CIRCUIT must **not** rebuild the whole list on every guess, otherwise the stagger replays; diff and append only.
Reduced motion: rows are simply present (`animation: none`).

### 7.6 Score count-up
Result: CIRCUIT counts the score text from 0 to N over `min(600ms, 200ms + N x 2ms)` (always <= `--lp-dur-count`) with `requestAnimationFrame` and ease-out; integer steps only. The number lives in a fixed-width box (`min-inline-size: 4ch`, tabular numerals, `direction: ltr`) so it never reflows. The `[data-out="score"]` node is `aria-hidden` while counting; a visually hidden live region receives the final value once. Blood points count with the same easing, started 160 ms after the score. Reduced motion: final value immediately, no count.

### 7.7 Toast, menu, details
- Toast in: `opacity 0 -> 1` and `translate 0 8px -> 0`, `--lp-dur-base`, `--lp-ease-out`; out: `opacity 1 -> 0`, `--lp-dur-release`, `--lp-ease-in` (CIRCUIT sets `data-leaving`, removes after `animationend` or 150 ms). Auto-clear at 3 s.
- Account menu panel: same in-animation with `translate 0 -4px -> 0`, 120 ms.
- `<details>` (Help example): `interpolate-size: allow-keywords` plus `details::details-content { transition: block-size var(--lp-dur-base) var(--lp-ease-out), content-visibility var(--lp-dur-base) allow-discrete; }`. Progressive: unsupported browsers just open instantly.
- Reduced motion: all of the above are instant.

### 7.8 Blood last-10 seconds
- `normal`: segments in `--lp-meter`. `last30`: clock icon becomes skull, timer text becomes `--lp-accent-text` (10.35 / 6.36 / 6.42 / 5.82 on bg-0), remaining segments gain the 2 x 2 hatch (structural, not hue-only), same as v1.
- `last10`: the timer group gets a 1-unit frame in `--lp-accent-text` (static cue) and, under `no-preference` only, the segment fill and that frame alternate between `--lp-meter` and `--lp-text` at **1 Hz**, `steps(1)` (existing `lp-pulse` with `@property --_pulse`; the readout digits never blink). CIRCUIT still announces 2:00, 1:00, 0:30, 0:10 and 0:00 via the SR timer region.
- Reduced motion: the frame stays 2 units thick in `--lp-text`, skull icon, hatch segments, bold-free text in `--lp-accent-text`. No pulse.

---------------------------------------------------------------------------------------------------

## 8. New sprites (QUARTZ builds into `assets/sprites.svg`; v1 section 9.1 build rules apply)

Reuse without change: `lock-closed`, `lock-open`, `vault-door`, `check`, `x`, `clock`, `bulb`, `skull`, `drop`, `trophy`, `user`, `speaker-on`, `speaker-off`, `arrow-left`, `sum`, `parity`, `compare`, `even-count`. **Dropped from use** (leave in the sheet until QUARTZ prunes): the `lp-d0..lp-d9` bitmap digits (never used).
Pips are CSS-drawn (5.2), so they are not sprites. No gear sprite: settings are the header buttons, so there is nothing for it to open.

All below are 8x8, single colour (`1` = `currentColor`), ids `lp-NAME`, inline size 16 px (2 px per art pixel) in rows and 32 px (4 px per art pixel) in header and button positions.

**help** (`?`, header)
```
.111111.
11....11
11....11
.....11.
....11..
...11...
........
...11...
```
**backspace** (Clear button; the accessible name stays "Clear")
```
...11111
..111111
.111.1.1
11111.11
1111.1.1
.1111111
..111111
...11111
```
**skip** (Blood skip button; mirrored in RTL via `.lp-icon--flip`)
```
1.....11
11....11
111...11
1111..11
1111..11
111...11
11....11
1.....11
```
**alert** (sync chip, both attention states)
```
...11...
...11...
...11...
...11...
...11...
........
...11...
...11...
```
**none** (zero-match feedback glyph, slashed circle)
```
..1111..
.1....1.
1....1.1
1...1..1
1..1...1
1.1....1
.1....1.
..1111..
```
**key** (Classic mode glyph on the Home button and the Classic stat cell)
```
.1111...
11..11..
11..11..
.1111...
..11....
..111...
..11....
..111...
```
Usage sizes: lock in the Play top bar = `lock-closed` / `lock-open` at **32 x 32** (`--lp-lock-sm`, 2 px per art pixel, host `[data-lock]`); lock on Result = 64 x 64 (4 px); vault door 96 x 96 on Auth and the tall-Home hero only; brand lock in the header = 32 x 32.
Colour roles for the sprite ids are the v1 palette letters; the `alert` and `none` sprites are single-colour and take `color` from CSS. Estimated cost: 6 new symbols x ~170 B = ~1 KB raw; QUARTZ confirms the gzipped total of `sprites.svg` stays inside `docs/perf.md`.

---------------------------------------------------------------------------------------------------

## 9. Do not (must never creep back)

1. No dither or checker on the page, header, footer, panels or rows. (Disabled and pressed controls only.)
2. No dashed or solid rule under headings, between rows, above the footer or under the header.
3. No paragraph on Auth, Home, Play or Result. No sentence over 8 words there. No label over 2 words.
4. No frame around a group whose children are framed; no frame on chips, badges, stats, rows, toasts, the dock, dialogs or the timer bar. No double frames, no frame plus ledge on non-primary controls.
5. No uppercase, no `text-transform`, no letter-spacing (except the 6-digit code), no bold, no italic, no faux bold. No second typeface.
6. No visible `h1`/`h2` on Play. No puzzle id. No "Recent rounds" on Home. No lock sprite in the dock.
7. No text-labelled Hint, Skip, Clear or Quit button on Play (icons with hidden names).
8. No sticky header on any screen. No sticky dock inside a short viewport (page scroll there).
9. No colour-only state: pips are shape, selected options carry fill plus on-accent squares, errors keep the `x` sprite plus text.
10. No 2-column clue grid on phones, no clue index numbers, no per-clue sentence on screen.
11. No animation over 180 ms except the 600 ms score count and the 720 ms stepped shake/hop; no `steps()` on UI transitions (sprites only); no layout-property animation; no flashing above 3 Hz.
12. No GSAP or any motion/decorative dependency (CLAUDE.md precedence).
13. No `[data-out="name"]` text in the account summary; no second user icon in the header.
14. No sync chip while synced or saving.

---------------------------------------------------------------------------------------------------

## 10. Deltas for the three implementers

### 10.1 PRISM: token deltas for `css/main.css`
```
/* fonts */
@font-face { font-family: "Jersey 10"; src: url("../assets/fonts/jersey10-latin.woff2") format("woff2");
             font-weight: 400; font-style: normal; font-display: swap;
             unicode-range: U+0020-007E, U+00A0, U+00B7, U+00D7, U+2013, U+2019, U+2022, U+2026, U+2212; }
/* "Jersey Fallback": QUARTZ supplies size-adjust / ascent-override / descent-override (the Pixelify numbers are void). Delete both Pixelify faces. */
--lp-font-latin:  "Jersey 10", "Jersey Fallback", ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace;
--lp-font-arabic: "Jersey 10", "Jersey Fallback", system-ui, "Segoe UI", Tahoma, "Noto Sans Arabic", "Droid Arabic Kufi", "Geeza Pro", sans-serif;
--lp-fw-bold: 400;                       /* remove every other weight; h*, strong, th, dt, summary: 400 */
--lp-lh-body: 1.3;  --lp-lh-tight: 1.1;  /* Arabic: 1.7 / 1.5 as today */

/* type roles (px): base | >=24em | >=48em */
--lp-fs-label: 18 | 18 | 20      --lp-fs-body: 22 | 22 | 24      --lp-fs-h2: 28 | 28 | 32      --lp-fs-h1: 36 | 40 | 48
--lp-fs-dial: 40 | 48 | 56 (by dial height: 40 @48h, 48 @64h, 56 @72h)    --lp-fs-key: 28 @44h | 32 @52h
--lp-fs-timer: 24 | 28 | 32      --lp-fs-timer-blood: 32 | 40 | 48      --lp-fs-stat: 28 | 32 | 36
--lp-fs-score: 56 | 64 | 80      --lp-fs-code: 40 | 48 | 48
html[lang="ar"]: --lp-fs-label 16|16|18, --lp-fs-body 18|18|20, --lp-fs-h2 24|24|28, --lp-fs-h1 32|36|40
DELETE: --lp-ls-caps, --lp-text-scale, and the uppercase rules (.lp-badge:lang(en), tbody tr[data-self] th > span:lang(en)).
Transitional aliases while migrating: --lp-fs-0 = label, --lp-fs-1 = body, --lp-fs-2 = body, --lp-fs-3 = h2, --lp-fs-4 = h1, --lp-fs-5 = score, --lp-fs-6 = timer-blood (remove at the end).

/* colour: ONE change */
Classic light --lp-text-dim: #444C6B -> #3A4160
DELETE: --_rule, --_scan, the body checker background (body { background: var(--lp-bg-0) }), --_chk50 (dialog shadow), --lp-dither stays defined (prefers-contrast rule references it).

/* layout */
--lp-gutter: max(12px, safe-area...)  /* below 22.5em */   ->   max(16px, safe-area...)  /* from 22.5em */
--lp-header-h: 52px (>= 48em: 64px)      --lp-topbar-h: 52px (Blood: 60px)
--lp-icon-btn: 44px                       --lp-btn-h: 48px     --lp-btn-lg: 56px (Check, Classic: 56 box; Classic on Home 72 box with subline)
--lp-icon: 32px (existing)                --lp-icon-sm: 16px (new)         --lp-lock-sm: 32px (new)
--lp-col: 28rem (Auth, Home, Result) ; --lp-col-wide: 36rem (Board, Help)
--lp-dial-w: 48px (< 24em) | 56px (>= 24em) | 64px (>= 80em);   --lp-dial-cell: calc(var(--lp-dial-w) + 8px)
--lp-dial-h: 48px (compact) | 64px (tall) | 72px (>= 80em tall)
--lp-key-h: 44px (compact) | 52px (tall);   --lp-actions-h: = --lp-key-h
--lp-row-h: 40px (compact) | 48px (tall);   --lp-row-gap: 4px | 8px
--lp-dock-gap: 4px (compact) | 8px (tall);  --lp-dock-pad: 4px | 8px
--lp-dock-h fallback: calc(var(--lp-px) * 58) = 232px (compact) | calc(var(--lp-px) * 73) = 292px (tall)   (ui/chrome.js still measures)
--lp-space-*, --lp-px, --lp-bw, frame recipe, ledge: unchanged.

/* motion */
--lp-dur-press: 80ms  --lp-dur-release: 120ms  --lp-dur-base: 160ms  --lp-dur-screen: 180ms  --lp-dur-count: 600ms
--lp-ease-out: cubic-bezier(0.22, 1, 0.36, 1)   --lp-ease-in: cubic-bezier(0.64, 0, 0.78, 0)
--lp-dur-1..4 and --lp-ease-step-* unchanged (sprites).
```
Selector changes for PRISM:
- **Frame `:where()` list** (the `1-unit box-shadow bars` rule): keep `button, input, [data-slot="difficulty-picker"] label`; **remove** `summary, dialog, output[data-out="code"], .lp-chip, .lp-badge, .lp-stamp, [data-timer-bar], [data-toast], [data-screen="play"] > section[aria-labelledby="play-guess-title"], section[aria-labelledby="home-points-title"], [data-screen="help"] [data-mode="blood"]` (`noscript > section` stays; it is the no-JS fallback).
- **Buttons:** default framed secondary (bg-2 + frame, no ledge). Ledge only on `[data-action="signup"], [data-action="signin"], [data-action="play-classic"], [data-action="check"], [data-action="next"], [data-action="retry"], [data-action="ack-code"]`. `button[data-mode="blood"]` stops being a red-filled primary: it is the Blood-tokens button (fill `--lp-bg-1`, frame `--lp-line`, label `--lp-text`, subline and skull `--lp-accent-text`).
- **Unframed icon buttons** `.lp-iconbtn` (header, top bar, screen head, Play quit and sound): 44 x 44, no frame, no margin, ring per 6.3. `summary` in the header is styled as `.lp-iconbtn`. Text links `button.lp-link`: no frame, no fill, accent-text, 2 px underline, `min-block-size: 44px`, inline-size auto.
- **Remove:** `.lp-stamp`, `.lp-badge` (visible), `.lp-vault-door` on Home except the tall hero, `[data-slot="history"]`, `nav` block on Home, the h2 rule, Home `[data-screen="home"] > .lp-vault-door` grid placement, `[data-screen="play"] > dl` status-strip grid (replaced by the top bar), `.lp-lock` in the dock, the `attempts` visible chip rules (keep `visually-hidden`), `[data-slot="clues"] > li::before` (`#n`), the clue start bar, `.digit` box frame, `dd:has(> output[data-out="timer"])` grid.
- **Add** screen rules: `body[data-screen="play"] header { display: none }` below 48em, footer hidden on Play and Result, `.lp-stats` 3-column grid (gap 4, cell bg-1, pad 12/16, label then number, `data-mode="blood"` cell uses local tokens), `.lp-dig` digit-count squares (`--n`, `background: repeating-linear-gradient(90deg, currentColor 0 8px, transparent 0 12px)`, width `calc(var(--n) * 12px - 4px)`, height 8px), `[data-slot="clues"]` scroller rules (3.3), `p[data-live="status"]` toast placement (3.3), dock grid (5 columns of `--lp-dial-cell`, rows per 3.3), actions `menu` grid (`1 / 3 / 1` columns, `li:nth-child` spans), `@container` two-column clue list, View Transition CSS (7.2), entrance stagger (7.5), pressed/ledge tween (7.3).
- **Keep:** `@property --_pulse`, `--lp-timer-left`, `--_rf`; dial state rules; pip rules (change both pips to `--lp-text`: `[data-pip="right"] { background: var(--lp-text) } [data-pip="wrong"] { border: var(--lp-px) solid var(--lp-text) }`); focus ring; `prefers-contrast` and forced-colors blocks.
- Forced colors: frames fall back to `border: 2px solid CanvasText` as in v1; pips use `CanvasText`; the `alert` sprite uses `CanvasText`.

### 10.2 GRANITE: markup changes (`index.html`)
New hook on `<body>`: `data-screen="auth|home|play|result|board|help"` (CIRCUIT sets it; PRISM uses it instead of `:has`).
- **Header:** `p.lp-brand` keeps the sprite, wordmark span gets `class="lp-brand__name"`. Sync chip: `p.lp-chip[hidden]` containing the `alert` sprite and a visually hidden `[data-out="status"]` (and the existing label span, hidden). Buttons in order: `lang` (visible text, visually hidden target name), `mute` (icon + hidden `<span data-i18n="chrome.mute">`), **new** `show-help` icon button (`help` sprite, hidden `chrome.help`), **new** `show-board` icon button (`trophy`, hidden `chrome.board`, `data-needs-auth` and `hidden` until signed in), account `details[data-needs-auth][hidden]`: `summary` icon only (`user` sprite; hidden `chrome.account.label` + hidden `[data-out="name"]`), panel = `<p data-out="name">` then logout `button`. All icon buttons get `class="lp-iconbtn"`.
- **Auth:** drop `auth.intro`, `auth.privacy` paragraph and `signup-name-hint` paragraph from view; move their text into one `<p id="auth-privacy" class="visually-hidden">` referenced by `aria-describedby`. Form `h2`s get `class="visually-hidden"`. Remove the `show-help` button. `show-signin` / `show-signup` buttons get `class="lp-link"`. Vault door stays (hero, aria-hidden).
- **Home:** `h1` gets `class="visually-hidden"` ("Home"). Replace the greeting paragraph with `<p class="lp-who"><svg user/> <span data-out="name"></span></p>`. Stats: `<section aria-labelledby="home-points-title">` keeps a visually hidden `h2`; inside a `<dl class="lp-stats">` with `<div data-stat="classic|blood|total">` wrappers (valid `<div>` in `<dl>`; comment the reason) each holding `<dt>` (icon + label; blood cell also a hidden `home.points.blood.sr`) and `<dd><output data-out="classic|blood|total">`. Blood cell keeps `data-mode="blood"`. Difficulty: `fieldset` keeps `legend.visually-hidden`; remove the note paragraph. Mode buttons: `<menu class="lp-play">` with two `li > button`: Classic = `key` sprite + `<span class="lp-btn__label">` + `<span class="lp-btn__sub">` + hidden `<span id="home-classic-desc">`; Blood = `skull` + label + sub + hidden description, `data-mode="blood"`. Delete the History section and the "More" nav. Optional tall hero: keep one `.lp-vault-door` (aria-hidden) between the stats and the difficulty group.
- **Play:** reorder to: visually hidden `h1`; **top bar** `<header class="lp-topbar">` (a nested `header` is not a banner; comment) containing `button.lp-iconbtn[data-action="quit"]` (`arrow-left`, `lp-icon--flip`, hidden `play.quit`), the `[data-lock]` host (moved from the dock), `<p>` with the Blood skull and `[data-out="difficulty"]` (name only), the timer group (`clock`/`skull` icon + `output[data-out="timer"][role="timer"]` + hidden `play.timer` label), the wrong group (`x` sprite + `[data-out="attempts-left"]` + hidden `play.attempts` label), `button.lp-iconbtn[data-action="mute"]`. `[data-timer-bar]` moves directly after the top bar. Then the clue scroller: `section[aria-labelledby="play-clues-title"]` with hidden `h2`, `ol[data-slot="clues"]` (`tabindex="0"`, `role="region"` is implied by the labelled section, give the `ol` an `aria-labelledby`), then `p[data-live="status"][aria-live="polite"]` (toast placement, as last child of this section). Then the dock `section[aria-labelledby="play-guess-title"]`: hidden `h2`, hidden `#play-guess-help`, `div[data-slot="dials"]`, hidden `ol[data-slot="attempts"]`, `div[data-slot="keypad"]`, `menu` with `clear` (backspace icon, hidden `play.clear`), `check` (visible `play.check`), `skip` (skip icon, hidden `play.skip`, `hidden` in Classic), `hint` (bulb icon, hidden `play.hint`, `hidden` in Blood). **Remove** from Play: the `dl` status strip, puzzle id output, mode badge (keep `[data-mode-badge]` inside a visually hidden `p`), visible `Quit Round` paragraph, dock lock and dock message.
- **Result:** `h1` becomes the visible result word: `<h1 id="result-title" tabindex="-1" data-out="msg"></h1>` (CIRCUIT writes it); remove the framed `.lp-stamp` paragraph and the visible badge (keep `[data-mode-badge]` hidden). Order: lock (`data-lock`, 64), `h1`, `.lp-score` (`<output data-out="score">` + `<span data-i18n="result.score">`), Blood line `p[data-mode="blood"]` (drop icon + `data-i18n="result.bloodpoints"` + `<output data-out="bloodpoints">`, `hidden` unless a Blood run), Blood-only `p[data-out="solved"]`, PB line (`trophy` + `[data-pb]` text), failure-only `p[data-out="answer"]`, hidden `ul[data-slot="result-lines"]` (visually hidden, with its hidden `h2`), `menu` of two buttons: Home (ghost) and Next / Again (primary, one `hidden` by mode).
- **Board / Help:** replace the bottom Back paragraph with a screen head `<header class="lp-screenhead">`: `button.lp-iconbtn[data-action="back"]` (`arrow-left`, flip, hidden `chrome.back`) + the `h1`. Board: note paragraph keeps `data-i18n="board.note"`; table header cells get `# + hidden Rank`; the `th` Player and Points stay.
- **Help:** rebuild per 4.7: goal block (`dial-row` glyph + one-liners), clues legend as `<dl class="lp-legend">` whose `<dt>` holds the real clue glyph markup (digits, `[data-pip]`, `none`, icon + `.sym`; all `aria-hidden`) and whose `<dd>` holds the one-liner; Points list; Blood list (`data-mode="blood"`, skull, no frame); Your code; `<details><summary data-i18n="help.example.title">` with the four example clue rows and the existing solution paragraph; credit footer. Remove the long `help.clues.*.body` paragraphs and the bottom Back.
- **Dialogs:** `code`: remove `desc` paragraph from view (hidden, still `aria-describedby`), remove `ackHint` from view (hidden). Logout / quit unchanged in structure.
- **Head:** change the preload to `./assets/fonts/jersey10-latin.woff2` (QUARTZ confirms the hash for the service worker precache). No CSP change (same-origin font, `font-src 'self'` already). The inline pre-paint script must stay byte-exact (CSP hash).
- Sprite sheet: add the six new symbols (section 8).
- Class names GRANITE introduces for PRISM: `.lp-iconbtn`, `.lp-link`, `.lp-who`, `.lp-stats`, `.lp-dig`, `.lp-play`, `.lp-btn__label`, `.lp-btn__sub`, `.lp-topbar`, `.lp-screenhead`, `.lp-score`, `.lp-legend`, `.lp-brand__name`. All others stay data-hook based.

### 10.3 CIRCUIT: render and behaviour
- **Body hook:** set `document.body.dataset.screen` on every screen change (inside the View Transition callback).
- **View Transitions:** wrap screen swaps (7.2); skip when `prefers-reduced-motion: reduce` or unsupported; focus the new `h1` after `updateCallbackDone`; set `data-enter` on the Play section after the transition finishes (or at once without it).
- **Chip:** show `p.lp-chip` only for `offline` and `local`; `hidden` for `synced` and `saving`; on every state change that shows or hides it, fire a toast with `status.say.*`. Never announce `saving`.
- **Mute:** update every `[data-action="mute"]` (icon `href`, `aria-pressed`). `aria-pressed="true"` means sound ON.
- **Lang button:** write `chrome.lang.toggle` as the visible text and `chrome.lang.name` into the hidden span; keep the `lang` attribute equal to the target language.
- **Name:** write every `[data-out="name"]` (header menu, summary hidden copy, Home `.lp-who`), not the first match.
- **Home:** render the difficulty picker with `<label><span>{name}</span><span class="lp-dig" style="--n:{digits}" aria-hidden="true"></span><span class="visually-hidden">{digits text}</span></label>`; format stat numbers with compact notation above 6 characters; render Blood sublines from `config.js` (`{duration}`, `{mult}`); stop rendering History.
- **Play:** write only the difficulty **name** into `[data-out="difficulty"]`; put the `play.diffline.*` text into a visually hidden description of the top bar; hide the wrong count in Blood; toggle `hidden` on `skip` / `hint` by mode; clear `[data-out="msg"]` 3000 ms after each message; never rebuild the clue list per guess (diff and append) so the entrance stagger does not replay; render clues with the new flat contract: feedback = `.digit` spans (`aria-hidden`), pips as `<span data-pip="right|wrong" aria-hidden="true">` (right first), or `<svg class="lp-icon-sm"><use href="...#lp-none"/></svg>` for zero; other kinds = 16 px icon + `<span class="sym" aria-hidden="true">` built from `clue.sym.*` + `<span class="clue-text visually-hidden">` with the existing `clue.*` sentence. Drop `data-n` and the `#n` pseudo content; drop the `.clue-text` visual styles in PRISM.
- **Result:** write the result word into `h1[data-out="msg"]`; run the 7.6 count-up (final value to a visually hidden live region, `aria-hidden` while counting, skip under reduced motion); keep writing `[data-slot="result-lines"]` (now hidden); fill `[data-out="solved"]` and `[data-out="answer"]` only when relevant; toggle `hidden` on Next / Again by mode.
- **Account menu:** close on `Escape`, outside click and item activation; focus returns to the summary.
- **Copy:** replace English strings per section 4 (value changes in place; add the new keys), write Arabic from the intent notes (short, Western digits, ASCII operators `= > <`), delete unused keys only after ATLAS signs off the list in 4.
- **Unchanged:** engine, scoring, sync, dial and keypad logic, `data-state` / `data-lock` / `data-phase` / `--lp-timer-left` / `data-tone` / `--lp-n` hooks, SR timer region, toast `role="status"`, quit/logout dialogs.

### 10.4 Removed hooks and selectors (everyone)
`[data-out="puzzle-no"]`, visible `[data-mode-badge]`, `.lp-badge`, `.lp-stamp`, `[data-slot="history"]`, visible `[data-slot="attempts"]`, Home `nav` and `home.more.*`, `[data-action="show-help"]` on Auth and Home bodies (header only), bottom `[data-action="back"]` paragraphs (now in `.lp-screenhead`), `[data-action="quit"]` text button (now `.lp-iconbtn`), `.lp-lock` inside the dock, the Play status `dl`.
e2e assertions that read removed text or elements need updating (ADR 0005 Consequences): puzzle id, "Recent rounds", "Pick a Mode", `Hint (Half Points)`, `Crack the Lock` as visible text, the Blood desc sentence (now H), `Quit Round`.

---------------------------------------------------------------------------------------------------

## 11. Acceptance checks MUSE will apply and SENTRY must script

1. Screenshots at 320x568, 360x640, 390x664, 390x844, 768x1024, 1280x720 in Classic and Blood x dark and light, with `prefers-reduced-motion` pinned both ways through CDP `Emulation.setEmulatedMedia`.
2. Page-scroll gates at 390x844: Auth, Home, Result and Play have `document.scrollingElement.scrollHeight <= innerHeight`. At 320x568: Home and Result <= 1.25 screens (design target 1.0), Play shows the dial row, both keypad rows and >= 2 full clue rows (design target 5 to 6). Play 8 clues: no page scroll, only the clue area scrolls.
3. Dial row at 320: five 48 px dials in 296 px, no wrap, no horizontal scroll; keys aligned under dials; Check spans columns 2 to 4.
4. Every icon-only control is >= 44 x 44 and has an accessible name in both languages (axe + manual).
5. Contrast: script every pair in 2.4 (the Classic-light `#3A4160` change included); a miss is a token bug.
6. Type: QUARTZ records the real Jersey 10 size (<= 20 KB) and measured widths of "Hacker", "Classic", "12,450", "Blood points (from Blood mode)" at the 2.2 sizes; if any budget in section 3 loses its slack, PRISM applies the stated fallback (hide the difficulty name under 360, compact number notation) instead of shrinking below 18 px.
7. Arabic: dial row, keypad, clue rows, symbols and timer stay LTR; `>` never mirrors; no clipped glyphs in 44 px buttons; Western digits.
8. Reduced motion: no translate, no scale, no pulse, no count-up, no view transition; the final states are identical.
9. Keyboard: tab order on Play is quit, mute, clue scroller, dials, keys, clear, check, skip/hint; the focus ring is visible on every control and never under the dock or clipped by the viewport (including the unframed header buttons).
10. No horizontal scroll from 320 to 2560 and at 200% zoom.

HANDOFF → main
DONE:     Wrote /home/kali/Desktop/WEB/lock-puzzle-game/docs/design-v2.md (11 sections): 5 principles + 22-item noise inventory with replacements; Jersey 10 scale in px for 320/390/768+ (+ Arabic overrides) and emphasis rules; contrast re-check of every pair touched by size/surface changes (one token change: Classic-light --lp-text-dim #444C6B to #3A4160, 7.41/9.15/6.20); wireframes with px arithmetic for Auth, Home, Play (Classic/Blood), Result, Board, Help at 320x568, 390x844 and 768/1280 (Home 500 px at 320x568, 516/508 at 390; Play dock 232 compact / 292 tall, clue area 284 at 320x568 = 6 rows visible, 8 clues fit at 390x844 and scroll inside the clue area only otherwise); exact EN copy with i18n keys (existing vs new) and H/V/D visibility; clue card spec (monochrome filled/hollow pips, none glyph, LTR symbol forms); header spec (44 px unframed icon buttons, chip only on attention, account menu); motion spec with tokens and reduced-motion equivalents; 6 new 8x8 sprites (help, backspace, skip, alert, none, key); do-not list; token deltas for PRISM and hook/markup/render changes for GRANITE/CIRCUIT.
RISKS:    (1) Jersey 10 glyph widths and unitsPerEm are estimates, not measurements; the 320 px budgets (stats number 72 of 80, option label 48 of 55, dial row 296 of 296) have 0-8 px slack and need QUARTZ metrics plus SENTRY screenshots before PRISM locks sizes. (2) I could not open the live site and could not find ADR 0003/0004 files by name; I relied on ADR 0005's summaries, so a Blood-points wording rule in ADR 0003 beyond what ADR 0005 s4 quotes may be missed. (3) The Play layout depends on a fixed-viewport grid with `overflow: clip` on body: SENTRY must test short viewports (< 544 px high), 200% zoom and landscape, where the dock must fall back to static page scroll. (4) Hiding the global header on Play under 48em adds a second `data-action="mute"` button: CIRCUIT must update all of them. (5) Hand-computed contrast is flagged "script-check" for Blood-light on-accent (5.32), Blood-dark accent-text on Blood bg-1 (5.98) and the Blood 390x844 8-clue fit (2 px slack). (6) Clue entrance stagger replays if CIRCUIT rebuilds the clue list on every guess. (7) The privacy line on Auth became hidden-only ("Shown on the leaderboard"): a content/policy call for the owner.
BLOCKED:  Owner decision: whether the Auth privacy notice may be visually hidden (label "Nickname" plus hidden description) or must stay as one visible short line. Owner decision: whether Blood should show a visible "Solved n" in the Play top bar (not designed; engine data exists).
NEXT:     ATLAS routes in parallel: QUARTZ (Jersey 10 subset, measured widths, 6 sprites, precache and preload) first because PRISM's 320 px sizes depend on the metrics; then PRISM applies section 10.1 while GRANITE (10.2) and CIRCUIT (10.3) land the markup and copy; SENTRY scripts the section 11 gates.
