# 0003 — Puzzle generation guarantees, scoring, and Blood Point mode
Date: 2026-10-07 | Status: accepted | Owner: ATLAS

## Context
Inherited defects: (a) random clues do not guarantee a unique answer, so many puzzles had several valid
codes; (b) clue text had no case for 1-right-place + 2-misplaced ("Complex analysis"); (c) scoring only
penalised time in 10 s steps and read `Date.now()` during render, so the displayed score drifted.

## Decision

### Puzzle correctness (hard invariants, tested over thousands of seeds)
1. **Exactly one solution.** After generation a brute-force solver enumerates the whole code space
   (max 10^5) and must return exactly `{answer}`.
2. **Minimal.** Removing any single clue yields >= 2 solutions (no redundant clues).
3. Every clue is true of the answer; no clue's guess equals the answer.
4. Feedback scoring is the standard two-pass rule: bulls first, then cows capped by remaining digit
   multiplicity (correct with repeated digits). Tests compare it to an independent multiset
   implementation over the full space.
5. Clue text is composed from (bulls, cows) so *every* combination for every length is covered; a test
   enumerates all (b, c) with b + c <= n, (b, c) != (n-1, 1), in both languages.
6. Puzzles are pure functions of `(difficulty, seed)`; `id = difficulty + "-" + seed(base36)`.

### Variety
Four difficulties (digits / repeats / clue kinds): Rookie 3 / no / feedback · Agent 3 / yes / + parity,
sum · Hacker 4 / no / all kinds · Master 5 / no / all kinds. Clue kinds are data, not strings:
`feedback`, `sum`, `parity`, `compare`, `evenCount`. Constants live in `js/config.js`.

### Scoring (pure, integer, deterministic; `js/engine/scoring.js`)
```
speed    = 0.5 + 1.5 * 2^(-secs / par)        // 2.0 at 0 s, halves its excess every `par` s, floor 0.5
accuracy = max(0.4, 1 - 0.08 * wrongGuesses)
hint     = usedHint ? 0.5 : 1
points   = round(base * speed * accuracy * hint)
```
Monotone: for equal inputs, a faster solve never scores fewer points. Time is measured from the moment
the puzzle is first shown to the correct submission, frozen at submit. **The clock never stops**
(amended after review: pausing while the tab was hidden let a player study the clues in a second window
for free; one hour hidden counted as 6 s). A reload resumes from the persisted wall-clock start.
A guess that breaks the no-repeated-digits rule on a no-repeat puzzle is rejected for free (no penalty).

### Blood Point mode
- One run = a **3:00 countdown** (wall-clock `endsAt`, immune to tab throttling). Solve as many
  puzzles as possible; difficulty ramps with solves in the run (0-1 Rookie, 2-3 Agent, 4-6 Hacker, 7+ Master).
- Each solve scores as above **x BLOOD_MULT (2)**. No hints. Wrong guess costs **5 s** off the clock;
  skipping costs **10 s**. The puzzle in play when time hits 0 is forfeited (no partial credit).
- Points are logged per solve (mode `b`) so a closed tab never loses them; the run summary is a
  `runs[]` entry. The result screen and the profile **always label** these as "Blood points
  (from Blood mode)" and show Classic / Blood / Total separately. Leaderboard has an All-time tab and a
  Blood tab (best single run).

## Consequences
Generation of a Master puzzle may need up to a few ms of solver work; the generator retries with the next
seed until constraints hold (bounded attempts; falls back to adding clues, never to shipping a
non-unique puzzle).

## Cost of reversal
Low; all numbers are in `js/config.js`.
