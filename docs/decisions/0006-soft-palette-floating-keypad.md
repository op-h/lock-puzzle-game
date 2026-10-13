# 0006 — Soft palette, floating keypad, hold-to-peek descriptions, avatar colour
Date: 2026-10-13 | Status: accepted | Owner: ATLAS
Amends: ADR 0005 (Play layout, Home mode buttons, header), `docs/design-v2.md` (colour tokens).

## Context
Owner feedback on the live calm UI: the background should be easier on the eyes but keep the pixel signature; the
number-entry area on Play should appear and disappear with the lock, float over the page and be see-through so the
clues stay visible and scrolling shrinks; a button's description should appear on click for about 2 s (or on hover on
a PC) instead of always showing; each player gets a unique colour that fills the user icon, derived from nickname,
code and first sign-in time; the first screen says "Lock Game" and the sign-in explanation moves to Help; the header
icon boxes must all be the same size and never fall below the header.

## Decision

### 1. Palette: sage paper / moss slate, plus a faint dot grid
Classic light `#D3DCD2` page, `#E7EDE4` cards, text `#19261F`; Classic dark `#151D1B` / `#1E2926`, text `#E2EAE4`.
No blue cast, text one step off black/white, amber accent kept (it is the lock's colour). Blood keeps its red identity
with the same softening. Every text pair is >= 4.5:1 and the line colour >= 3:1 (checked by script, all four schemes).
The pixel signature on the page itself is a fixed layer of 2 px dots on a 16 px staggered pitch at about 9% of the text
colour (`body::before`, a CSS mask; off under `prefers-contrast: more`). It never scrolls, takes no clicks, and every card
covers it. ADR 0005 s6 ("flat page") is relaxed by exactly this one faint layer.

### 2. Play: the keypad floats and the lock switches it
The dials, keypad and Clear/Check/Hint/Skip live in `#play-pad`, `position: fixed`, bottom centre (side-docked on
short landscape phones). The panel is 55% of the surface plus a 6 px backdrop blur; keys are 84% fill, so digits stay
readable and the clues show through the gaps and frame. `prefers-reduced-transparency` makes it opaque; without
`backdrop-filter` it falls back to 88%. The lock in the top bar is a real `<button>` (`aria-controls`, `aria-expanded`);
hidden = `inert` (no focus, no assistive-tech noise). It opens at the start of every round; typing a digit on a hardware
keyboard re-opens it. While open, the clue list reserves the measured panel height so the last clue always scrolls
clear; messages float just above the panel. The three old layouts (phone grid with a dock row, landscape, two-column
desktop with a sticky dock) collapse into: phone grid without a dock row, landscape side dock, one centred column.

### 3. Descriptions on demand
A button marked `data-tip` hides its description (`.lp-btn__sub` is collapsed with max-height/opacity, never
`display:none`, so it stays in the accessible name). It appears on hover, on keyboard focus, and for 2 s after a tap
(`data-tip="tap"`, used by the lock) or after a press-and-hold of 380 ms on touch (`data-tip="hold"`, used by the Home
mode buttons, whose tap starts a round). A held press shows the text and swallows that one click, so reading never starts
a game. Help says so ("Hold a button to see what it does"). The logic is about 1 KB in `ui/chrome.js`.

### 4. Avatar colour
`accountColor(id, createdAt)` in `sync/identity.js`: cyrb53 of `"lpc1:" + id + ":" + createdAt`, mapped to an `hsl()`
with 360 hues x 3 saturations x 3 lightnesses. `id` is SHA-256(nickname key + code), so the colour depends on nickname
and code; `createdAt` is the first-sign-in time and merges as "earliest wins". It is a pure function: nothing new is
stored, no save-format change, every device derives the same colour, and it also works for existing accounts. The user
sprite is now 16x16, outlined in the text colour, body filled with `var(--lp-user)`; `ui/chrome.js` writes that
property on `:root` (CSSOM) at session start and on every pulled save, and removes it at logout. Colours are not
guaranteed unique (about 1 in 3,000 pairs collide; tested), only very unlikely to match.

### 5. Names and text
The auth heading and the header brand read "Lock Game"; the browser tab for that screen is "Sign in", not "Welcome".
Nothing visible explains sign-in on the first screen; the old one-liner is kept as hidden text for the field's
`aria-describedby`, and Help has a "Name and code" section plus a "Tips" section.
SEO metadata, the manifest and the share image still say "Lock Puzzle" (TODO(content): pick one product name).

### 6. Icon tiles
Every icon control (language, sound, help, board, account, sync chip, back, quit, lock) is one 44x44 box with the same
2 px stepped frame and fill (the frame is outside the box, so a tile takes 48x48; header height 56). The header never
wraps; at 320 px with the sync chip showing, the little brand lock steps aside.

## Consequences
CSS 19,605 B gzip (budget 20,000), first-load JS about 43.2 KB EN / 44.3 KB AR (budget 46,080). New i18n keys in both
languages; Arabic wording needs the same native review as the rest. e2e specs that read the dock, the always-visible
mode sublines or the old welcome text are updated.

## Cost of reversal
Low: CSS and markup. The colour function is isolated and removing it only drops one property.
