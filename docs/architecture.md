# Architecture & build contract (ATLAS)

Brief: rebuild `op-h/lock-puzzle-game` as a pixel-art, mobile-first, GitHub-Pages-ready code-cracking
game: name + generated 6-digit code accounts with cross-device saves and logout, speed-weighted scoring,
a 3-minute Blood Point mode, varied puzzles with a *provably unique* answer, credit "Made by OPH".
Decisions: ADR 0001 (stack), 0002 (cloud saves), 0003 (puzzles/scoring/Blood). Read them first.

## File ownership (stay in your lane)

| Path | Owner |
|---|---|
| `docs/design.md` | MUSE |
| `index.html` `<body>` + `<noscript>` | GRANITE |
| `index.html` `<head>` metadata, `manifest.webmanifest`, `robots.txt`, `sitemap.xml`, `docs/seo.md` | BEACON (after GRANITE) |
| `css/*.css` | PRISM |
| `js/**`, `sw.js`, `firestore.rules`, `docs/backend.md`, `tests/unit/**` | CIRCUIT |
| `assets/**` (font subset, sprites, icons, OG image), `docs/perf.md`, `.nojekyll` | QUARTZ |
| `tests/e2e/**`, `.github/workflows/**`, `docs/qa.md`, `package.json` (dev only) | SENTRY |
| `docs/decisions/**`, `docs/architecture.md`, `README.md` | ATLAS |

`<head>` while GRANITE is working: charset, viewport (`width=device-width, initial-scale=1,
viewport-fit=cover`), `<title>`, one `<link rel="stylesheet" href="./css/main.css">`, one
`<script type="module" src="./js/main.js">`. BEACON extends it later; do not touch each other's blocks.

## Layout

```
index.html  sw.js  manifest.webmanifest  firestore.rules  .nojekyll
css/   main.css  (ONE file, all six @layers in order: reset, tokens, base, components, screens,
       utilities. No @import: each import is a serial round trip on the render-blocking path.)
js/    main.js  config.js  store.js  router.js  i18n/{index,en,ar}.js
       engine/{rng,feedback,clues,solver,generator,scoring}.js      // DOM-free, Node-testable
       sync/{identity,local,remote,merge,sync}.js                    // DOM-free
       ui/{auth,home,play,result,board,help,chrome}.js               // DOM glue
assets/ fonts/ sprites.svg icons/
tests/ unit/*.test.mjs (node --test)   e2e/*.spec.mjs
docs/  decisions/ architecture.md design.md perf.md seo.md qa.md backend.md
```

## Engine API (DOM-free; pure; ES modules; no globals)

```js
// rng.js
mulberry32(seed:uint32) -> () => float[0,1)      randomSeed() -> uint32 (crypto)
// feedback.js
feedback(guess:int[], secret:int[]) -> {bulls, cows}    // two-pass rule, ADR 0003 #4
// clues.js — clue = data. kinds: feedback | sum | parity | compare | evenCount
//  {kind:'feedback', guess:int[], bulls, cows} {kind:'sum', value} {kind:'parity', pos, parity:'even'|'odd'}
//  {kind:'compare', a, b, rel:'gt'|'lt'}  {kind:'evenCount', value}      (pos/a/b are 0-based)
satisfies(clue, code:int[]) -> boolean
// solver.js
solutions(spec:{length, repeats}, clues, limit=2) -> int[][]       // exhaustive, early exit at limit
// generator.js
generatePuzzle({difficulty, seed}) -> {id, difficulty, seed, length, repeats, answer:int[], clues:Clue[]}
// scoring.js
puzzleScore({difficulty, secs, wrong, usedHint, blood:boolean}) -> int
speedFactor(secs, par) ; accuracyFactor(wrong)
// config.js
DIFFICULTIES = { rookie:{length,repeats,kinds,par,base,clues:[min,max]}, agent, hacker, master }
BLOOD = { durationMs:180000, wrongPenaltyMs:5000, skipPenaltyMs:10000, mult:2, ramp:[...] }
CLOUD = { projectId, apiKey, enabled }       // identifiers, see ADR 0002
```

## Save model (`v:1`, JSON string in `players/{id}.save`; also the localStorage working copy)

```js
{ v:1, name:string, createdAt:ms, updatedAt:ms,
  history:[{ id, m:'c'|'b', d:'rookie'|..., pts:int, s:int /*secs*/, w:int /*wrong*/, h:0|1, t:ms, r?:runId }],
  runs:[{ id, t:ms, solved:int, pts:int }],              // Blood runs (appended at run end)
  settings:{ lang:'en'|'ar', sound:boolean, at:ms } }    // settings: last-writer-wins by `at`
```
Derived only (never stored): `classic = Σ pts(m='c')`, `blood = Σ pts(m='b')`, `total`, `solved`,
`bestRun = max(runs.pts)`. `mergeSaves(a,b)` returns `{save, dropped}` and is pure, commutative,
associative, idempotent (property-tested). UI code never calls it directly; it goes through
`js/sync/index.js` (`createAppSync({events: window})`, then `await resume()` at startup).
Run unit tests with `node --test 'tests/unit/*.test.mjs'` (the bare directory form fails on Node 24).

## Sync module contract
- `identity.js`: `normalizeName(s)`, `generateCode()` (uniform 6 digits, zero-padded string),
  `playerId(name, code)` (async, SHA-256 via `crypto.subtle`, hex), `boardId(id)`.
  `crypto.subtle` needs a secure context: GitHub Pages is HTTPS, localhost is fine.
- `remote.js`: `getPlayer(id)`, `createPlayer(id, save)`, `updatePlayer(id, save, updateTime)`,
  `putBoard(bid, row)`, `listBoard({orderBy:'total'|'bestRun', limit})`. Plain `fetch` to
  `https://firestore.googleapis.com/v1/projects/{projectId}/databases/(default)/documents/...?key=...`;
  typed `Result` objects (`{ok, data}` / `{ok:false, reason:'offline'|'denied'|'notfound'|'conflict'|'quota'}`),
  never throws into UI.
- `sync.js`: `signUp(name)` → creates account, returns `{code}`; `signIn(name, code)`; `signOut()`
  (flushes; refuses with `{pending:true}` if unsynced changes and offline so the UI can confirm);
  `recordSolve()`, `recordRun()`, debounced push, pull on `visibilitychange`/`online`, status
  `'synced'|'saving'|'offline'|'local'` published to the store.
- localStorage keys (all prefixed `lp1.`): `session` {name, id}, `save.<id>`, `dirty.<id>`, `lang`.
  The **code itself is never stored** on the device. Logout deletes `session`, `save.*`, `dirty.*`.

## Screens & DOM contract (GRANITE builds exactly this; CIRCUIT binds only to these hooks)

One `<header>` (brand, language toggle, sync status, account menu), one `<main>`, one `<footer>`.
Screens are `<section data-screen="NAME" hidden aria-labelledby=…>` with an `<h1 tabindex="-1">` that
the router focuses on navigation. Exactly one is visible. Names: `auth`, `home`, `play`, `result`,
`board`, `help`. Dialogs use native `<dialog>`: `data-dialog="code|confirm-logout|confirm-quit"`.

| Hook | Where / purpose |
|---|---|
| `data-action="signup|signin|show-signin|show-signup|copy-code|ack-code|logout|lang|go-home|play-classic|play-blood|check|clear|skip|hint|next|retry|show-board|show-help|back|quit|mute"` | `<button>` (or `<a>` for nav) — one delegated click handler |
| `data-field="name|code"` | auth inputs. `name`: `autocomplete="username"`, `maxlength=20`. `code`: `inputmode="numeric" pattern="[0-9]{6}" maxlength=6 autocomplete="one-time-code"` |
| `data-form="signup|signin"` | the two auth `<form>`s (native submit; `novalidate` + custom messages in `[data-error]` live region) |
| `data-out="code|name|total|classic|blood|status|timer|puzzle-no|difficulty|attempts-left|score|bloodpoints|msg"` | text sinks (`<output>`/`<span>`), CIRCUIT sets `textContent` only |
| `data-slot="dials"` | container for the N dial buttons (CIRCUIT renders `<button role="spinbutton"`-free: see below) |
| `data-slot="keypad"` | on-screen 0–9 keypad container (CIRCUIT renders `<button data-digit="n">`) |
| `data-slot="clues|history|board-rows|difficulty-picker|result-lines"` | list containers (`<ol>`/`<ul>`/`<tbody>`), CIRCUIT renders `<li>`/`<tr>` |
| `data-live="status|timer-sr"` | `aria-live="polite"` regions. Timer SR announces only at 2:00, 1:00, 0:30, 0:10, 0:00 |
| `data-tab="all|blood"` | leaderboard tabs (`role="tablist"` pattern) |
| `data-mode-badge` | element on `play`/`result` showing CLASSIC or BLOOD; `data-mode="classic|blood"` is set on `<body>` for CSS theming (red palette in Blood) |
| `data-credit` | footer line: "Made by OPH" → `https://github.com/op-h` (`rel="noopener"`) |

Input model on `play`: dials are `<button>`s showing a digit, the **keypad** types into the selected dial
(tap a dial to select, keypad fills and auto-advances); hardware keyboard digits/Backspace/Arrow/Enter also
work. Dials never open the OS keyboard on mobile (they are buttons, not inputs). All targets >= 44×44 CSS px.

All visible strings come from `js/i18n` keys; GRANITE writes English in the markup **and** sets
`data-i18n="key"` on each text element so CIRCUIT can swap them. Placeholder attrs use
`data-i18n-attr="placeholder:key"`. GRANITE/CIRCUIT agree keys in `js/i18n/en.js` (CIRCUIT owns the file;
GRANITE lists keys it used in its HANDOFF `DONE:`; CIRCUIT reconciles).

## Definition of Done deltas for this project
- DoD 1 waived by ADR 0001 (app shell) with the `<noscript>` compensation.
- Timer/animation must respect `prefers-reduced-motion` (no flashing; countdown still updates text).
- Pixel look must not cost contrast: 4.5:1 text, 3:1 for pixel borders that carry meaning.
- Zero requests to third-party origins except `firestore.googleapis.com` (fetch, after user action
  or on resume of an existing session — never before consent-free first paint).
- Firestore is never contacted by tests; use the in-process fake.
