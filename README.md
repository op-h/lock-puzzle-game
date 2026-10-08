# Lock Puzzle

A pixel-art code-cracking game. Read the clues, work out the one code that fits them all, and open the lock.
Play it relaxed in **Classic** mode or race the clock in **Blood Point** mode.

**Made by [OPH](https://github.com/op-h).** English and Arabic (RTL), built for phones first.

Live site (once GitHub Pages is enabled): https://op-h.github.io/lock-puzzle-game/

## How it plays

- Every puzzle hides a 3, 4 or 5 digit code. The clues are enough to identify **exactly one** code. The
  generator proves this by exhaustive search before a puzzle is ever shown, so there is never a second valid answer.
- Clue types: feedback on a guess (digits right and in the right place / right but in the wrong place),
  digit sum, parity of a position, compare two positions, and how many digits are even.
- Four difficulties: Rookie (3 digits, no repeats), Agent (3 digits, repeats possible), Hacker (4 digits),
  Master (5 digits).
- **Score = base x speed x accuracy x hint.** The speed bonus starts at x2 and halves its excess every "par" seconds
  (never below x0.5), each wrong guess costs 8 points of accuracy (floor 40%), and a hint halves the points.
- **Blood Point mode:** a 3:00 countdown, x2 points, a wrong guess costs 5 s, a skip costs 10 s, no hints, and
  difficulty ramps as you solve. Points from this mode are always labelled **"Blood points (from Blood mode)"** and
  shown separately from Classic points.
- **Players:** enter a name and you get a generated 6-digit code. Name + code on any device continues the same
  save. There is a log out button. Keep your code: it cannot be recovered.

The leaderboard is honor-system (scores are reported by players' devices and are not verified).

## Run it locally

No build step and no runtime dependencies.

```sh
python3 -m http.server 8000      # then open http://localhost:8000/
node --test 'tests/unit/*.test.mjs'   # unit tests (PUZZLE_SEEDS=300 for a quicker run)
```

ES modules and the service worker need http(s); opening `index.html` from `file://` will not run the game.

## Deploy on GitHub Pages

1. Repository **Settings > Pages > Source: GitHub Actions** (one-time).
2. Push to `main`. The workflow in `.github/workflows/pages.yml` runs the tests and publishes only the site files.

All URLs in the app are relative, so it works under the `/lock-puzzle-game/` project path.

## Cloud saves (one-time owner setup)

Saves work offline on the device out of the box. For cross-device sign-in, publish `firestore.rules` and enable
Firestore in the Firebase project, then restrict the web API key to this site. Step by step: [docs/backend.md](docs/backend.md).
Why it is designed this way, and what it does not protect against: [ADR 0002](docs/decisions/0002-cloud-saves-capability-code.md).

## Project map

| Path | What |
|---|---|
| `index.html`, `css/main.css`, `js/`, `sw.js` | The app: vanilla ES modules, one stylesheet, no framework |
| `js/engine/` | Puzzle generator, solver, scoring (DOM-free, unit tested) |
| `js/game/` | Classic and Blood state machines with an injectable clock |
| `js/sync/` | Name + code identity, offline-first storage, merge, Firestore REST client |
| `docs/architecture.md`, `docs/decisions/` | Architecture contract and decision records |
| `docs/design.md`, `docs/perf.md`, `docs/seo.md`, `docs/qa.md` | Design system, budgets, metadata, release checks |

The original single-file React version is in this repository's git history.

---

## بالعربي (باختصار)

لعبة كسر القفل بتصميم بكسلي (Pixel Art). كل لغز له **جواب واحد فقط** تثبته اللعبة بالبحث الشامل قبل ما تعرضه.
عندك وضع **كلاسيك** بدون وقت، ووضع **نقاط الدم (Blood)** بعدّاد ٣ دقائق ونقاط مضاعفة. السرعة تزيد النقاط.
تدخل اسمك فتاخذ رمز من ٦ أرقام، وبنفس الاسم والرمز تكمل تقدمك من أي جهاز، وفيه زر تسجيل خروج.
احفظ الرمز لأنه ما ينسترجع.

صنع بواسطة [OPH](https://github.com/op-h).
