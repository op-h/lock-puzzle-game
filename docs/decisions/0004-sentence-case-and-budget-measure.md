# 0004 — Sentence case for UI text; how the first-load budget is measured
Date: 2026-10-07 | Status: accepted | Owner: ATLAS
Amends: `docs/design.md` (type), `docs/perf.md` (budget definition)

## Context
SENTRY's release gate (qa.md F-07, F-10) found two things the original specs got wrong:
1. `docs/design.md` sets headings, buttons and labels in UPPERCASE Pixelify Sans. At the sizes used on a
   phone the face makes C read as O, B as G, and 5 as S ("OREATE A PLAYER", "OLUES", "NEW PERSONAL GEST!").
   Screen readers are unaffected; sighted players must guess. Legibility outranks the retro mood.
2. `docs/perf.md` says the on-the-wire number (response headers included) prevails over body bytes. Header
   size depends on the host (GitHub Pages / Fastly), which the project does not control, and varied with
   cache headers in the test server. The measured first load was 44,342 B of gzip-9 bodies against the
   45,000 B budget, but 49,625 B with headers.

## Decision
1. **UI text is sentence case.** `text-transform: uppercase` is removed from headings, buttons, labels,
   tabs and body copy. Uppercase is kept only for fixed two-word-or-shorter tags where every letter is
   unambiguous in the face and the word is also given in the accessible name (mode badge, "YOU" row
   marker). The pixel character comes from the face, the frames, the dither and the sprites, not from caps.
   Digits on dials and keys are unaffected (a digit slot cannot be confused with a letter).
2. **The JS/CSS/font budgets are measured on compressed response *bodies* (gzip -9) for a cold first
   visit of a signed-out player.** HTTP headers are excluded because the project cannot control them.
   The first-load JS budget is **45 KiB (46,080 B)**, the figure the ADRs always meant. A returning,
   signed-in visitor is served from the service worker / HTTP cache and is not a cold load.

## Consequences
PRISM removes the uppercase rules and re-checks wrapping at 320 px (sentence case is narrower, so it helps
F-06). MUSE's copy in design.md keeps its wording; only its capitalisation rule is superseded by this ADR.
QUARTZ aligns perf.md with point 2 and keeps recording both numbers (body bytes decide, header bytes are
informational).

## Cost of reversal
Trivial (one CSS property); the budget definition is documentation.
