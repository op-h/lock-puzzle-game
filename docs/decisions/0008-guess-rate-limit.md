# 0008 — Rate limit for guessing codes
Date: 2026-10-13 | Status: accepted | Owner: ATLAS (CIRCUIT implements)
Amends: ADR 0007 (the "no rate limit" consequence), ADR 0002 (brute force was an accepted risk).

## Context
An account is a name plus a 6-digit code, and the save id is SHA-256(name + code). Anyone who knows a name can try the
1 000 000 codes against the API. The server only ever sees ids, so a "guess" is a lookup of an id that usually does not exist.

## Decision
A **per-client token bucket in the Worker** (`handler.js`, state in D1 table `limits`):
- **What costs a token ("a probe"):** a `/player/get` that finds nothing, and every `/player/create`. Both can reveal
  whether an id exists: a lookup directly, a create because it answers 409 for an existing id (and would otherwise let a
  guesser fill the table with junk accounts). Lookups that find the save, updates, and all leaderboard calls are free, so a
  signed-in player is never throttled. `/player/update` already answers 409 for "missing" and "stale" alike, so it is no oracle.
- **Size:** 40 tokens, one back every 20 s (`GUESS_CAP`, `GUESS_REFILL_MS`). A classroom can sign up in a burst; one
  address gets about 4 300 guesses a day, so covering one name's code space takes it about 230 days.
- **Gate before the lookup:** an empty bucket answers `429 {error:'rate', retryAfter}` for `get` and `create` without
  touching the saves table. A blocked client therefore learns nothing, not even from a correct guess.
- **Who is a client:** the address in `CF-Connecting-IP` (Cloudflare sets it; a client cannot forge it), IPv6 bucketed by
  its /64. The key is a 128-bit hash of the address so the table never holds an address as such (not anonymisation: IPv4 is
  brute-forceable under any hash). Rows idle for a day are swept at random on spend. A missing header (tests, local dev) shares one bucket.
- **Fail closed:** if the limiter's store errors, the request is a 503, never an unlimited answer.
- **Atomic spend:** one upsert does refill and spend, so parallel guesses cannot read the same balance.
- **Client:** a 429 with `error:'rate'` is reason `limited` (a plain 429 stays `quota`). Sign-in shows "Too many tries.
  Wait a few minutes." (en, ar), sign-up still works on the device and uploads when the block lifts, background sync backs off.

## Consequences
- A legitimate user who shares an address with a guesser is blocked for a while too (their background sync pulls are
  lookups that hit, but the gate is per address and runs first). The game keeps working offline and retries with backoff.
- Many addresses (a botnet) still multiply the guess rate. Names are public on the leaderboard, so a strong, slower
  defence would need a per-name counter, which the server cannot have because it never sees the name. Accepted.
- Extra D1 writes: one per missed lookup or create (free tier 100 000 writes a day). Blocked requests write nothing.
- Cloudflare's own rate limiting rules or a Turnstile check would be stronger but need dashboard setup; not needed yet.
- Redeploy needs the new table: `npx wrangler d1 execute lock-game --remote --file schema.sql`, then `npx wrangler deploy`.

## Cost of reversal
Low: two Store methods and two gates in `handler.js`; delete the table.
