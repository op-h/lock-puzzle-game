# 0001 — App shell, vanilla ES modules, no build step
Date: 2026-10-07 | Status: accepted | Owner: ATLAS

## Context
The inherited `index.html` is React + in-browser Babel + Tailwind Play CDN + Firebase compat SDK, all
loaded from third-party CDNs at runtime. Babel-standalone alone is ~1 MB of JS compiled on every
load; on a mid-tier Android over 4G that fails the LCP < 2.5 s budget by itself, and the page is blank
when any CDN is slow. The product is a stateful game, not a document.

## Options considered
1. Keep React/Tailwind, add a bundler.
2. Preact + bundler.
3. Vanilla ES modules, plain CSS, zero build, served as-is by GitHub Pages.

## Decision
Option 3. No framework, no bundler, no runtime third-party code. Gzipped cost of dependencies: **0 KB**.
The only non-first-party bytes are one self-hosted pixel font subset (QUARTZ budgets it).

**This project is declared an app shell** for Definition of Done item 1. The play surface needs JS.
Compensation: `index.html` ships a real `<noscript>` block with the rules, a worked example, and the
maker credit, and the page title/meta are server-rendered (static). Progressive enhancement still
applies to everything that *can* work without JS (rules, credit, links).

Supporting decisions:
- **All URLs relative** (`./js/main.js`, never `/js/...`): GitHub Pages serves this at
  `/lock-puzzle-game/`. A `.nojekyll` file is committed. `<script type="module">` only.
- **Bilingual EN/AR with a toggle** (not both languages stacked as in the original). `lang`/`dir` are
  set on `<html>`; CSS uses logical properties only. Default from `navigator.language`, persisted.
- **Offline-capable via a tiny service worker** (`sw.js`, cache-first for same-origin static assets,
  versioned cache name, never intercepts `firestore.googleapis.com`). Installable via web manifest.
  Added last; it must not block release if it is not green (see Risks in qa.md).
- Pure game logic lives in DOM-free modules so it can be tested in Node with `node --test`.

## Consequences
We write our own tiny view layer (`js/ui/*`). Every screen is a `<section>` toggled by a router; state
lives in one store module. No JSX/Tailwind means CSS is hand-authored by PRISM against MUSE's tokens.

## Cost of reversal
Low. Engine and sync modules are framework-agnostic; only `js/ui/*` would be rewritten.
