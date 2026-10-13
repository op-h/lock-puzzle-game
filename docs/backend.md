# Backend (Cloudflare Worker + D1)

Owner: CIRCUIT. Decision record: `docs/decisions/0007-cloudflare-worker-d1-backend.md`.

The game is offline-first. If the backend is unreachable the game still works: progress is saved on the device and the
header says so. Nothing is lost; it uploads on the first successful sync.

The API URL lives in `js/config.js` (`CLOUD.url`). It is public and carries no key.

## What exists

| Thing | Value |
|---|---|
| Worker | `lock-game-api` -> `https://lock-game-api.oph-games.workers.dev` |
| Database | D1 `lock-game` (tables `players`, `board`, created by `worker/schema.sql`) |
| Code | `worker/src/handler.js` (all logic), `d1-store.js` (SQL), `index.js` (entry + CORS allow-list) |

## Everyday commands (run in `worker/`)

```sh
npx wrangler login                                   # once per machine (browser, one click)
npx wrangler deploy                                  # publish a code change
npx wrangler d1 execute lock-game --remote --file schema.sql      # apply a schema change (idempotent)
npx wrangler d1 execute lock-game --remote --command "SELECT count(*) FROM players"
npx wrangler tail                                    # live request log while debugging
```

## Looking at the data ("the dashboard")

Cloudflare dashboard -> Storage & Databases -> D1 -> `lock-game` -> Tables. `players` rows are a 64-character hash id,
the save JSON and a revision; the 6-digit code is never stored. `board` rows hold the public name and scores.
Workers & Pages -> `lock-game-api` -> Metrics shows requests and errors.

## Guess limit

Each client address gets 40 "probes" (a lookup that finds nothing, or a create), refilled one per 20 s; an empty bucket
gets `429` and a "Too many tries" message (ADR 0008). To see or clear it: `npx wrangler d1 execute lock-game --remote --command
"SELECT count(*) FROM limits"` / `"DELETE FROM limits"`. Change the numbers in `worker/src/handler.js` (`GUESS_CAP`,
`GUESS_REFILL_MS`) and redeploy.

## Free limits

100 000 Worker requests/day, D1 5 M row reads and 100 k row writes/day, 5 GB storage. The client writes at most once per
1.5 s of play. If the day's quota runs out the API answers 5xx and every device keeps working locally.

## Smoke test (manual, against the real backend, about 3 minutes)

Use a throwaway name such as `smoketest-<date>` and delete its rows afterwards. Automated tests never touch the live API.

- [ ] Sign up: a 6-digit code is shown once. Header status says "synced".
- [ ] `players` has one new row (64-hex id, `v` 1, `save` JSON). The code appears nowhere in it.
- [ ] Solve one puzzle: within about 2 s `players.save` contains it and `board` has a row with a different 64-hex id.
- [ ] Second browser (or private window): sign in with the same name + code. Progress matches.
- [ ] Wrong code: the generic "name or code not recognised" message, identical to an unknown name.
- [ ] Offline (DevTools): solve a puzzle, status says offline, go online, it returns to synced without a reload.
- [ ] Eleven wrong sign-in attempts in a row are fine; about 40 within minutes show "Too many tries", and it clears after a few minutes.
- [ ] Network tab during sign-up and a wrong-code sign-in: no 4xx responses and no red console lines.

Clean up: `npx wrangler d1 execute lock-game --remote --command "DELETE FROM players WHERE id = '<id>'"` (and the
matching `board` row; find it by name).

## Moving to another account or project

`npx wrangler d1 create <name>`, put the new `database_id` into `wrangler.toml`, run the schema, `npx wrangler deploy`,
then set `CLOUD.url` in `js/config.js` and the same host in the `connect-src` of `index.html` (the CSP e2e test checks both).
