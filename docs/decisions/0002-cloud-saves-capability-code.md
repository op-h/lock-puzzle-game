# 0002 — Cloud saves: name + 6-digit code as a capability, Firestore REST, offline-first
Date: 2026-10-07 | Status: accepted | Owner: ATLAS

## Context
Requirement: a player enters a name, receives a generated 6-digit code, and can later enter name+code on
any device to continue the same progress; with logout. Hosting is GitHub Pages (static, no server code),
so persistence needs a hosted backend. The original repo already uses the Firebase project
`lock-puzzle-game` (Firestore), so that is the lowest-friction, zero-new-account choice.

## Options considered
1. Firebase JS SDK (compat) + anonymous auth. ~100+ KB gzipped, extra auth round-trip, and anonymous
   uids are per-device, which fights cross-device login.
2. Firestore **REST** via `fetch`, unauthenticated, protected by security rules. 0 KB dependency.
3. Another BaaS (Supabase etc.). New account, new keys, same trade-offs.
4. Local-only. Fails the cross-device requirement.

## Decision
Option 2, offline-first (localStorage is the working copy; cloud is replication).

**Identity = capability.** The save document id is `SHA-256("lp1:" + nameKey + ":" + code)` in hex
(`nameKey` = NFKC, trimmed, whitespace-collapsed, locale-independently lower-cased name, with invisible
and bidi-control characters removed and Arabic digits, tatweel, harakat, alef and yeh variants folded,
so the same name typed on two keyboards yields the same id; different scripts are never folded together). Knowing name+code lets you compute
the id and `GET` it; nothing can *enumerate* ids because rules deny `list` on `players`. The code is
generated with `crypto.getRandomValues` using rejection sampling (uniform 000000–999999), re-rolled if
that id already exists. Names need not be unique; (name, code) is.

**Collections** (see `firestore.rules`):
- `players/{id}`: `{ v:int, save:string(JSON, <900 KB) }`. `get`/`create`/`update`; no `list`, no `delete`.
- `board/{bid}`: public leaderboard row `{ name, total, blood, solved, bestRun, updatedAt }`, with
  `bid = SHA-256("lp1-board:" + bk)` where `bk` is a **random 128-bit key stored inside the save**
  (created at sign-up). `list` allowed with `limit <= 50` and `offset == 0`; no `delete`.

  *Correction (2026-10-07, after adversarial review).* The first draft derived `bid` from the save id,
  i.e. `SHA-256(SHA-256(name:code))`, and claimed that hid the save id. It does not: the board row also
  publishes `name`, so anyone can try all 10^6 codes offline against the public `bid`. The auditor
  recovered a code in 106 ms with zero network requests, which would have given read/write access to
  that player's save. Anything public must therefore be unrelated to `(name, code)`; hence the random
  `bk`. With no public derivative of the code, guessing is again an *online* attack only. No key
  stretching (PBKDF2) is needed for the same reason.

**Conflict handling.** Saves are append-only event logs (`history[]`, `runs[]`, each with a unique id).
Merge = union by id; totals are *derived*, never stored, so offline play on two devices can neither
double-count nor lose points. Writes use REST preconditions (`currentDocument.updateTime`) and on
conflict re-read, merge, retry (max 3).

**Client-side key.** `js/config.js` contains the Firebase Web API key and project id. This is an
identifier, not a secret (Google documents Web API keys as public; authorization is by security rules).
It is the same key already public in the repo's history. DoD item 8 is satisfied by the *absence of any
secret*; the owner should additionally restrict the key to HTTP referrer `op-h.github.io/*` in Google
Cloud Console.

## Accepted risks (stated plainly)
- **Brute force:** 10^6 codes per name. An attacker who knows a name can try codes at network speed;
  there is no rate limit without server code. Realistic impact is quota exhaustion, not a likely
  takeover. Stakes are a game save. Mitigation path: Cloud Function + App Check (needs Blaze plan).
- **Leaderboard is honor-system.** Board ids are public (listed), so anyone can overwrite any row. Rules
  bound value ranges and deny deletes; they cannot prove ownership without server code. This is cosmetic
  vandalism only: a row never grants access to a save.
- **Sign-up session is created only after the player acknowledges the code**, so a reload with the code
  dialog open cannot leave a signed-in account whose code was never seen.
- **No account deletion / no code recovery.** The UI makes the player acknowledge the code at creation.
- **Privacy:** stores only the chosen name and gameplay history. The UI tells players not to use a real
  full name.

## Consequences
The owner must publish `firestore.rules` and confirm Firestore is enabled (BLOCKED item for a human).
Until then the app degrades to "saved on this device" and says so; it never silently loses data.
Tests run against an in-process fake of the REST endpoints; they never touch the live project.

## Cost of reversal
Medium. Backend access is isolated behind `js/sync/remote.js` (get/create/update/listBoard).
