# 0005 — Calm UI: less text, less scroll, one clear font, smoother motion
Date: 2026-10-08 | Status: accepted | Owner: ATLAS
Supersedes in part: ADR 0004 point 1 (type), `docs/design.md` (texture, copy, motion, type). Everything else stands.

## Context
Owner feedback on the live build: "make it simpler, less noisy, don't explain everything with sentences
and words, arrange it nicely, less scrolling, smoother". Measured on 390x844: Home is 1.4 screens tall, Play
1.6. Noise found on the screens: a checker dither across the whole page, a dashed rule under every heading,
four explanatory paragraphs on Home, a "Recent rounds" list, a puzzle-id row, a visible "Crack the Lock"
heading, a lock sprite repeated in the dock, a "Hint (Half Points)" label that wraps, and two near-identical user
icons in the header. The font (Pixelify Sans) draws C/O/G/B/5/S almost alike ("Oreate", "Oode").

## Decision

### 1. Font: Jersey 10 (SIL OFL), one face, Latin subset
Specimen-tested against VT323, Silkscreen, Press Start 2P, Tiny 5 and DotGothic16 at the sizes the UI uses:
Jersey 10 has an open C vs a round O, distinct G/B/5/S, is compact (less wrapping, less scrolling) and bold enough
to stay clearly pixel. Single weight; no faux bold or italics. Arabic keeps the system stack. Sentence case stays.
Budget unchanged (<= 20 KB woff2). File: `assets/fonts/jersey10-latin.woff2`; the old Pixelify files are removed.

### 2. Copy budget (the rule that decides what stays)
A sentence stays only if the player cannot proceed without it. Primary screens (Auth, Home, Play, Result):
no paragraph, no sentence longer than ~8 words, labels are 1-2 words. Everything explanatory moves to Help, which
opens with icons and one-liners and keeps the worked example inside a collapsed `<details>`.
The accessible text is NOT cut: anything removed visually (clue sentences, hint cost, mode rules) stays as
visually-hidden text or an `aria-label`, so screen-reader users lose nothing.

### 3. Clues read as symbols, not sentences
Feedback clue = the guess digits + pips (filled = right place, hollow = wrong place) and nothing else; Help shows
the legend once. Other kinds: icon + short symbol text (sum `= 12`, parity `2nd: even`, compare `1st > 2nd`, even-count
`even: 2`). The full sentence (current `clueText`) stays as visually-hidden text.

### 4. Screens (details in `docs/design-v2.md`)
- **Auth:** title, name field, one primary button, a text link "I have a code". No paragraphs.
- **Home:** one screen. Name + three small stat chips (Classic / Blood with its icon / Total), difficulty selector,
  two big buttons (Classic, Blood) with a 2-4 word subline each. Leaderboard and Help become header icons.
  "Recent rounds" is removed from Home.
- **Play:** a compact top bar (difficulty, timer, wrong count), clues, then dials + keypad + Clear/Check/Hint in
  the dock. No puzzle id, no visible h1, no lock in the dock (the lock lives in the top bar and reacts to
  success/fail). Hint is an icon button (accessible name keeps "Hint, half points").
- **Result:** big score, the lock result, the mode line ("Blood points" with the Blood icon, **always labelled as
  coming from Blood mode here**), two buttons. No lists.
- **Header:** brand, language, sound, account. The sync chip appears only when something needs attention
  (offline / device-only); it is hidden while synced.
- **Blood points labelling** (amends ADR 0003): Home chip says "Blood" with the Blood icon; Result and the in-play
  toast keep the explicit "Blood points (from Blood mode)" wording.

### 5. Targets (SENTRY measures, these are gates)
At 390x844: Auth, Home and Result fit in one viewport with no page scroll; Play (Rookie/Agent, up to 5 clues)
fits with no page scroll, Hacker/Master scroll at most 1.2 screens. At 320x568: Home and Result <= 1.25
screens, Play shows the dials and keypad together with at least 2 clues. Help may scroll (<= 2 screens).
No target below 44x44, contrast and focus rules unchanged.

### 6. Texture and motion
- No dither on the page background and no dashed rule under headings; dither is kept only for disabled/pressed
  states. Fewer frames: frame a control or a group, never both.
- Smoother: screen changes use the View Transitions API where available (short cross-fade + 8px slide, <= 180 ms,
  `ease-out`), with an instant fallback; button press, dial fill and clue entrance use short eased
  transitions on `transform`/`opacity` (<= 160 ms, not `steps()`); the score counts up on Result (<= 600 ms).
  Sprites keep `steps()`. Everything is inside `prefers-reduced-motion: no-preference`; reduced motion gets
  instant changes with the same final states. No flashing > 3 Hz.

### 7. Budget amendment (ADR 0004 definition unchanged)
The calm UI added layouts for three Play modes, motion and RTL variants. **CSS budget: 18,000 B -> 20,000 B**
(gzip -9 body, cold first visit). Measured 17,707 B with LCP 1,116 ms on throttled Chromium against the 2.5 s gate, so
the extra 2 KB (about 10 ms on 4G) is affordable; dead rules must still be deleted before spending it.
The JS (46,080 B) and font budgets are unchanged; the font shrank from 6.3 KB to 2.5 KB.

## Consequences
Rewrites the copy in `js/i18n/en.js`/`ar.js`, trims `index.html`, reflows `css/main.css`, swaps the font, updates
the service-worker precache and the head preload, and updates e2e assertions that read removed text/elements.
Help-page claims about numbers stay generated from `js/config.js`.

## Cost of reversal
Low: copy and CSS only; engine, sync, scoring, tests of logic are untouched.
