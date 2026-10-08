# Design system: "VAULT PANEL" (MUSE)

Owner brief: look perfect on mobile; the design must look PIXELATED / pixel-art / 8-bit.
Consumers: PRISM (css/*.css), QUARTZ (font subset, sprites), GRANITE (hooks), CIRCUIT (state hooks).
Inherited UI (white cards on a slate gradient) is discarded entirely. Nothing below reuses it.

Status of this document
- Tokens, ratios and sprite maps are specified to be implemented mechanically. Nothing here is CSS-in-the-repo yet.
- Contrast ratios were computed by hand with the WCAG 2.x relative-luminance formula (no code
  execution was available to MUSE this session). Luminances are listed so any pair can be re-checked in
  seconds. Treat a result within 0.15 of a threshold as "verify with a script". SENTRY: re-verify all pairs
  in section 2 with a script before release; a pair under its threshold is a release blocker.
- ADRs 0001..0003 could not be listed (directory listing tools failed), so this document relies on the
  summary in `docs/architecture.md`. If an ADR contradicts anything here, ATLAS rules.
- Game title is not fixed. "LOCK PUZZLE" is a working title: `TODO(content): final game name`.
- All user-facing strings are `TODO(content)` placeholders owned by CIRCUIT's i18n files. No em dashes in copy.

Design read (taste-skill preflight): mobile-first puzzle game for phone players (EN/AR), committed
pixel-art language, dark-first, calm density. Dials: VARIANCE 4 (rigid grid, game UI), MOTION 3
(stepped, motivated, reduced-motion safe), DENSITY 5 (clues are data, but touch targets stay large).

---------------------------------------------------------------------------------------------------

## 1. Concept

### 1.1 The one idea
The whole app is the **control panel of a bank vault, drawn on a 4px pixel grid**. Every control is a steel
plate with a stepped-corner frame. The player is a safecracker at the panel; the panel has exactly one
living thing on it: a **lock/vault sprite with a status lamp** that sits above the dials and reacts to the
game (idle, success, fail). The accent color is "the lamp color of the mode": **amber in Classic, red in
Blood Point**. One accent per mode, never two.

Aesthetic family (ONE, committed): **1-bit-plus pixel hardware UI** (Playdate / System-7 chunkiness):
hard 1-unit outlines, flat fills, ordered-dither shadows and disabled states, zero radius, zero gradients,
zero glow, zero blur. Motion is stepped. There is no neon, no CRT bloom, no purple.

Why it will not read as generic "neon arcade slop":
- Palette is cold steel-blue neutrals with one warm lamp color (Classic) or one blood red (Blood).
  No rainbow, no cyan/magenta pair, no gradient text, no outer glows.
- Depth comes from **ledges and dither**, never from blur shadows.
- The feedback language is mechanical (lamp, bolts, dial ticks, stamps), not arcade (coins, stars, confetti).

### 1.2 Mood
Quiet, tense, tactile. Classic = night shift in a vault, amber work lamp. Blood Point = same room, alarm
tripped: palette swaps to near-black red, segmented countdown, stamps turn red. Light scheme = the same
panel photocopied on cool grey paper with ink outlines (still pixel; frames become ink).

### 1.3 Three reference ideas (described, not hotlinked)
1. **1-bit handheld UI (Playdate / classic Mac System 7).** Chunky outlines on every control, ordered
   2x2 dither used for shadows, pressed states and disabled fills, one spot color. We take: dither as
   the only "shading", and outline-first contrast (which is also how we pass 3:1 on light themes).
2. **Vault and safe-deposit hardware.** Brushed steel plates, rivets, a dial with tick marks, a single
   indicator lamp that goes green or red. We take: the corner bolts (2x2 highlight pixels), the lamp,
   the dial as the hero control. (Library cross-check: `design-md-library` index describes
   `nintendo-2001` as beveled metal plates with an amber glow, `ibm` as a flat-square, no-radius system,
   and `hashicorp` as a "Vault" yellow accent on near-black. We took the plate and flat-square judgment
   and the single warm accent; we rejected the glow and the gradients. Only INDEX.md was readable.)
3. **Bureaucratic ledger and stamp (Papers-Please-style result screens).** Results are a ledger of
   rows with dotted leaders and a framed stamp ("ACCESS GRANTED" / "LOCKED OUT" / "TIME UP"). We take:
   the stamp as the result headline and the ledger as the score breakdown.

### 1.4 Signature element: the Lock Lamp
- Sprite `lock-closed` (16x16, drawn at 4x = 64px) sits left of the status message above the dials on
  Play, and `vault-door` (24x24, 96px) is the hero on Auth and Home.
- Hosted in an element with `data-lock="idle|success|fail"` (hook requested, section 10.3).
  - idle: lamp pixels use `--lp-text-dim`.
  - success: sprite swaps to `lock-open` (Play) with a 2-step hop; the vault lamp turns `--lp-ok`.
  - fail: lamp turns `--lp-bad`; lock shakes (section 7).
- The lamp is a redundant cue only. The same state is always also stated in text and by an icon.

### 1.5 Skill judgment adopted and rejected (CLAUDE.md precedence: DoD and budgets win)
Adopted from `industrial-brutalist-ui`: radius 0 everywhere, visible compartmentalization by frames,
dark-first telemetry feel, one red accent, dither and scanline as texture, semantic tags.
Adopted from `design-taste-frontend`: no neon glow, no pure #000 or #fff as surfaces, one accent per
page, shape lock (one corner system), button/form contrast audit, `100dvh`, no emoji, no decorative
dots, motion must be motivated, no centered-card-grid default.
Rejected: heavy grotesk and Inter display faces, SVG noise filter on the root (repaint cost), phosphor
glow, terminal green, GSAP/Motion libraries, any decorative dependency.

---------------------------------------------------------------------------------------------------

## 2. Color tokens

Scheme logic (dark-first). `body[data-mode="classic|blood"]` is set by the app (architecture.md).
Tokens are ALSO valid on any element carrying `data-mode`, so a Blood-styled card can live on a Classic page.

```
:root, [data-mode="classic"]            { /* Classic dark  (default) */ }
[data-mode="blood"]                     { /* Blood dark */ }
@media (prefers-color-scheme: light) {
  :root, [data-mode="classic"]          { /* Classic light */ }
  [data-mode="blood"]                   { /* Blood light */ }
}
:root { color-scheme: dark light; }
```
Always reference roles (`var(--lp-text)`), never hex, in component CSS. No hex outside tokens.css.

### 2.1 Values

| Token | Classic dark | Classic light | Blood dark | Blood light |
|---|---|---|---|---|
| `--lp-bg-0` page | `#12151C` | `#D9DEEA` | `#160709` | `#F1D6D6` |
| `--lp-bg-1` panel | `#1B2030` | `#F3F5FA` | `#240E12` | `#FFF1F0` |
| `--lp-bg-2` inset / raised | `#262D44` | `#C5CCDD` | `#35161C` | `#E5BDBE` |
| `--lp-field` input fill | `#12151C` | `#C5CCDD` | `#160709` | `#E5BDBE` |
| `--lp-text` | `#ECEFF7` | `#151A2E` | `#FBEEEF` | `#2A0A0E` |
| `--lp-text-dim` | `#A9B1CC` | `#444C6B` | `#D8A7AC` | `#6B2A31` |
| `--lp-line` (control frame) | `#8E98BE` | `#151A2E` | `#C9707A` | `#2A0A0E` |
| `--lp-line-soft` (decor only) | `#3A4466` | `#A3ABC2` | `#5A2A31` | `#C99A9C` |
| `--lp-ledge` (decor only) | `#0A0C12` | `#8F99B5` | `#0A0304` | `#B58587` |
| `--lp-ink` (dark overlay) | `#12151C` | `#151A2E` | `#160709` | `#2A0A0E` |
| `--lp-accent` (fills) | `#F5B942` | `#F0A81C` | `#FF5A5A` | `#C4202A` |
| `--lp-on-accent` | `#12151C` | `#151A2E` | `#160709` | `#FFF1F0` |
| `--lp-accent-text` (text/icons on surfaces) | `#F5B942` | `#6B4400` | `#FF5A5A` | `#9E1B24` |
| `--lp-meter` (timer segments) | `#F5B942` | `#8A5600` | `#FF5A5A` | `#C4202A` |
| `--lp-ok` | `#5BD68A` | `#125A34` | `#5BD68A` | `#125A34` |
| `--lp-bad` | `#FF7B7B` | `#9E1B24` | `#FF9A9A` | `#9E1B24` |
| `--lp-info` | `#7DB2FF` | `#1F4EA6` | `#7DB2FF` | `#1F4EA6` |
| `--lp-danger` (fill) | `#FF7B7B` | `#9E1B24` | `#FF9A9A` | `#9E1B24` |
| `--lp-on-danger` | `#12151C` | `#F3F5FA` | `#160709` | `#FFF1F0` |
| `--lp-inv-bg` (toast) | `#ECEFF7` | `#151A2E` | `#FBEEEF` | `#2A0A0E` |
| `--lp-inv-text` | `#12151C` | `#F3F5FA` | `#160709` | `#FFF1F0` |
| `--lp-spr-k` sprite outline | `#0A0C12` | `#151A2E` | `#0A0304` | `#2A0A0E` |
| `--lp-spr-b` sprite body | `#F5B942` | `#F0A81C` | `#FF5A5A` | `#C4202A` |
| `--lp-spr-h` sprite highlight | `#ECEFF7` | `#F3F5FA` | `#FBEEEF` | `#FFF1F0` |
| `--lp-spr-s` sprite steel | `#8E98BE` | `#444C6B` | `#C9707A` | `#6B2A31` |

Theme-independent:
- `--lp-focus-in: #0A0C12;` `--lp-focus-out: #FFFFFF;` (focus ring, section 8; pure white is allowed
  here only because it is the focus indicator, never a surface)
- `--lp-dither: color-mix(in srgb, var(--lp-text) 8%, transparent);`
- `--lp-scrim: color-mix(in srgb, var(--lp-bg-0) 86%, transparent);` (dialog backdrop; under
  `prefers-reduced-transparency: reduce` use solid `var(--lp-bg-0)`)
- `--lp-spr-lamp: var(--lp-text-dim);` default; `[data-lock="success"] { --lp-spr-lamp: var(--lp-ok); }`
  `[data-lock="fail"] { --lp-spr-lamp: var(--lp-bad); }`

Rules baked into the table:
- Frames of controls are ALWAYS `--lp-line`. In both light themes `--lp-line` is the ink color, so an amber
  or red fill never has to carry its own 3:1 edge (amber on light grey is only 1.5 to 1.9:1; the ink frame
  carries it).
- Accent as TEXT uses `--lp-accent-text`, never `--lp-accent`, so light schemes stay legible.
- Errors always pair `--lp-bad` with the x sprite and a sentence. Color is never the only signal.
- In Blood mode `--lp-bad` is a lighter red than the accent and is always accompanied by an icon + text,
  because accent red and error red are intentionally in one family.

### 2.2 Relative luminance table (WCAG 2.x, sRGB)
L = 0.2126 R + 0.7152 G + 0.0722 B on linearized channels. Ratio = (L1 + 0.05) / (L2 + 0.05).

| Color | CD | CL | BD | BL |
|---|---|---|---|---|
| bg-0 | 0.0075 | 0.7294 | 0.0034 | 0.7164 |
| bg-1 | 0.0148 | 0.9126 | 0.0073 | 0.9045 |
| bg-2 | 0.0271 | 0.6027 | 0.0141 | 0.5677 |
| text / ink | 0.8628 | 0.0110 | 0.8789 | 0.0074 |
| text-dim | 0.4425 | 0.0746 | 0.4521 | 0.0500 |
| line | 0.3192 | 0.0110 | 0.2541 | 0.0074 |
| accent | 0.5450 | 0.4661 | 0.2931 | 0.1294 |
| accent-text | 0.5450 | 0.0726 | 0.2931 | 0.0818 |
| meter | 0.5450 | 0.1206 | 0.2931 | 0.1294 |
| ok | 0.5215 | 0.0769 | 0.5215 | 0.0769 |
| bad | 0.3686 | 0.0818 | 0.4670 | 0.0818 |
| info | 0.4342 | 0.0849 | 0.4342 | 0.0849 |
| focus-in `#0A0C12` | 0.0037 | | | |
| focus-out `#FFFFFF` | 1.0000 | | | |

CD = Classic dark, CL = Classic light, BD = Blood dark, BL = Blood light.

### 2.3 Every text/background pair and meaningful pixel border (computed)

Requirement: text >= 4.5:1, meaningful UI/graphics >= 3:1. All pass. "min" is the worst surface the token may sit on.

**Classic dark (CD)** surfaces (L + 0.05): bg-0 0.0575, bg-1 0.0648, bg-2 0.0771

| Pair | bg-0 | bg-1 | bg-2 | Need |
|---|---|---|---|---|
| text on surface | 15.87 | 14.09 | 11.85 | 4.5 |
| text-dim on surface | 8.57 | 7.60 | 6.39 | 4.5 |
| accent-text (= accent) on surface | 10.35 | 9.18 | 7.72 | 4.5 |
| ok on surface | 9.94 | 8.82 | 7.42 | 4.5 (text) / 3 (icon) |
| bad on surface | 7.28 | 6.46 | 5.43 | 4.5 |
| info on surface | 8.42 | 7.47 | 6.28 | 4.5 |
| line (frame) vs surface | 6.42 | 5.70 | 4.79 | 3 |
| meter vs field (bg-0) | 10.35 | | | 3 |

Component pairs: on-accent on accent 10.35; on-danger on danger 7.28; inv-text on inv-bg 15.87;
text-dim on field (bg-0) 8.57. Dithered page bg (bg-0 + 8% text, L 0.0194): text-dim 7.10, text 13.15.

**Classic light (CL)** surfaces: bg-0 0.7794, bg-1 0.9626, bg-2 0.6527 (L+.05)

| Pair | bg-0 | bg-1 | bg-2 | Need |
|---|---|---|---|---|
| text on surface (ink 0.0610) | 12.79 | 15.79 | 10.71 | 4.5 |
| text-dim (0.1246) on surface | 6.26 | 7.73 | 5.24 | 4.5 |
| accent-text `#6B4400` (0.1226) | 6.36 | 7.85 | 5.32 | 4.5 |
| ok `#125A34` (0.1269) | 6.14 | 7.59 | 5.14 | 4.5 |
| bad `#9E1B24` (0.1318) | 5.91 | 7.30 | 4.95 | 4.5 |
| info `#1F4EA6` (0.1349) | 5.78 | 7.14 | 4.84 | 4.5 |
| line = ink frame vs surface | 12.79 | 15.79 | 10.71 | 3 |
| meter `#8A5600` (0.1706) vs field bg-2 | | | 3.83 | 3 |

Component pairs: on-accent (ink) on accent amber 8.47; on-danger (bg-1) on danger `#9E1B24` 7.30;
inv-text on inv-bg 15.79. Accent amber vs bg-1 is 1.87 and vs bg-0 is 1.51, which is why the ink frame is
mandatory (frame vs surface above is 12.79+). Dithered page bg (ink 8%, L 0.6168): text-dim 5.35,
accent-text 5.44, text 10.94.

**Blood dark (BD)** surfaces: bg-0 0.0534, bg-1 0.0573, bg-2 0.0641 (L+.05)

| Pair | bg-0 | bg-1 | bg-2 | Need |
|---|---|---|---|---|
| text on surface | 17.39 | 16.20 | 14.48 | 4.5 |
| text-dim on surface | 9.40 | 8.76 | 7.83 | 4.5 |
| accent-text (= accent `#FF5A5A`) | 6.42 | 5.98 | 5.35 | 4.5 |
| ok on surface | 10.70 | 9.97 | 8.91 | 4.5 |
| bad `#FF9A9A` on surface | 9.68 | 9.02 | 8.06 | 4.5 |
| info on surface | 9.07 | 8.45 | 7.55 | 4.5 |
| line (frame) vs surface | 5.69 | 5.30 | 4.74 | 3 |
| meter vs field (bg-0) | 6.42 | | | 3 |

Component pairs: on-accent on accent 6.42; on-danger on danger 9.68; inv-text on inv-bg 17.39.
Dithered page bg (L 0.0123): text-dim 8.07, text 14.9.

**Blood light (BL)** surfaces: bg-0 0.7664, bg-1 0.9545, bg-2 0.6177 (L+.05)

| Pair | bg-0 | bg-1 | bg-2 | Need |
|---|---|---|---|---|
| text on surface (ink 0.0574) | 13.35 | 16.63 | 10.76 | 4.5 |
| text-dim (0.1000) on surface | 7.66 | 9.55 | 6.18 | 4.5 |
| accent-text / bad `#9E1B24` (0.1318) | 5.82 | 7.24 | 4.69 | 4.5 |
| ok `#125A34` | 6.04 | 7.52 | 4.87 | 4.5 |
| info `#1F4EA6` | 5.68 | 7.08 | 4.58 | 4.5 |
| line = ink frame vs surface | 13.35 | 16.63 | 10.76 | 3 |
| meter `#C4202A` (0.1794) vs field bg-2 | | | 3.44 | 3 |

Component pairs: on-accent (`#FFF1F0`) on accent red 5.32; on-danger on danger 7.24; inv-text on inv-bg
16.63. Dithered page bg (L 0.6047): text-dim 6.55, accent-text 4.97, text 11.4.

**Pressed-state overlay (14% `--lp-ink` checker over a filled control)** keeps text >= 4.5:
CD amber 7.87, CL amber 6.53, BD red 4.97, BL red 6.35.

**Sprites (graphical objects, 3:1):** steel `--lp-spr-s` vs surfaces: CD 6.42/5.70/4.79, CL (dim) 6.26/7.73/5.24,
BD 5.69/5.30/4.74, BL (dim) 7.66/9.55/6.18. Lock body `--lp-spr-b`: on dark schemes the fill carries
>= 5.35; on light schemes the continuous `--lp-spr-k` ink outline carries >= 10.7 (amber fill alone would
fail, so the outline is mandatory and must be unbroken). Accent pixels are never the only edge.
Lamp pixels are a redundant cue and are exempt.

**Disabled controls** are exempt from 1.4.3 but still render `--lp-text-dim` on `--lp-bg-2` (>= 5.24 in
all four schemes before dither) so they stay readable.

---------------------------------------------------------------------------------------------------

## 3. Typography

### 3.1 Latin display and UI font: **Pixelify Sans** (SIL OFL 1.1)
One family, self-hosted, no third-party requests.

Decision rationale for mobile legibility at 14 to 16px:
- Pixelify Sans is proportional with real lowercase, a generous x-height, and stems that stay
  distinguishable at 14 to 16px. It carries two weights (regular and bold), enough for headings vs body.
- Silkscreen: caps-led, lowercase is small caps on a 5px grid; fine for 3-word labels, tiring in a
  sentence. Rejected for body.
- VT323: narrow terminal face with a small x-height; at 14 to 16px it reads small and thin on phones
  (it is designed to be set at 20px+). Rejected.
- Press Start 2P: 8px-grid caps, very wide; "CLASSIC DIFFICULTY" overflows a 296px column, lowercase is
  weak, and it clashes with Arabic. Rejected (also the most overused 8-bit font).
This is a judgment call, not a measurement. SENTRY's 320px/390px screenshot pass is the acceptance test.
If body text fails it, the single permitted change is raising body from 16px to 18px; do not swap fonts.

Subset and budget (QUARTZ owns the build; these are the limits MUSE accepts):
- Unicode range: U+0020-007E, U+00A0, U+00B7, U+00D7, U+2022, U+2026. No Latin-1 letters, no Cyrillic.
- Keep only `kern`; drop other OpenType features and hinting.
- Preferred: ONE variable woff2 (wght instanced to 400..700), **<= 16 KB**.
  Fallback if that is larger: two static woff2 (400, 700), **<= 9 KB each**.
- Hard ceiling MUSE accepts: **20 KB woff2 total**. Over that, drop bold and synthesize emphasis with
  color/size instead; do not add a second family. I have not measured these sizes: they are budget limits,
  not facts. QUARTZ records the real number in `docs/perf.md`.
- `@font-face` with `font-display: swap`, one `<link rel="preload" as="font" type="font/woff2" crossorigin>`
  (BEACON/GRANITE add it in head). QUARTZ adds `size-adjust` / `ascent-override` on a local-font
  fallback face and verifies CLS < 0.1.
- `font-synthesis: none` on html (no faux bold or italic anywhere).
- Pixelify Sans has no italics and we never use italics.

Fallback stack (Latin):
`--lp-font-latin: "Pixelify Sans", ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace;`
A monospace fallback keeps the retro feel and similar widths if the font fails.

### 3.2 Arabic strategy (system fonts, no pixel Arabic font)
```
--lp-font-arabic: "Pixelify Sans", system-ui, "Segoe UI", Tahoma, "Noto Sans Arabic", "Droid Arabic Kufi", "Geeza Pro", sans-serif;
```
- Pixelify Sans is listed FIRST so Latin letters and digits inside Arabic strings (the brand name, "OPH",
  the digits 0-9) stay pixel; it has no Arabic glyphs, so Arabic falls through to the system font.
  This is the mixed-script trick: no extra font download.
- The pixel feel in Arabic comes from the frames, sprites, stamps and digits, not from letterforms.
  Prefer rectilinear system faces (Tahoma, Noto Sans Arabic, Droid Arabic Kufi) over calligraphic ones.
- Adjustments on `html[lang="ar"]` (set `--lp-text-scale: 1.125`; Arabic sits optically ~12% smaller than
  pixel Latin at the same px size):
  - Text tokens `--lp-fs-0..--lp-fs-3` multiply by `--lp-text-scale`. Dial digits, key digits, sprites,
    timer digits are Latin digits in the pixel font and do NOT scale.
  - `line-height: 1.7` body, `1.5` headings (prevents clipped dots and diacritics).
  - `letter-spacing: 0` and `text-transform: none` on all Arabic text. Tracking breaks letter joining.
    (The Latin caps style, section 3.3, is applied via `:lang(en)` only.)
  - Weight: 400 body, 700 buttons and headings (real bold in system fonts; `font-synthesis: none`).
  - Controls use `min-height`, never fixed `height`, and flex-center the label, so taller Arabic line boxes
    never clip inside a 48px button.
- **Digits are Western 0-9 everywhere in both languages.** Rationale: the 6-digit account code is entered
  on a numeric keypad and shared across devices; Eastern Arabic-Indic digits would break `pattern="[0-9]{6}"`
  and mismatch the dial glyphs. CIRCUIT must not localize digits.
- Direction rules (also section 5.0): the dial row, keypad, clue guess digits, code input, timer bar and
  code display are **always `direction: ltr`** (position 1 is the left dial in both languages, matching
  "position" clues). Surrounding sentences, headers, tabs, leaderboard columns follow `dir`.
  Digit runs inside RTL sentences are isolated (`unicode-bidi: isolate`, or `<bdi>`; CIRCUIT).

### 3.3 Scale (rem so user font-size and 200% zoom work; snapped near multiples of 4px)

| Token | Size | px @16 | Use |
|---|---|---|---|
| `--lp-fs-0` | 0.875rem | 14 | badges, chip text, captions (Latin caps style OK) |
| `--lp-fs-1` | 1rem | 16 | body, buttons, inputs (inputs must stay >= 16px, avoids iOS focus zoom) |
| `--lp-fs-2` | 1.25rem | 20 | clue sentences emphasis, tab labels, h3 |
| `--lp-fs-3` | 1.5rem | 24 | keypad digits, h2, score pop |
| `--lp-fs-4` | 2rem | 32 | h1 on mobile, stamp |
| `--lp-fs-5` | 2.5rem | 40 | h1 at >= 48em, dial digit (mobile), total score |
| `--lp-fs-6` | 3rem | 48 | dial digit at >= 48em, timer readout |

Ratio is about 1.25, rounded to 4px steps. Dial digit tokens: `--lp-fs-dial: var(--lp-fs-5)` (>= 48em: `--lp-fs-6`),
`--lp-fs-key: var(--lp-fs-3)`; neither is multiplied by `--lp-text-scale`.
- `--lp-lh-body: 1.4` (Arabic 1.7), `--lp-lh-tight: 1.15` (Arabic 1.5).
- Latin caps style (`:lang(en)`): buttons, tabs, badges, chips, table headers: `text-transform: uppercase;
  letter-spacing: 0.06em;` (`--lp-ls-caps: 0.06em`). Body prose stays sentence case.
- Measure: `max-inline-size: 60ch` for prose (help). Names and codes use `overflow-wrap: anywhere`.
- Weights: `--lp-fw-regular: 400; --lp-fw-bold: 700;`

### 3.4 Dial digits: **use the font, not a bitmap sprite set**
Decision: dial and keypad digits are real text in Pixelify Sans (set by CIRCUIT via `textContent`,
per the DOM contract; screen readers read them; zero extra bytes; selection and RTL work).
A 5x7 bitmap digit set (section 9.5) is specified but used only for decorative `aria-hidden` displays
(Home/Auth vault readout) and as Plan B if QUARTZ's subset makes font digits look soft. Grid for the
bitmap set: 5 columns x 7 rows, 1 art-pixel = 1 `--lp-px`, 1 art-pixel gap between digits.
Digits use `font-variant-numeric: tabular-nums` where the font supports it so dials never reflow.

---------------------------------------------------------------------------------------------------

## 4. The pixel grid system

### 4.1 Base unit
```
--lp-px: 4px;                                   /* fallback */
--lp-px: round(down, clamp(4px, 0.25vw + 1px, 6px), 1px);   /* integer-snapped, grows on big screens */
```
- Result: 4px from 320 up to ~1279px, 5px around 1600px, 6px from ~2000px to 2560px. `round()` keeps it an
  integer (crisp edges); browsers without `round()` keep the 4px fallback.
- `vw` shrinks with browser zoom, so at 200% zoom the unit is back to 4px; no unit change breaks 200% layouts.
- Everything pixel-drawn is a **whole multiple of `--lp-px`**: spacing, frames, sprites, timer segments.
  Text is the only element not locked to the grid.
- `--lp-bw: var(--lp-px);` frame thickness is exactly one unit. `--lp-radius: 0;` there is no other radius.

### 4.2 Spacing scale (all multiples of the unit)

| Token | Value | px @4 |
|---|---|---|
| `--lp-space-1` | `calc(var(--lp-px) * 1)` | 4 |
| `--lp-space-2` | `calc(var(--lp-px) * 2)` | 8 |
| `--lp-space-3` | `calc(var(--lp-px) * 3)` | 12 (default gap between controls) |
| `--lp-space-4` | `calc(var(--lp-px) * 4)` | 16 |
| `--lp-space-5` | `calc(var(--lp-px) * 6)` | 24 |
| `--lp-space-6` | `calc(var(--lp-px) * 8)` | 32 |
| `--lp-space-7` | `calc(var(--lp-px) * 12)` | 48 |
| `--lp-space-8` | `calc(var(--lp-px) * 16)` | 64 |

Layout tokens: `--lp-tap: calc(var(--lp-px) * 12)` (48px minimum control size; the DoD floor is 24px and
architecture.md requires 44px), `--lp-gutter: max(var(--lp-space-3), env(safe-area-inset-left))` (and a
matching right value; logical `padding-inline` with `max()` of the two inset sides), `--lp-container:
calc(var(--lp-px) * 256)` (1024px at 4px, 1280px at 5px), `--lp-icon: calc(var(--lp-px) * 8)` (32px),
`--lp-dir: 1` (`[dir="rtl"] { --lp-dir: -1; }`).
**Minimum gap between any two controls is `--lp-space-3` (12px).** This leaves the 4px frame bar of each
control plus the 8px focus ring (section 8) with no overlap.

### 4.3 Stepped-corner frame: the chosen technique
Chosen: **stacked `box-shadow` edge bars** (the corner pixel is simply never drawn).
Rejected: `clip-path: polygon(...)` (clips the focus outline and shadows, which would violate
"focus never obscured"; also needs per-size polygons), `border-image` (cannot use theme tokens, needs a
data-URI per color, breaks with `background-clip` corners). Box-shadow frames are drawn in CSS from tokens,
are symmetric (RTL safe), scale with the unit (200% zoom safe), do not clip the outline, and add no layout size.

Recipe (PRISM implements as one reusable rule, e.g. `.lp-frame` in a `components` layer):
```css
.lp-frame {
  --_c: var(--lp-line);
  --lp-shadow-frame:
    0 calc(var(--lp-bw) * -1) 0 0 var(--_c),          /* top bar    */
    0 var(--lp-bw) 0 0 var(--_c),                     /* bottom bar */
    calc(var(--lp-bw) * -1) 0 0 0 var(--_c),          /* start bar  */
    var(--lp-bw) 0 0 0 var(--_c);                     /* end bar    */
  box-shadow: var(--lp-shadow-frame);
  margin: var(--lp-bw);        /* the bars live outside the box, reserve their room */
  border: 0; border-radius: 0;
}
```
Why this gives a stepped corner: each shadow is a copy of the box shifted by one unit on one axis, so each
bar covers only the edge length; the four diagonal corner pixels are never painted. Result: a 1-unit
outline with a 1-unit notch at each corner, the NES/Game Boy "rounded" corner.
Rules:
- Parent containers must leave `>= --lp-bw` of room (`gutter` already does) and must not use
  `overflow: hidden` on an ancestor of a framed control (it would cut the bars). Use `overflow: clip` with
  `overflow-clip-margin: var(--lp-bw)` if clipping is unavoidable.
- Box-shadow does not add scroll overflow, so no horizontal scroll from frames.
- Panels (non-interactive) use the same recipe with `--_c: var(--lp-line-soft)`. Interactive controls always
  use `--lp-line` (meaningful, >= 3:1).
- There is exactly ONE corner size (the 1-step notch) everywhere: buttons, dials, panels, dialogs,
  stamps (shape lock). Do not invent a bigger 2-step corner; `inset` ring shadows are not allowed
  because they draw a square (unnotched) ring.
- Forced colors: `@media (forced-colors: active) { .lp-frame { box-shadow: none; border: 2px solid CanvasText; margin: 0 } }`
  because box-shadows are removed in forced-colors mode.

### 4.4 Raised and pressed buttons
Raised ("ledge"): a solid lip one unit below the frame.
```css
--lp-shadow-ledge: 0 calc(var(--lp-bw) * 2) 0 0 var(--lp-ledge);   /* listed AFTER the frame bars */
.lp-btn { box-shadow: var(--lp-shadow-frame), var(--lp-shadow-ledge); }
```
Pressed (`:active`, or `[aria-pressed="true"]`): the control sinks one unit and loses its ledge:
```css
.lp-btn:active { translate: 0 var(--lp-bw); box-shadow: var(--lp-shadow-frame);
  background-image: conic-gradient(color-mix(in srgb, var(--lp-ink) 14%, transparent) 25%, transparent 0 50%,
                    color-mix(in srgb, var(--lp-ink) 14%, transparent) 0 75%, transparent 0);
  background-size: calc(var(--lp-px) * 2) calc(var(--lp-px) * 2); }
```
(The 14% ink checker is the only "shading" in the system; contrast stays >= 4.5, see 2.3.)
Hover (only inside `@media (hover: hover)`): frame color `--lp-line` becomes `--lp-text`. No movement.
Inset (dials, inputs): add `inset 0 var(--lp-bw) 0 0 color-mix(in srgb, var(--lp-ink) 40%, transparent)` as the top inner shade.
Transitions on these states: none (state changes are instant; pixel UI does not tween).

### 4.5 Sprites and `image-rendering`
- SVG sprites: `shape-rendering="crispEdges"` on the root `<svg>`; consumers size with
  `inline-size/block-size: calc(var(--lp-px) * <art-width>)`. Never fractional sizes, never `transform: scale()`
  to resize a sprite.
- Any raster fallback or raster asset (PNG icon, OG art):
  ```css
  img, canvas { image-rendering: pixelated; image-rendering: crisp-edges; } /* second line for old Firefox */
  ```
  Raster pixel art is exported at an integer multiple (4x) of its native grid; the browser never interpolates.
- Every sprite has explicit `width`/`height` (CLS) and is `aria-hidden="true"` when decorative, otherwise carries
  an accessible name on its button (icon-only buttons: `aria-label`, never `title` alone).

### 4.6 Texture: dither and scanlines (pure CSS, subtle, contrast-safe)
Dither (page background only, never under a text panel):
```css
body { background:
   conic-gradient(var(--lp-dither) 25%, transparent 0 50%, var(--lp-dither) 0 75%, transparent 0)
   0 0 / calc(var(--lp-px) * 2) calc(var(--lp-px) * 2),
   var(--lp-bg-0); }
```
This is a 2x2 checker with 1-unit cells at 8% of the text color. The worst-case cell luminance was used
for the "dithered page bg" contrast figures in 2.3 (all >= 4.5 for text and dim text).
Disabled controls and skeleton rows use a stronger 2x2 checker at 14% `--lp-ink`.
Dither shadow for dialogs (elevation 2): a `::before` pseudo-element, `inset: 0`, `z-index: -1`,
`translate: calc(var(--lp-dir) * var(--lp-px) * 2) calc(var(--lp-px) * 2)`, same checker at 50% `--lp-ink`.
Scanlines (**dark schemes only**, only behind `--lp-text` / `--lp-accent-text` content such as the timer
readout and the vault window; never behind `--lp-text-dim`):
```css
.lp-screen::after { content:""; position:absolute; inset:0; pointer-events:none;
  background: repeating-linear-gradient(to bottom, transparent 0 calc(var(--lp-px) - 1px),
              color-mix(in srgb, var(--lp-ink) 18%, transparent) 0 var(--lp-px)); }
```
On dark surfaces the lines darken the background, so contrast only goes up. Light schemes get dither
only (a halftone paper feel), no scanlines, because darkening a light background lowers contrast of
dark text.
Switch-offs:
- `@media (prefers-contrast: more)`: remove dither, scanlines and `--lp-line-soft` decor; `--lp-text-dim`
  becomes `--lp-text`; frames thicken to 2 units.
- `@media (forced-colors: active)`: remove all textures and sprites' color tokens use `CanvasText`.
- `@media (prefers-reduced-transparency: reduce)`: `--lp-scrim` becomes solid.
- Textures are static, so `prefers-reduced-motion` does not need to remove them.
- Never apply textures to scrolling containers as a fixed-position full-viewport layer; the body background
  paints once. No SVG noise filter, no `mix-blend-mode`, no animated texture.

### 4.7 Elevation (no blur, ever)
- E0: flat (page).
- E1: panel/button: frame bars + 2-unit ledge (`--lp-shadow-ledge`), interactive controls only.
- E2: dialog and toast: frame bars + dither offset shadow (4.6).
- z-index scale: `--lp-z-header: 10; --lp-z-dock: 20; --lp-z-toast: 40;` dialogs use `<dialog>` top layer.

### 4.8 Page chrome
- `html { color-scheme: dark light; }` `min-block-size: 100dvh` (never `100vh`).
- Hairline decoration between sections: a dashed pixel rule, `background: linear-gradient(to right,
  var(--lp-line-soft) 50%, transparent 0) bottom / calc(var(--lp-px) * 2) var(--lp-px) repeat-x`.
- Corner bolts on panels are optional decoration: 2x2-unit `--lp-spr-h` squares at the four inner corners
  via `::before` / `::after` and multiple backgrounds; omit them under `prefers-contrast: more`.
- Blood mode only: a 1-unit hazard strip under the header, a 2x2 checker of `--lp-accent` and `--lp-bg-0`
  (static; `repeating-conic-gradient`). Decorative, `aria-hidden`.

---------------------------------------------------------------------------------------------------

## 5. Layout concept per screen

### 5.0 Global rules
- Viewport meta is `width=device-width, initial-scale=1, viewport-fit=cover`. ATLAS/BEACON may also add
  `interactive-widget=resizes-content` so the auth keyboard shrinks the layout viewport instead of covering
  the submit button (route via ATLAS, see NEXT).
- Breakpoints in `em` (they follow user font size and zoom): compact `< 22.5em` (360px), `>= 30em` (480),
  `>= 48em` (768), `>= 64em` (1024), `>= 80em` (1280). Prefer container queries inside components.
- `main` content: `inline-size: min(100%, var(--lp-container))`, `margin-inline: auto`,
  `padding-inline: var(--lp-gutter)`, `padding-block-end: max(var(--lp-space-4), env(safe-area-inset-bottom))`.
  All side padding uses `env(safe-area-inset-*)` via `max()`.
- No horizontal scroll 320 to 2560: grids use `minmax(0, 1fr)`; long strings `overflow-wrap: anywhere`;
  the widest rigid element on any screen is the 5-dial row at 296px (see 5.3).
- Header (all screens): brand sprite + wordmark | language toggle | sync chip | account menu. Height
  `calc(var(--lp-px) * 14)` (56px); on Play it is `calc(var(--lp-px) * 12)` (48px). Under 360px the
  wordmark is visually hidden (the lock sprite keeps the accessible name) and the sync chip shows icon only
  (its text stays in the accessible name).
- Footer: one line, `Made by OPH` link (`--lp-accent-text`, underlined, >= 48px tall hit area via padding),
  bottom padding includes the safe-area inset.
- RTL: mirrored by logical properties only (`inline-start/end`, `margin-inline`, grid order). The
  `arrow-left` sprite flips with `[dir="rtl"] .lp-icon--flip { scale: -1 1 }`. Exceptions that never flip:
  dial row, keypad, guess digits, code input, timer bar, compare icon (math direction is not language
  direction).

### 5.1 Auth (`data-screen="auth"`)
Top-aligned (not vertically centered) so the on-screen keyboard never hides the submit button.
```
390px
+----------------------------------------+
| [L] LOCK PUZZLE       [EN|AR] [v] [me] |  header 56
+----------------------------------------+
|                                        |
|              +--------+                |
|              | VAULT  | 96x96          |  vault-door sprite, lamp idle
|              +--------+                |
|        CRACK THE CODE        (h1 32)   |  TODO(content)
|   Name + 6-digit code. No email.       |  fs-1, dim
|                                        |
|   [ SIGN UP ][ SIGN IN ]  segmented    |  show-signup / show-signin
|                                        |
|   NAME                                 |  label above input
|   [______________________] 20 max      |
|   ! error line (bad + x icon)          |
|                                        |
|   [        CREATE ACCOUNT        ]     |  primary, full width
+----------------------------------------+
| Made by OPH                            |
+----------------------------------------+
```
- 320px: wordmark hidden; vault sprite hidden when `max-height: 600px` (keyboard-up and short phones);
  controls full width; segmented control stays 2 columns (each >= 48px tall, label wraps to 2 lines max).
- Sign-in adds the CODE field: 6 digits, `font-size: var(--lp-fs-3)`, `letter-spacing: 0.3em` (LTR forced),
  `inline-size: 100%`, still >= 16px so iOS does not zoom.
- After sign-up the `code` dialog shows the 6 digits at `--lp-fs-5`, in a framed `--lp-field` box, with
  COPY (secondary) and "I SAVED IT" (primary, full width). Warning text (code cannot be recovered):
  `TODO(content)`.
```
768px                                            1280px (same, wider gutters)
+---------------------------------------------+ +------------------------------------------+
| header                                      | | header                                   |
|  +----------------+  +--------------------+ | |   +------------+   +------------------+  |
|  |  VAULT 96 + h1 |  | [SIGN UP][SIGN IN] | | |   | VAULT 96+h1|   | segmented + form |  |
|  |  blurb         |  | form panel (framed)| | |   | blurb      |   | panel max 28rem  |  |
|  +----------------+  +--------------------+ | |   +------------+   +------------------+  |
| Made by OPH                                 | | Made by OPH                              |
+---------------------------------------------+ +------------------------------------------+
```
Two columns from 48em (`grid-template-columns: minmax(0, 1fr) minmax(0, 28rem)`), vault column sticky top.

### 5.2 Home (`data-screen="home"`)
```
390px
+----------------------------------------+
| header                                 |
+----------------------------------------+
| +------------------------------------+ |
| | HI, NAME                  [cup] 1240| |  panel (frame line-soft)
| | CLASSIC 980        BLOOD BEST 260   | |  fs-0 caps labels, fs-3 numbers
| +------------------------------------+ |
| DIFFICULTY                             |
| [ROOKIE  3][ AGENT 4]                  |  radio-like segmented, 2 x 2,
| [HACKER  4][MASTER 5]                  |  each shows digit count
| [       PLAY CLASSIC   >        ]      |  primary (amber), 56px
| [ (skull) BLOOD POINT   3:00    ]      |  scoped data-mode="blood" button
| [  BOARD  ] [ HOW TO PLAY ]            |  ghost row
+----------------------------------------+
| Made by OPH                            |
+----------------------------------------+
```
- `data-slot="difficulty-picker"` renders a radio group (native radios visually restyled; frame + selected
  state `--lp-accent` fill with `--lp-on-accent`). Names and digit counts come from `config.js`; never
  hardcode here.
- The Blood button sets `data-mode="blood"` on itself so it uses the red tokens on the amber page. Its
  frame (BD line) vs Classic bg-1 is 4.69:1 (dark) and ink-on-light in the light scheme: passes.
- 320px: ghost row stacks (2 full-width buttons). Totals wrap to two lines; no truncation.
- 768px: two columns, left = stats panel + difficulty, right = the two PLAY buttons (large, stacked),
  ghost row under. 1280px: same, container capped at `--lp-container`, vault door hero (96px) above the stats.
```
768px
+---------------------------------------------------------+
| header                                                  |
| +---------------------------+  +-----------------------+ |
| | HI, NAME     [cup] 1240   |  | [  PLAY CLASSIC  >  ] | |
| | CLASSIC 980  BLOOD 260    |  | [ (skull) BLOOD     ] | |
| | DIFFICULTY  [R][A][H][M]  |  | [BOARD] [HOW TO PLAY] | |
| +---------------------------+  +-----------------------+ |
| Made by OPH                                             |
+---------------------------------------------------------+
```

### 5.3 Play (`data-screen="play"`): the screen that must be perfect
Structure: header (48px) / status strip / clue list (scrolls) / **dock** (sticky bottom, thumb zone).
`section[data-screen="play"] { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto;
min-block-size: calc(100dvh - header); }` The clue list is the only scroller; the dock never scrolls away.
```
390 x 844 (full-height phone)
+----------------------------------------+
| header 48                              |
+----------------------------------------+
| [CLASSIC] ROOKIE #12   TRIES [#][#][ ] |  status strip (badge, difficulty, no., tries)
| [bulb HINT] [SKIP]            [mute]   |  utility row, each >= 48 tall
+----------------------------------------+
| CLUES                       (scrolls)  |
| +------------------------------------+ |
| | #3 | 4 1 7 2 |  [#][#] [ ]         | |  feedback clue
| |    | 2 right place, 1 misplaced     | |
| +------------------------------------+ |
| | #2 | [sum] Digits add up to 17      | |  sum clue
| +------------------------------------+ |
| | #1 | [par] Digit 2 is even          | |
| +------------------------------------+ |
|                                        |
+========================================+  dock: --lp-bg-1, top frame bar
| [lock] Pick a dial, then a number      |  64px lock sprite + msg (aria-live)
|  [ 4 ][ 1 ][ _ ][ _ ]                  |  dials 48-72 x 64
|  [1][2][3][4][5]                       |  keypad 5 x 2, keys 48 x 56
|  [6][7][8][9][0]                       |
|  [  CLEAR  ][      CHECK  >       ]    |  56 tall; CHECK is 2fr
+----------------------------------------+  + safe-area-inset-bottom
```
Dock height budget at 390x844: msg row 64 + 12 + dials 64 + 12 + keys 124 + 12 + actions 56 + padding
24 + safe-area 34 = about 402px. Header 48 + strip 96 = 144. Clue area = 844 - 546 = about 298px. OK.

Compact rule (`max-height: 700px`, e.g. iPhone SE 320x568): the lock+msg row merges into the strip (lock
sprite hidden, msg stays as text), dial height 56, key height 48, gaps 8 (never below 8: ring + frame still
fit), action height 48. Dock = 56 + 8 + 104 + 8 + 48 + 16 padding = about 240px; header 48 + one-row strip 48;
clue area at 568 = about 232px. Verified arithmetic, not yet a browser measurement.

**Dial row never wraps (320 to 5 digits):** with gutter 12px, inner width is 296px. Frame bars sit outside
each box, so the row is `inline-size: min(100%, ...)`; each dial is `minmax(0, 1fr)` capped at 72px; gap
`--lp-space-3` (12px). Arithmetic at 320: boxes = (296 - 8 outer bar room - 4 x 12 gaps) / 5 = **48px each**
(>= 44), bars never overlap. The 5-dial row and the 5-key keypad row share the same column grid
(`repeat(5, minmax(0, 1fr))`), so keys sit visually under dials. With 3 or 4 dials the row is centered and
each dial is `min(72px, 100%)`; `grid-template-columns: repeat(var(--lp-n), minmax(0, 72px))`,
`justify-content: center` (CIRCUIT sets `--lp-n`). The row is `direction: ltr`.

Landscape phones (`orientation: landscape and max-height: 500px`): two columns, clues left, dock right
(max 22rem), the dock becomes `position: static` and scrolls with the right column.
`scroll-padding-block-end: var(--lp-dock-h)` and `scroll-padding-block-start: header` on the clue scroller
so focused clue items are never hidden under the dock (DoD 3, focus never obscured).
```
768px                                                       1280px (container 1024)
+---------------------------------------------------------+ +-------------------------------------------+
| header                                                  | | header                                    |
| [CLASSIC] ROOKIE #12   [HINT][SKIP]  TRIES [#][#][ ]    | | [CLASSIC] ROOKIE #12 [HINT][SKIP] TRIES.. |
| +---------------------------+ +-----------------------+ | | +----------------------+ +--------------+ |
| | CLUES (scrolls)           | | [lock 64]  message    | | | | CLUES (scrolls)      | | [vault 96]   | |
| | #3 4 1 7 2  [#][#][ ]     | | [ d ][ d ][ d ][ d ]  | | | | #3 ...               | | message      | |
| | #2 [sum] ...              | | keypad 5 x 2          | | | | #2 ...               | | dials 72x80  | |
| | #1 [par] ...              | | [CLEAR][   CHECK   ]  | | | |                      | | keypad       | |
| +---------------------------+ +-----------------------+ | | +----------------------+ | [CLEAR][CHK] | |
| Made by OPH                                             | | Made by OPH              +--------------+ |
+---------------------------------------------------------+ +-------------------------------------------+
```
Two columns from 48em: `grid-template-columns: minmax(0, 1fr) minmax(0, 22rem)`; the console column is
`position: sticky; top: header + space-3`. At 1280 the console column is 28rem, dials 72x80, and the
vault door (96px) replaces the 64px lock as the lock host. Hardware keyboard works (architecture.md); keys
show a pressed state when their digit is typed.

Blood timer placement: in the status strip, right side, replaces TRIES (Blood has no attempt cap; layout
slot is shared). Timer bar spans the full strip width under the strip (216px at 4px; it centers).

### 5.4 Result (`data-screen="result"`)
```
390px (Classic success)
+----------------------------------------+
| header                                 |
|            [lock-open 64]              |
|   +--------------------------------+   |
|   |        ACCESS GRANTED          |   |  stamp: h1 fs-4, framed, ok-colored frame + check icon
|   +--------------------------------+   |
|            +150 PTS  (score pop)       |  fs-5, accent-text
|  [clock] 0:42  [x] 1 wrong  [bulb] 0   |  icon summary row (time, wrong, hints)
|  BASE ............................ 100 |  ledger rows (data-slot=result-lines),
|  SPEED BONUS ..................... +60 |  dotted leaders; values from scoring.js,
|                                        |  labels TODO(content); numbers here are layout samples only
|  ACCURACY ........................ -10 |
|  TOTAL ........................... 150 |
|  [      NEXT PUZZLE  >        ]        |  primary
|  [  HOME  ] [  BOARD  ]                |  secondary, ghost
+----------------------------------------+
```
- Failure/quit: stamp "LOCKED OUT" with x icon and `--lp-bad` frame; primary button is RETRY.
- Blood end: stamp "TIME UP" (skull sprite, red tokens); ledger = puzzles solved, points, best run;
  buttons RETRY (primary), HOME, BOARD. New best: a `trophy` sprite beside the total.
- Ledger rows are `<dl>` pairs on a 2-column grid with a dashed-pixel leader (4.8). Numbers right-aligned in
  `direction: ltr; unicode-bidi: isolate` cells.
- 320px: buttons stack full width. 768/1280: single centered column `max-inline-size: 36rem`, lock sprite
  swaps to the 96px vault door.

### 5.5 Board (`data-screen="board"`)
```
390px
+----------------------------------------+
| header                                 |
| [cup] LEADERBOARD   (h1)               |
| [ ALL-TIME ][  BLOOD  ]  tablist       |  tabs 50/50, each >= 48 tall
| #   PLAYER               PTS           |  <th> fs-0 caps, dashed rule
| 1   ZED                  2,410         |
| 2   MAYA                 2,180         |
| 3   ...                                |
| 14  YOU  [YOU]             980         |  own row: accent-text bar + YOU badge
| [  BACK  ]                             |
+----------------------------------------+
```
- Real `<table>`; 3 columns; rank column fits "100+" (4ch), points right-aligned LTR, player column
  `minmax(0, 1fr)` and wraps (`overflow-wrap: anywhere`), so 20-character names never clip at 320.
- Own row: `--lp-bg-2` fill, 1-unit `--lp-accent` start bar plus the text badge "YOU" (never color only).
- Empty: trophy sprite + one sentence + "PLAY" button. Loading: 5 skeleton rows using the disabled 14%
  checker (static; no shimmer). Offline: status chip + message + RETRY button.
- 768: table `max-inline-size: 40rem` centered. 1280: table 40rem centered with a side panel for the
  player's own stats (`TODO(content)` whether this exists; default omit).

### 5.6 Help (`data-screen="help"`)
Prose screen. Single column, `max-inline-size: 60ch`, sections as `h2` with a dashed pixel rule, no accordion
needed. Content (copy by CIRCUIT, numbers from config, `TODO(content)`):
1. Goal. 2. How to read clues, with a **legend**: pip right-place (filled 3-unit square, `--lp-ok`) vs wrong-place (hollow
3-unit square, `--lp-info`), and the four icon clue kinds (sum, parity, compare, even-count) each beside one
sentence. 3. Scoring (from `scoring.js` constants). 4. Blood Point (3:00, penalties and multiplier from `BLOOD`).
5. Your code (cannot be recovered; keep it private).
```
390px
+----------------------------------------+
| header                                 |
| HOW TO PLAY  (h1)                      |
| GOAL                                   |
| text...                                |
| READING CLUES                          |
| [#] right digit, right place           |
| [ ] right digit, wrong place           |
| [sum] ... [par] ... [cmp] ... [cnt]    |
| ...                                    |
| [  BACK  ]                             |
+----------------------------------------+
```
768/1280: same column, centered; legend becomes a 2-column grid from 48em.

---------------------------------------------------------------------------------------------------

## 6. Component inventory with states

Global component rules: radius 0; frame via 4.3; min target 48x48 (`--lp-tap`); labels never truncate;
state changes are instant (no transitions) except where section 7 specifies stepped animation.
Disabled uses the 14% checker fill + `--lp-text-dim` text, `cursor: not-allowed`, and the native `disabled`
attribute (so it is out of the tab order and announced).

### 6.1 Button (`.lp-btn` variants: primary, secondary, danger, ghost)
Size: `min-block-size: var(--lp-tap)`, `padding-inline: var(--lp-space-4)`, `font: 700 var(--lp-fs-1)`; large variant
56px for PLAY and CHECK. Label on one line at desktop; on 320 may wrap to two (never clipped; `min-height` grows).

| Variant | Fill | Text | Frame | Ledge |
|---|---|---|---|---|
| primary | `--lp-accent` | `--lp-on-accent` | `--lp-line` | `--lp-ledge` |
| secondary | `--lp-bg-2` | `--lp-text` | `--lp-line` | `--lp-ledge` |
| danger | `--lp-danger` | `--lp-on-danger` | `--lp-line` | `--lp-ledge` |
| ghost | transparent (on bg) | `--lp-text` | `--lp-line` (frame always present) | none |

| State | Treatment |
|---|---|
| default | as table |
| hover (pointer only) | frame -> `--lp-text` |
| active | sink 1 unit, ledge removed, 14% ink checker (4.4) |
| focus-visible | two-layer ring (section 8); no other change |
| disabled | `--lp-bg-2` fill + 14% checker, `--lp-text-dim` text, no ledge, frame `--lp-line-soft` |
| `aria-busy` | label unchanged; a 3-step "..." suffix (static "..." under reduced motion) |
Pairs: primary 10.35 / 8.47 / 6.42 / 5.32; danger 7.28 / 7.30 / 9.68 / 7.24 (CD / CL / BD / BL); secondary text 11.85 / 10.71 / 14.48 / 10.76.
Icon-only buttons (lang toggle, account, mute, back): 48x48, 32px sprite centered, `aria-label` required.

### 6.2 Dial (`button`, `data-state="idle|selected|filled|correct|wrong"`)
Size: inline `minmax(0, 72px)` (48 at 320 with 5 digits), block `--lp-dial-h: calc(var(--lp-px) * 16)` (64px; 56 compact; 80 at >= 80em).
Digit: `--lp-fs-dial`, Latin pixel font, `--lp-text`, centered. Inset shading per 4.4.

| State | Look |
|---|---|
| idle (empty) | `--lp-bg-2` fill, `--lp-line` frame, a 3-unit-wide dim underscore bar as placeholder (`::after`, `--lp-text-dim`) |
| selected | `--lp-accent` fill, `--lp-on-accent` digit, frame `--lp-line`, plus a 1-unit bar under the digit (a non-color cursor cue) |
| filled | `--lp-bg-2` fill, `--lp-text` digit, frame `--lp-line` |
| correct | filled look + frame `--lp-ok` + 8px check sprite in the corner (the ok frame is >= 4.9 on bg-1 in all schemes) |
| wrong | filled look + frame `--lp-bad` + 8px x sprite in the corner; shake (7.2) |
| disabled (after solve) | disabled treatment |
Keyboard/AT: hooks and ARIA belong to GRANITE/CIRCUIT. PRISM styles `[data-state]` only.

### 6.3 Keypad key (`button[data-digit]`)
Grid `repeat(5, minmax(0, 1fr))`, 2 rows, gap 12 (compact 8), key `min-block-size: calc(var(--lp-px) * 14)` (56; compact 48).
Digit `--lp-fs-key` (24px). Same states as a secondary button, plus: the key flashes its pressed look for
the duration of a hardware key press (CIRCUIT toggles `data-pressed`, or relies on `:active`). Digits already
used (when repeats are not allowed) are NOT disabled by color alone: `aria-disabled` + checker + dim digit
(only if CIRCUIT implements it; default no restriction).

### 6.4 Clue card (`li[data-kind]`)
Container: `--lp-bg-2` fill, 1-unit start bar in `--lp-line-soft` (decorative), no full frame (no nested frames inside a framed panel),
padding `--lp-space-3`, grid: `[no] [body]`. Index "#3" `--lp-text-dim` fs-0. Newest clue on top; a "fresh" clue has its
start bar in `--lp-accent` for the first view (static, no animation). `container-type: inline-size` on the list.

| Kind | Body |
|---|---|
| feedback | Row 1: guess digits as 32x32 boxes (`--lp-field` fill, `--lp-line` 1-unit frame, `--lp-text` digit, `direction: ltr`), then pips. Row 2 (always present): sentence "N right place, M misplaced" in `--lp-text-dim`. If both 0: "none" with the x sprite. |
| sum | `sum` 8x8 sprite (`--lp-text`) + sentence "The digits add up to N" |
| parity | `parity` sprite + "Digit P is even / odd" |
| compare | `compare` sprite (flipped via `[data-rel="lt"] { scale: -1 1 }` physically, never by `dir`) + "Digit A is greater / less than digit B" |
| evenCount | `even-count` sprite + "N digits are even" |
Pips: 3-unit squares (12px), gap 1 unit. **Right place** = filled `--lp-ok`. **Wrong place** = hollow: 1-unit frame
`--lp-info`, transparent center. Shape (filled vs hollow) carries the meaning; color is secondary. Pips order: right first, then wrong.
Pip colors on bg-2: ok 7.42 / 5.14 / 8.91 / 4.87; info 6.28 / 4.84 / 7.55 / 4.58 (CD / CL / BD / BL), all >= 3.
Container query: `@container (min-width: 22rem)` pips sit inline after the digits; below that they wrap to row 2 before the sentence
(5 digit boxes at 32px + 4 gaps = 176px already leaves no room for pips at 296px).

### 6.5 Input (`input[data-field]`, label above, error below)
`min-block-size: var(--lp-tap)`, `font-size: var(--lp-fs-1)` (>= 16px), fill `--lp-field`, `--lp-text` text, placeholder `--lp-text-dim`
(8.57 / 5.24 / 9.40 / 6.18 on the field), frame `--lp-line` + inset top shade.

| State | Look |
|---|---|
| default | as above |
| focus-visible | ring (section 8) |
| invalid | frame `--lp-bad`, error line below: x sprite + sentence in `--lp-bad` (6.46 / 7.30 / 9.02 / 7.24 on bg-1) |
| disabled | checker fill, dim text |
Labels are always visible (`--lp-text`, fs-1 caps in Latin). Placeholder is never the label. Helper text `--lp-text-dim`.

### 6.6 Tabs (`role="tablist"`: All-time / Blood)
Two framed buttons sharing the frame bars with a 1-unit gap. Selected: `--lp-accent` fill + `--lp-on-accent` label + a lowered
ledge (appears pressed in). Unselected: `--lp-bg-2` fill + `--lp-text`. The Blood tab uses `data-mode="blood"` locally
so its selected fill is red. Selected is also marked by the leading check sprite (not color alone). Min 48px tall.

### 6.7 Badge (`[data-mode-badge]`)
Inline, `min-block-size: 32px`, padding `--lp-space-2`/`--lp-space-3`, fs-0 caps, `--lp-bg-2` fill, 1-unit `--lp-line` frame, `--lp-text` label.
CLASSIC: text only (no 8x8 lock exists and a 16x16 sprite is never scaled down). BLOOD POINT: skull sprite, local `data-mode="blood"`, label `--lp-accent-text` (6.42 / 5.82 on bg-0 in dark/light).
A badge is not interactive, so the 24x24 target rule does not apply; it still must not be the only carrier of the mode (the page also changes theme).

### 6.8 Toast (`role="status"`)
Bottom of the viewport above the dock: `inset-block-end: calc(dock-h + var(--lp-space-3))` (Play) or `max(space-4, safe-area)` elsewhere,
`z-index: var(--lp-z-toast)`, `max-inline-size: min(100% - 2 * gutter, 28rem)`. `--lp-inv-bg` fill with `--lp-inv-text`
(15.87 / 15.79 / 17.39 / 16.63), 1-unit `--lp-line` frame, icon sprite by tone (`data-tone="ok|bad|info"`: check, x, clock),
message sentence, optional dismiss button 48x48. Auto-dismiss at 4s unless it carries an action (WCAG 2.2.1: actions
persist until dismissed). Enters with the 2-step slide (7.4); instant under reduced motion. Never flashes.

### 6.9 Dialog (native `<dialog>`: code, confirm-logout, confirm-quit)
`inline-size: min(100% - 2 * var(--lp-gutter), 28rem)`, `max-block-size: calc(100dvh - 2 * var(--lp-gutter))`, `overflow: auto`,
`--lp-bg-1` fill, `--lp-line` frame, E2 dither shadow. `::backdrop`: `--lp-scrim`. Title `h2` fs-3, body fs-1, actions in a column on
compact (full-width buttons, 12px gaps), a row (`justify-content: end`) from 30em. Danger confirm uses the danger button, cancel is
secondary and is first in DOM order and focused by default (destructive action is not the default). `code` dialog: 6-digit field per 5.1.

### 6.10 Timer bar (Blood only; classic shows plain elapsed text)
Contract: `data-out="timer"` text (e.g. `2:41`) next to a bar. CIRCUIT sets `--lp-timer-left` (integer 0..18, one segment = 10s) on the bar and
`data-phase="normal|last30|last10"`.
```
--lp-seg: calc(var(--lp-px) * 3);                          /* 12px: 2 units fill + 1 unit gap */
bar:  inline-size: calc(var(--lp-seg) * 18); block-size: calc(var(--lp-px) * 4); direction: ltr;
      background: repeating-linear-gradient(to right, var(--lp-line-soft) 0 calc(var(--lp-seg) - var(--lp-px)),
                  transparent 0 var(--lp-seg)), var(--lp-field);        /* empty segments */
fill: ::before { inline-size: calc(var(--lp-timer-left) * var(--lp-seg)); block-size: 100%;
      background: repeating-linear-gradient(to right, var(--lp-meter) 0 calc(var(--lp-seg) - var(--lp-px)),
                  transparent 0 var(--lp-seg)); }
```
- 18 segments x 12px = 216px at 4px unit, 270 at 5, 324 at 6; fits 296 at 320. Integer segment widths, so no sub-pixel seams.
- Frame: standard `.lp-frame`, `--lp-line`. Filled segments vs field: 10.35 / 3.83 / 6.42 / 3.44 (CD / CL / BD / BL), all >= 3.
- Drains from the end: segments disappear one per 10s in 1-segment steps (instant, no tween). The bar is graphic only; the time is the
  text readout beside it (`--lp-fs-6`, `--lp-text`, on a `.lp-screen` for scanlines in dark schemes), so assistive tech uses text.
- `last30`: readout becomes bold `--lp-accent-text` and the leading icon swaps clock -> skull; segments gain a 2x2 dither hatch (14% `--lp-ink`)
  so the change is not color-only. `last10`: adds the pulse (7.3). Frame becomes 2 units thick in `last10` under reduced motion (static cue).
- Blood theme already uses red; the last-30 change is therefore structural (hatch + icon + weight), not a hue change.

### 6.11 Status chip (`data-status="synced|saving|offline|local"`)
Header chip: 32px tall (a non-interactive indicator, so no 48px target), `--lp-bg-2` fill, 1-unit `--lp-line-soft` frame, icon + label `--lp-text` fs-0.
Label always present in the accessible name; visible text hidden under 360px (icon only).

| Status | Icon (8x8) | Icon color | Label |
|---|---|---|---|
| synced | check | `--lp-ok` | SYNCED |
| saving | clock | `--lp-info` | SAVING (the trailing "..." steps in 3 frames; static under reduced motion) |
| offline | x | `--lp-bad` | OFFLINE |
| local | user | `--lp-text-dim` | LOCAL |
Icon vs bg-2 >= 4.58 in every scheme. Labels are `TODO(content)` in i18n. If the chip is made a button (open details), it becomes 48px.

### 6.12 Score pop
`+N` in `--lp-fs-5`, `--lp-accent-text` (10.35 / 6.36 / 6.42 / 5.82 on bg-0), 1-unit text frame not needed. Appears over the result total
or over the dock after CHECK succeeds in Blood (`+N` per puzzle). Animation in 7.1. Reduced motion: appears in place for 1500ms then hides.
Value is always also in the live region (`data-out="score"`), the pop is decoration (`aria-hidden`).

---------------------------------------------------------------------------------------------------

## 7. Motion

Principles: tiny, stepped, motivated (feedback or state change only), never infinite except the 1 Hz Blood pulse, never animating layout.
Animate only `transform`/`translate`, `opacity`, `background-position`, `color`-class swaps. No blur, no easing curves.

Tokens:
```
--lp-dur-1: 80ms;  --lp-dur-2: 160ms;  --lp-dur-3: 360ms;  --lp-dur-4: 720ms;
--lp-ease-step-2: steps(2, end);  --lp-ease-step-4: steps(4, end);  --lp-ease-hold: steps(1, end);
```
All motion is wrapped:
```
@media (prefers-reduced-motion: no-preference) { /* define animations here */ }
@media (prefers-reduced-motion: reduce) { /* static equivalents below; animation: none !important */ }
```
Default is the static version; motion is opt-in by `no-preference` (so a missing media query never animates).

### 7.1 Success: the lock opens
Trigger: `[data-lock="success"]` set by CIRCUIT on a correct CHECK.
- Sprite swap `lock-closed` -> `lock-open` (two `<use>` stacked; the inactive one `display: none` by state). Instant.
- `lp-hop` 320ms `--lp-ease-step-2`: `translate: 0 calc(var(--lp-px) * -2)` for 160ms, then 0.
- Lamp token flips to `--lp-ok`. All dials get the `correct` state at once (instant).
- Score pop (6.12): `lp-pop` 720ms `--lp-ease-step-4`: translate up 4 units in 4 steps, opacity 1 -> 1 -> 1 -> 0 on the last step. No flash.
- Static equivalent: sprite is the open lock, lamp green, dials show the correct frame + check, headline says "ACCESS GRANTED" (text/stamp is
  the primary signal), score text visible without movement.

### 7.2 Failure: the shake (never flashes, under 3 Hz)
Trigger: `[data-lock="fail"]` and dials `data-state="wrong"` after a wrong CHECK.
```
@keyframes lp-shake { 0%,100% { translate: 0 0 }  20% { translate: calc(var(--lp-px) * -1) 0 }
                      40% { translate: var(--lp-px) 0 }  60% { translate: calc(var(--lp-px) * -1) 0 }  80% { translate: var(--lp-px) 0 } }
.lp-shake { animation: lp-shake var(--lp-dur-4) var(--lp-ease-hold) 1; }     /* 720ms, 2 full cycles = 2.8 Hz, once */
```
- Applied to the lock host and the dial row together (a single element wrapper), horizontal only, 1-unit amplitude (4px), runs once.
- No color flash: the frame of wrong dials switches to `--lp-bad` and STAYS for >= 1500ms (steady, not blinking). The page never flashes.
- Static equivalent: `--lp-bad` frames + x sprites on dials + a line of text in the message area ("Not the code. N tries left"; copy by CIRCUIT) held
  for 1500ms, lamp red. No translation.

### 7.3 Blood last-10-seconds pulse
Trigger: `[data-phase="last10"]` on the timer.
```
@keyframes lp-pulse { 0%,49.9% { --_pulse: var(--lp-line) } 50%,100% { --_pulse: var(--lp-text) } }  /* use @property so it can step */
.lp-timer[data-phase="last10"] { animation: lp-pulse 1000ms steps(1, end) infinite; }  /* 1 Hz, frame color only */
```
- Alternates the timer FRAME between `--lp-line` and `--lp-text`: a small area, 1 Hz, far below the 3 Hz flash limit. The readout does not
  blink; only the bar frame pulses. Needs `@property --_pulse { syntax: "<color>"; inherits: false; initial-value: #888 }`; if unsupported the
  static fallback below applies.
- Static equivalent (reduced motion or no `@property`): frame 2 units thick in `--lp-text`, readout bold, skull icon, hatch segments.
  CIRCUIT's `timer-sr` live region still announces 0:10 and 0:00. No pulse.

### 7.4 Small stuff
- Toast enter: 2-step `translate` of 1 unit (`--lp-dur-2`), then rest. Reduced: instant.
- Screen change: none (CIRCUIT/router focus the `<h1>`; no page transition animation).
- Button press: instant (4.4). Dial select: instant.
- "Saving..." ellipsis: 3-frame `steps(3)` of a 3-char clip, 1200ms loop; reduced: static "...". This is the only other repeating animation and
  it is only active while a save is pending.
- Allowed repeating animations in total: Blood last10 pulse, saving ellipsis. Everything else is one-shot.

---------------------------------------------------------------------------------------------------

## 8. Focus ring spec (visible on every theme and surface, by construction)

Two layers: inner 2px **dark ink** `--lp-focus-in` `#0A0C12`, outer 2px **white** `--lp-focus-out` `#FFFFFF`, drawn outside the 1-unit frame bar
(so the bar is never covered):
```css
:where(button, a, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: 2px solid var(--lp-focus-out);
  outline-offset: calc(var(--lp-bw) + 2px);                                   /* outside frame bar + inner layer */
  box-shadow: var(--lp-shadow-frame, 0 0 #0000), 0 0 0 calc(var(--lp-bw) + 2px) var(--lp-focus-in);  /* inner dark layer, fills corner notches too */
}
@media (forced-colors: active) { :focus-visible { outline: 3px solid Highlight; box-shadow: none; } }
```
- Total indicator thickness 4px (>= 2px area rule), offset from the control; it is a square ring (notches filled), which reads as "selection".
- By construction: for any surface luminance Ls, the inner layer contrasts as (Ls + 0.05)/0.0537 and the outer as 1.05/(Ls + 0.05). The product is
  fixed at 19.55, so the minimum of the two is at worst sqrt(19.55) = **4.42:1** (at Ls = 0.188); on every real token surface at least one layer is
  far higher. Examples: on bg-0 white outer 18.3 (CD); on bg-1 light CL the dark inner 17.9; on amber CD 11.1 (dark inner) / amber CL 9.6;
  on BD red 6.4; on BL red the dark inner is 3.34 and the white outer is 5.85. All >= 3.
- The ring is identical in all four schemes (no per-theme ring). Never `outline: none` without this replacement. Never remove it on `:focus`
  for mouse via `:focus:not(:focus-visible)` only.
- `scroll-padding-block-start: var(--lp-header-h)` and `scroll-padding-block-end: var(--lp-dock-h)` on the document so a focused element is never
  hidden under the header or dock (WCAG 2.4.11).
- Minimum gap between focusable controls is 12px (4.2): the 8px ring (4 frame + 2 + 2) never overlaps a neighbor's frame bar.

---------------------------------------------------------------------------------------------------

## 9. Sprites (QUARTZ builds `assets/sprites.svg`; PRISM consumes)

### 9.1 Build rules (mechanical)
- One file, `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" shape-rendering="crispEdges">` containing one
  `<symbol id="lp-NAME" viewBox="0 0 W H">` per sprite below. Consumers: `<svg class="lp-sprite" width="W*px" height="H*px"><use href="./assets/sprites.svg#lp-NAME"/></svg>`
  (`<use>` of an external file needs same origin: fine on GitHub Pages; QUARTZ may inline the sheet to save a request if it prefers).
- Each map row is a string of W characters; each character is one art pixel of 1x1 user units. `.` = transparent.
- **Single-color icons** use `1` = filled with `currentColor` (`fill="currentColor"`, so buttons color them with `color:`).
- **Multi-color sprites** use palette letters, each mapped to a CSS variable with a fallback:
  `K` -> `--lp-spr-k`, `B` -> `--lp-spr-b`, `H` -> `--lp-spr-h`, `S` -> `--lp-spr-s`, `L` -> `--lp-spr-lamp`.
  Emit `style="fill:var(--lp-spr-k, #000)"` etc. (custom properties inherit into the `<use>` shadow tree).
- Emit ONE `<path>` per color: for each row, merge horizontal runs into `M{x} {y}h{run}v1h-{run}z`. Do not emit one `<rect>` per pixel.
- Draw size = art grid x `--lp-px`: 8x8 -> `--lp-icon` (32px); 16x16 -> 64px; 24x24 -> 96px; 5x7 digits -> 20x28px.
  Never scale by a non-integer; `crispEdges` is mandatory.
- Rows below are the full source. If any map is off by a pixel when built, the map here is authoritative.

### 9.2 Hero sprites

**lock-closed** 16x16 (K outline, B body, H highlight)
```
................
.....KKKKKK.....
....KBBBBBBK....
...KBKKKKKKBK...
...KBK....KBK...
...KBK....KBK...
...KBK....KBK...
.KKKKKKKKKKKKKK.
.KBBBBBBBBBBBBK.
.KBHHBBBBBBBBBK.
.KBHBBBBKKBBBBK.
.KBBBBBKKKKBBBK.
.KBBBBBBKKBBBBK.
.KBBBBBBKKBBBBK.
.KKKKKKKKKKKKKK.
................
```

**lock-open** 16x16
```
....KKKKKK......
...KBBBBBBK.....
..KBKKKKKKBK....
..KBK....KBK....
..KBK....KBK....
..KKK....KBK....
.........KBK....
.KKKKKKKKKKKKKK.
.KBBBBBBBBBBBBK.
.KBHHBBBBBBBBBK.
.KBHBBBBKKBBBBK.
.KBBBBBKKKKBBBK.
.KBBBBBBKKBBBBK.
.KBBBBBBKKBBBBK.
.KKKKKKKKKKKKKK.
................
```

**vault-door** 24x24 (K outline, S steel door, H bolts, B brass wheel, L lamp)
```
........................
..KKKKKKKKKKKKKKKKKKKK..
.KSSSSSSSSSSSSSSSSSSSSK.
KSSHHSSSSSSLLSSSSSSHHSSK
KSSHHSSSSSSLLSSSSSSHHSSK
KSSSSSSSSKKKKKKSSSSSSSSK
KSSSSSSKKBBKKBBKKSSSSSSK
KSSSSSKBBBBKKBBBBKSSSSSK
KSSSSSKBBBBKKBBBBKSSSSSK
KSSSSKBBBBBKKBBBBBKSSSSK
KSSSSKBBBBBKKBBBBBKSSSSK
KSSSSKKKKKKHHKKKKKKSSSSK
KSSSSKKKKKKHHKKKKKKSSSSK
KSSSSKBBBBBKKBBBBBKSSSSK
KSSSSKBBBBBKKBBBBBKSSSSK
KSSSSSKBBBBKKBBBBKSSSSSK
KSSSSSKBBBBKKBBBBKSSSSSK
KSSSSSSKKBBKKBBKKSSSSSSK
KSSSSSSSSKKKKKKSSSSSSSSK
KSSHHSSSSSSSSSSSSSSHHSSK
KSSHHSSSSSSSSSSSSSSHHSSK
.KSSSSSSSSSSSSSSSSSSSSK.
..KKKKKKKKKKKKKKKKKKKK..
........................
```
The door is the Auth/Home hero; the lamp `L` follows `--lp-spr-lamp`. Door steel vs surface >= 4.74 (2.3).

### 9.3 UI icons (8x8, single color `1` = currentColor)

**check**
```
........
.......1
......11
1....11.
11..11..
.1111...
..11....
........
```
**x**
```
11....11
111..111
.111111.
..1111..
..1111..
.111111.
111..111
11....11
```
**clock**
```
..1111..
.1....1.
1..1...1
1..1...1
1..111.1
1......1
.1....1.
..1111..
```
**bulb** (hint)
```
..1111..
.111111.
11111111
11111111
.111111.
..1111..
..1111..
...11...
```
**skull**
```
.111111.
11111111
1..11..1
1..11..1
11111111
.111111.
..1.1.1.
..1.1.1.
```
**drop** (blood point)
```
...11...
...11...
..1111..
..1111..
.111111.
.111111.
.111111.
..1111..
```
**trophy**
```
11111111
1.1111.1
1.1111.1
.111111.
..1111..
...11...
...11...
.111111.
```
**user**
```
..1111..
.111111.
.111111.
..1111..
.111111.
11111111
11111111
11111111
```
**speaker-on**
```
........
...1..1.
..11.1.1
1111.1.1
1111.1.1
..11.1.1
...1..1.
........
```
**speaker-off**
```
........
...1....
..11.1.1
1111..1.
1111.1.1
..11....
...1....
........
```
**arrow-left** (flips in RTL via `.lp-icon--flip`)
```
...1....
..11....
.1111111
11111111
11111111
.1111111
..11....
...1....
```

### 9.4 Clue-kind icons (8x8, single color)

**sum**
```
...11...
...11...
...11...
11111111
11111111
...11...
...11...
...11...
```
**parity**
```
..1111..
.11..11.
111..111
111..111
111..111
111..111
.11..11.
..1111..
```
**compare** (greater-than; `lt` uses `scale: -1 1`, never mirrored by `dir`)
```
11......
.11.....
..11....
...11...
...11...
..11....
.11.....
11......
```
**even-count** (two filled over two hollow tiles)
```
111.111.
111.111.
111.111.
........
111.111.
1.1.1.1.
111.111.
........
```

### 9.5 Bitmap digits (5x7, decorative/Plan B only, single color; 1 art pixel = 1 unit, 1 unit gap between digits)
```
d0        d1        d2        d3        d4
.111.     ..1..     .111.     11111     ...1.
1...1     .11..     1...1     ...1.     ..11.
1..11     ..1..     ....1     ..1..     .1.1.
1.1.1     ..1..     ...1.     ...1.     1..1.
11..1     ..1..     ..1..     ....1     11111
1...1     ..1..     .1...     1...1     ...1.
.111.     .111.     11111     .111.     ...1.

d5        d6        d7        d8        d9
11111     ..11.     11111     .111.     .111.
1....     .1...     ....1     1...1     1...1
1111.     1....     ...1.     1...1     1...1
....1     1111.     ..1..     .111.     .1111
....1     1...1     .1...     1...1     ....1
1...1     1...1     .1...     1...1     ...1.
.111.     .111.     .1...     .111.     .11.
```
Symbol ids `lp-d0` .. `lp-d9`. Used only as `aria-hidden` decoration (for example a static "000000" vault readout on Auth/Home).
If they are not used by launch, QUARTZ may omit them (saves bytes).

### 9.6 Sprite inventory and sizes

| id | Grid | Draw size @4px | Where |
|---|---|---|---|
| lp-lock-closed | 16x16 | 64 | Play lock host (idle/fail), Result (fail) |
| lp-lock-open | 16x16 | 64 | Play/Result success |
| lp-vault-door | 24x24 | 96 | Auth, Home hero, desktop Play console |
| lp-check, lp-x, lp-clock, lp-bulb, lp-skull, lp-drop, lp-trophy, lp-user, lp-speaker-on, lp-speaker-off, lp-arrow-left | 8x8 | 32 | buttons, chips, tabs, badges, toasts |
| lp-sum, lp-parity, lp-compare, lp-even-count | 8x8 | 32 | clue cards, help legend |
| lp-d0..lp-d9 | 5x7 | 20x28 | decorative only |
The Classic badge uses text only (no 8x8 lock exists; the 16x16 lock cannot be scaled to 0.5). The Blood badge uses `lp-skull`.

---------------------------------------------------------------------------------------------------

## 10. Do / Don't, token names, hooks

### 10.1 Do / Don't
Do
- Reference roles (`var(--lp-*)`); never hex in components.
- Snap every pixel-drawn size to a multiple of `--lp-px`; sprites at integer multiples with `crispEdges`.
- Give every control the 1-unit `--lp-line` frame; let ink frames carry contrast on light schemes.
- Use dither for shadow, pressed and disabled; use ledges for raised.
- Pair every color signal with a shape, text or icon (pip shape, check/x sprite, stamp text).
- Keep Latin digits 0-9 in both languages; keep dial row, keypad, clue digits, code input and timer bar LTR.
- Use `min-height` and flex centering for labels; let text wrap; use `overflow-wrap: anywhere` for names.
- Wrap every animation in `prefers-reduced-motion: no-preference` and ship the static equivalent.
- Use `100dvh` and `env(safe-area-inset-*)`.

Don't
- No `border-radius`, `filter: blur`, `backdrop-filter`, `text-shadow` glow, gradients (except the hard-stop checker and segment
  patterns above), `transition: all`, animated texture, SVG noise, custom cursors, or emoji.
- No `clip-path` stepped corners on interactive controls (it clips the focus ring).
- No pure `#000` surface, no accent used as small text on light schemes (use `--lp-accent-text`).
- No nested frames (frame in frame in frame); no cards for grouping when spacing does the job.
- No third pixel size: do not mix 2px and 4px "pixels", do not scale sprites with transforms, do not resize a sprite to a fractional unit.
- No color-only state (error, correct, last-30, selected).
- No truncation with ellipsis on names, clues or buttons.
- No em dashes in copy; no decorative status dots; no version stamps.
- No animation longer than 720ms except the 1 Hz pulse; no flashing above 3 Hz; no full-viewport flash.
- No second typeface; no italics; no faux bold.

### 10.2 Exact custom properties PRISM defines in `css/tokens.css` (kebab-case, `--lp-*`)

Color roles (values from 2.1; four schemes as in section 2):
`--lp-bg-0 --lp-bg-1 --lp-bg-2 --lp-field --lp-text --lp-text-dim --lp-line --lp-line-soft --lp-ledge --lp-ink
--lp-accent --lp-on-accent --lp-accent-text --lp-meter --lp-ok --lp-bad --lp-info --lp-danger --lp-on-danger
--lp-inv-bg --lp-inv-text --lp-focus-in --lp-focus-out --lp-scrim --lp-dither
--lp-spr-k --lp-spr-b --lp-spr-h --lp-spr-s --lp-spr-lamp`

Grid and layout:
`--lp-px --lp-bw --lp-radius --lp-dir --lp-gutter --lp-container --lp-tap --lp-icon
--lp-space-1 --lp-space-2 --lp-space-3 --lp-space-4 --lp-space-5 --lp-space-6 --lp-space-7 --lp-space-8
--lp-header-h --lp-dock-h --lp-dial-h --lp-key-h --lp-btn-h --lp-seg --lp-n --lp-timer-left`
(`--lp-dock-h` is measured/set by CIRCUIT or a `ResizeObserver` in `ui/chrome.js` only if CSS cannot derive it;
CSS-derived is preferred: `calc(var(--lp-px) * 100)` fallback.)

Elevation:
`--lp-shadow-frame --lp-shadow-ledge --lp-z-header --lp-z-dock --lp-z-toast`

Type:
`--lp-font-latin --lp-font-arabic --lp-font-ui --lp-text-scale --lp-fs-0 --lp-fs-1 --lp-fs-2 --lp-fs-3 --lp-fs-4 --lp-fs-5 --lp-fs-6
--lp-fs-dial --lp-fs-key --lp-lh-body --lp-lh-tight --lp-ls-caps --lp-fw-regular --lp-fw-bold`
(`--lp-font-ui` = `--lp-font-latin` by default, `--lp-font-arabic` under `html[lang="ar"]`;
`--lp-text-scale` = 1, and 1.125 under `html[lang="ar"]`; `--lp-fs-0..3` are `calc(<rem> * var(--lp-text-scale))`.)

Motion:
`--lp-dur-1 --lp-dur-2 --lp-dur-3 --lp-dur-4 --lp-ease-step-2 --lp-ease-step-4 --lp-ease-hold`

Tokens layer: `@layer reset, tokens, base, components, screens, utilities;` (PRISM owns layer order in main.css).

### 10.3 Hooks MUSE needs from GRANITE / CIRCUIT (route through ATLAS; they extend the DOM contract)
- `data-state="idle|selected|filled|correct|wrong"` on each dial `<button>`.
- `data-lock="idle|success|fail"` on the element that hosts the lock/vault sprite; `data-lock` host holds both lock `<use>` symbols.
- `data-phase="normal|last30|last10"` and inline `--lp-timer-left` (integer 0..18) on the timer bar element.
- `data-status="synced|saving|offline|local"` on the status chip.
- Clue list items: `data-kind="feedback|sum|parity|compare|evenCount"`, `data-rel="gt|lt"` (compare only), pips as
  `<span data-pip="right|wrong">` inside feedback clues; guess digits as `<span>`s.
- `data-tone="ok|bad|info"` on toast; `data-pressed` (optional) on a keypad key while the hardware key is down.
- `--lp-n` (dial count) set on `[data-slot="dials"]`.
- `data-mode="blood"` may also be put on single elements (Blood button, Blood tab, Blood badge).
- `html[lang]` and `html[dir]` set together by `i18n` (`lang="ar" dir="rtl"`).
- `<meta name="theme-color">` for BEACON: dark `#12151C`, light `#D9DEEA` (two tags with `media="(prefers-color-scheme: ...)"`).

---------------------------------------------------------------------------------------------------

## 11. Acceptance checks MUSE will apply on review
1. Screenshots at 320, 390, 768, 1280 in all four schemes (Classic/Blood x dark/light), motion pinned both ways via CDP
   `Emulation.setEmulatedMedia` (CLAUDE.md note).
2. 5-dial row at 320 shows five 48px dials, no wrap, no horizontal scroll; keypad aligned under dials.
3. All 4 x 2 contrast tables in 2.3 re-run by script; any miss is a bug against tokens.css, not against this document, unless the script shows the hand
   computation was wrong (then MUSE revises the token).
4. Tab through Play: the ring is visible on every control, never under the header or dock.
5. Arabic: dial row and keypad stay LTR; sentences RTL; no clipped glyphs in buttons; digits Western.
6. Reduced motion: no translate, no pulse; success and failure are still unmistakable from text, frames and icons.
7. Font: real subset size recorded; if > 20 KB, apply the fallback in 3.1.
