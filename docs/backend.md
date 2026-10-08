# Backend setup (Firestore) — human steps

Owner: CIRCUIT. Decision record: `docs/decisions/0002-cloud-saves-capability-code.md`.

The game is offline-first. Until the steps below are done it still works: progress is saved on the
device and the header says so. Nothing is lost; it uploads on the first successful sync.

Project id and Web API key live in `js/config.js` (`CLOUD`). They are identifiers, not secrets.

## 1. Enable Firestore

1. Open the Firebase console for project `lock-puzzle-game` -> Build -> Firestore Database.
2. Create database -> **Native mode** (not Datastore mode) -> database id `(default)`.
3. Pick a location close to most players. **This cannot be changed later.** Pick a multi-region
   (`nam5`/`eur3`) if unsure.
4. Choose "Start in production mode" (deny all). The next step replaces the rules.
5. Spark (free) plan is enough. Quota: 50k reads / 20k writes per day. The app writes at most once
   per 1.5 s of play, plus one leaderboard row per push.

## 2. Publish the security rules

The rules in `firestore.rules` are the only access control. **Without them the database is either
closed (the app stays local-only) or open to everyone.** Do this before announcing the game.

Option A, console paste: Firestore -> Rules tab -> replace the contents with `firestore.rules` -> Publish.

Option B, CLI (`firebase.json` is already in the repo):

```sh
npm i -g firebase-tools          # one-off; not a project dependency
firebase login
firebase deploy --only firestore:rules --project lock-puzzle-game
```

Verify in the console Rules tab that the "last published" time is now and the text matches the file.

## 3. Restrict the Web API key

1. Google Cloud console -> APIs & Services -> Credentials -> the "Browser key" used in `js/config.js`.
2. Application restrictions -> **Websites (HTTP referrers)**. Add:
   - `https://op-h.github.io/*`
   - `http://localhost/*` and `http://localhost:*/*` (local development; remove later if you like)
3. API restrictions -> Restrict key -> select **Cloud Firestore API** only.
4. Save. Allow a few minutes to propagate.

This stops other websites from spending your quota with your key. It does not stop a determined
person who sends a forged `Referer`; the rules are what protect the data.

## 4. Smoke test (manual, against the real project, ~5 minutes)

Use a throwaway name such as `smoketest-<date>`. Automated tests never touch the live project.

- [ ] Sign up: a 6-digit code is shown once; copy it. Header status says "synced".
- [ ] Firestore console -> `players`: one new document whose id is 64 hex chars, with exactly
      two fields `v` (integer 1) and `save` (string). The code appears nowhere in it.
- [ ] Solve one puzzle. Within ~2 s `players/{id}.save` contains the entry and `board/` has a row with
      a different 64-hex id and fields `name,total,blood,solved,bestRun,updatedAt`.
- [ ] Second browser/device (or private window): sign in with the same name + code. Progress and
      totals match.
- [ ] Wrong code (change one digit): the generic "name or code not recognised" error, same as for an
      unknown name.
- [ ] Offline: DevTools -> Network -> Offline. Solve a puzzle; status shows "offline"; go online; status
      returns to "synced" without a reload and the second device sees the solve after refresh.
- [ ] Log out while offline with an unsynced solve: the app warns and does not wipe silently.
- [ ] Log out online: `localStorage` has only `lp1.lang` left (DevTools -> Application).
- [ ] Existence probe without a 404: with a never-used id, `POST .../documents:batchGet?key=...` with body
      `{"documents":["projects/lock-puzzle-game/databases/(default)/documents/players/<64 hex>"]}` answers **200** and the
      array has a `missing` entry; with a real id it has a `found` entry. If it answers 403, the rules engine does NOT
      treat batchGet as a per-document `get` (unverified here): then every sign-in fails, so check this FIRST.
- [ ] Network tab during sign-up and a wrong-code sign-in: no 4xx responses at all (no red lines in the console).
- [ ] Rules sanity (Rules playground in the console, or `curl`):
  - [ ] `list /board` with `limit 50` and **no offset** allowed (an unset `request.query.offset` must evaluate as 0 here;
        if the playground denies it, change the rule to `(!('offset' in request.query) || request.query.offset == 0)`);
        with `offset 10` **denied**.
  - [ ] `create /board/x` with a 96-char ASCII name allowed, 97 chars **denied** (the client sends at most 24 code points,
        so at most 96 UTF-8 bytes; `size()` may count characters or bytes, both are covered).
  - [ ] `get /players/<known id>` allowed; `list /players` **denied**; `delete` of any doc **denied**.
  - [ ] `list /board` with `limit 50` allowed; with no limit or `limit 51` **denied**.
  - [ ] `create /players/x` with an extra field **denied**; with `v: 2` **denied**.
  - [ ] `create /board/x` with `total: -1`, or a 25-char name, **denied**.
- [ ] Console: zero errors; Network tab shows requests only to `firestore.googleapis.com`.

## Data model

```
players/{id}      id = hex SHA-256("lp1:" + nameKey + ":" + code)
  v:    integer   always 1
  save: string    JSON, < 900 000 chars (see "Save model" in docs/architecture.md)

board/{bid}       bid = hex SHA-256("lp1-board:" + bk)   bk = random 128-bit key stored INSIDE the private save
  name: string (1-24)   total, blood, solved, bestRun: integer >= 0   updatedAt: integer (epoch ms)
```

`nameKey` = NFKC, trimmed, whitespace-collapsed, lower-cased name. The code is six digits from
`crypto.getRandomValues` with rejection sampling. Totals are never stored; they are derived from the
append-only `history` and `runs` logs in the save, which is why two devices can merge offline play.

Capacity: roughly 100 bytes per solve, so about 8 000 solves before the client's 850 000-char write
guard (the rule allows 900 000). A player would need to solve one puzzle a minute for ~130 hours.
When that nears, add compaction (fold old entries into a summary row); not built yet.

## Board key (why the leaderboard is no longer a code oracle)

The old public board id was `H(H(name:code))`. Anyone could take a name from the board and test all 10^6 codes
**offline** against it, so the "online-only brute force" assumption of ADR 0002 was false. Now:

- every save carries `bk`, 32 lowercase hex characters from `crypto.getRandomValues` (a new optional field; `v` stays 1);
- the public row id is `SHA-256("lp1-board:" + bk)`; `bk` never leaves the private save and is never published;
- `bk` is created at sign-up and lazily, before its first push, for any save that lacks one (older accounts);
- merge keeps the **lexicographically smaller valid** `bk` (deterministic, commutative, associative, idempotent), so two
  devices that both created one converge. The loser's row, if it was already published, stays on the board until
  overwritten (honor-system board, accepted);
- nothing public derives from name or code any more, so **no PBKDF2/scrypt is needed**: guessing a code is an online
  attack again, one `get` per guess.

## Names (identity key)

The save id hashes the *key* of the name: NFKC, then every format character (`\p{Cf}`: zero-width, bidi controls,
tag characters), variation selectors, U+3164/U+115F/U+1160/U+FFA0 (Hangul fillers) and U+2800 (braille blank) are
removed, whitespace is collapsed, lower-cased (locale independent), Arabic-Indic and Eastern Arabic digits become
ASCII, tatweel and harakat are removed, alef variants fold to ا, yeh/alef maqsura/Persian yeh to ي, Persian kaf to ك.
Teh marbuta vs heh and look-alike letters from other scripts (Cyrillic а) are deliberately **not** folded. The display
name is the same text with only the invisible characters removed. A name with nothing visible left is rejected
(`invisible`). Length is counted in code points everywhere; the board name is cut to 24 code points (<= 96 bytes).
Accounts created before this change under a name that the new key folds differently would not be found; the game was
unreleased, so no migration was written.

## Timers

- **Classic**: the clock never stops. Elapsed = time since the puzzle was first shown (monotonic within a session);
  hiding the tab, sleeping or closing the page does not pause it. A reload continues it from the persisted wall-clock
  start (`elapsed = max(now - start, elapsed stored at the last save)`; the stored value is a floor, so setting the
  system clock back cannot refund more than the time since the last save).
- **Blood**: the countdown is purely monotonic (`performance.now()`) inside a session; a wall clock moved by +/-1 h never
  shortens or lengthens a run. After a reload the wall-clock deadline is used, capped by the monotonic remaining time
  stored at the last heartbeat. Unavoidable limits without a server: a clock set back while the tab is closed can refund
  the time the tab was closed (bounded by the last heartbeat), and on platforms where `performance.now()` stops during
  sleep a sleeping device pauses a running Blood run.

## Several tabs

- Every write of `lp1.save.<id>` is read-merge-write (union), so one tab cannot erase another tab's solves.
- The `storage` event keeps tabs coherent: a changed save is merged into memory and re-rendered; removing `lp1.session`
  (logout elsewhere) or replacing it with another account signs this tab out locally, and the adapter then refuses every
  write for that id (no timer can resurrect the save).
- `lp1.run.<id>` carries `owner` (per-page-load tab id) and `hb` (heartbeat, every 2 s while a Blood run is active,
  `hb: 0` written on `pagehide` to release it). Another tab seeing a heartbeat younger than 6 s does not restore or start
  a run ("A Blood run is active in another tab"); a stale heartbeat is taken over.
- A sign-up writes **nothing** to storage until the player ticks "I saved my code" (then session + save are written). A
  reload with the dialog open lands on the sign-in screen. The remote document is created at sign-up regardless; an
  unacknowledged one is an orphan nobody can find (its id needs the code that was never shown again).

## Newer saves and device storage

A cloud save whose JSON `v` differs from 1 is never merged or overwritten: sign-in answers "newer", an open session
stays local (chip `local`, notice). If the device cannot store (quota, blocked) the chip drops to `local` and a notice says
progress lives only until the tab closes.

## Service worker release token

`sw.js` has `const VERSION = '__BUILD_ID__';`. The release workflow replaces that literal with the git SHA in the **staged**
copy only (`sed -i "s/__BUILD_ID__/$GITHUB_SHA/" sw.js`). While it is `'dev'` or still the unreplaced token the worker is a
pure network passthrough and deletes every `lp1-*` cache.

## Threat model (from ADR 0002)

| Threat | Status |
|---|---|
| Strangers reading or writing a save | Need name + code to compute the id; ids cannot be enumerated (no `list`). |
| Guessing a code for a known name | **Accepted, online only.** 10^6 codes, one `get` per guess, no server-side rate limit. The **offline** oracle (board id derived from the save id) is gone: board ids come from a random key inside the save. Realistic impact is quota burn, not takeover. Upgrade path: Cloud Function + App Check (Blaze plan). |
| Reading the leaderboard to learn codes or ids | Closed. Board ids are unguessable (`bk`), unrelated to name, code and save id. |
| Forged scores | **Accepted** (honor system). Merge caps a single solve at 5000 points and a run at 5000 per solved puzzle (legit max 2400 per solve); the rules bound ranges only. |
| Clock tampering (system clock moved) | Within a session the game uses the monotonic clock only; across a reload the stored monotonic values cap what a set-back clock can refund. Residual: see "Timers". |
| Logout in one tab, another tab keeps writing | Closed: `storage` events sign the other tab out and the adapter refuses writes for the logged-out id. |
| Save from a newer app overwritten by an older one | Closed: older clients refuse to merge or push over `v != 1`. |
| Faking leaderboard scores | **Accepted.** Rows are public and writable; rules only bound ranges and deny delete. Honor system. |
| Destroying data | Rules deny `delete`. A holder of an id can overwrite that one save; the client merges rather than replaces, but a hostile writer can still replace it. |
| Storing junk / abusing as hosting | Fixed two-field schema, <900 KB, shape enforced by rules. |
| Quota exhaustion (reads) | Board list capped at 50 rows per query; key restricted by referrer. |
| Lost code | **No recovery.** The sign-up dialog makes the player acknowledge the code. |
| Privacy | Stores only the chosen display name and gameplay history. UI tells players not to use their real full name. |
| Secrets in the client | None. The Web API key is public by design; authorization is the rules. |

## Operating notes

- Rules and client must change together. The client sends exactly `{v, save}` to `players` and
  `{name,total,blood,solved,bestRun,updatedAt}` to `board`; adding a field means editing
  `firestore.rules` first, then `js/sync/remote.js`.
- The client treats HTTP 403 as "denied" and degrades to device-only without retry storms. If players
  report "saved on this device" permanently, the rules or key restriction are the first suspects.
- `firestore.rules` has not been run against the Firebase emulator in this repo (no dependencies
  allowed). The test suite's fake backend mirrors the same checks, but it is not proof the real
  rules parse: use the console's "Publish" validation and the smoke test above.
