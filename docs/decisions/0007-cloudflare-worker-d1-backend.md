# 0007 — Backend: a small Cloudflare Worker + D1 instead of Firestore
Date: 2026-10-13 | Status: accepted | Owner: ATLAS (CIRCUIT implements)
Supersedes: the storage and access-control parts of ADR 0002 (identity, capability code, offline-first sync and the
merge rules are unchanged).

## Context
The owner wanted a free backend that can be created, configured and deployed entirely from the terminal with as little
manual work as possible. Firestore needed console steps (enable database, paste rules, restrict the key) and the rules
were never published, so cross-device sign-in did not work in production. Every other hosted option also needs one
account login; the least-effort one is a single browser OAuth click for `wrangler`.

## Decision
- **Cloudflare Workers + D1 (SQLite)**, free tier, no card. Source in `worker/`; deployed with `npx wrangler deploy`
  (`worker/wrangler.toml`, `worker/schema.sql`). Live at `https://lock-game-api.oph-games.workers.dev`.
- **Server logic is one pure module** (`worker/src/handler.js`) taking a `Request` and a `Store`. The D1 store
  (`d1-store.js`) is a thin SQL adapter. Tests run the same handler over an in-memory store and over the real SQL via
  `node:sqlite`, so server validation is exercised by every sync test.
- **Protocol:** `POST /player/get|create|update`, `POST /board/put|list`, JSON bodies, answers 200 for "not found"
  (`{found:false}`) so existence probes never print a 404 console error. Bodies are sent as `text/plain` so browsers skip
  the CORS preflight. Optimistic concurrency uses an integer `rev` (sent as `updateTime`); a stale write is `409`.
- **Same threat model as ADR 0002** (save id = SHA-256(name + code) is the credential; no list, no delete; random `bk`
  for the public board id) but now enforced by code instead of rules: id must be 64 hex, save <= 850 000 chars, `v` is
  always 1, board rows have exactly six keys with integer ranges and a name of 1 to 96 UTF-8 bytes, `limit <= 50`,
  store errors are never echoed (always `503 unavailable`), all responses `no-store`.
- **CORS** echoes only `https://op-h.github.io` and localhost; a foreign browser origin gets 403. This is a browser
  courtesy, not access control (curl ignores it), exactly like the old API key restriction.
- **No key in the client at all.** `js/config.js` holds only the public URL. CSP `connect-src` names that one host.
- Firebase files (`firestore.rules`, `firebase.json`) were removed; the Firebase project can be deleted.

## Consequences
- Free limits: 100 000 Worker requests/day, D1 5 M reads and 100 k writes/day, 5 GB. The client writes at most once per
  1.5 s of play. When the daily quota runs out the Worker answers 5xx and the game falls back to device-only saves
  (offline status), then retries.
- Brute force of one name's 6-digit code is an online attack; the Worker rate-limits it per address (ADR 0008).
- Existing Firestore data is not migrated: nothing was ever stored there (the rules were never published).
- Redeploy after editing `worker/`: `cd worker && npx wrangler deploy`. Schema changes: edit `schema.sql` (keep it
  idempotent) and run `npx wrangler d1 execute lock-game --remote --file schema.sql`.
- The Worker is not part of the GitHub Pages artifact (`verify-site.mjs` forbids `worker/`) and CI does not deploy it,
  because that would need a Cloudflare API token as a repository secret.

## Cost of reversal
Moderate: `remote.js` is the only client file that speaks the protocol; another backend means re-implementing six
routes behind the same five methods.
