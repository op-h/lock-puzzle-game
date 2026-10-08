# Discoverability: IA, metadata, structured data, analytics (BEACON)

Owner: BEACON. Last updated 2026-10-07. Scope: `<head>` of `index.html`, `manifest.webmanifest`, `robots.txt`,
`sitemap.xml`, this file. GRANITE owns `<body>`, CIRCUIT owns `js/` and `sw.js`, SENTRY owns headers/CSP.

TODO(content): "Lock Puzzle" is a working title, not a brand (see the same note in `index.html` and `docs/design.md`).
When a real name is chosen, change it in all of: `<title>`, `og:title`, `og:site_name`, `twitter:title`,
`application-name`, JSON-LD `name`, manifest `name`/`short_name`, `assets/og.png` (QUARTZ redraws it), and the `<body>` brand.
TODO(content): the Arabic UI has no Arabic metadata (see 2, "Language").

## 1. Information architecture

One public URL: `https://op-h.github.io/lock-puzzle-game/`. It is a single-page app shell (ADR 0001) with six screens
(`auth`, `home`, `play`, `result`, `board`, `help`) switched client-side with hash routes.

Why that is the right IA here, and why there are no separate indexable pages:
- The screens are states of one tool, not documents. `play` and `result` depend on a live round; `home` and `board` depend on a
  signed-in player and cloud data; `auth` is a form. Giving them their own URLs would index empty or per-user shells.
- A URL fragment (`#home`) is never sent to the server and search engines treat it as the same page, so hash routes cannot be
  indexed separately. That is intended: there is nothing to rank except the entry page.
- The entry page already carries crawlable text without running JS: the visible Auth section (h1 "Welcome to Lock Puzzle", the intro)
  and the `<noscript>` rules (goal, clue types, worked example, scoring, Blood mode) are in the raw HTML.
- GitHub Pages serves static files only: separate URLs for screens would need 404 handling and duplicate shells.

Revisit only if the owner wants a content page that should rank (for example a standalone rules or strategy page). That would be a real
new HTML file, one purpose, one h1, its own title/description/canonical, added to the sitemap, and linked from the footer by GRANITE.

Headings: each screen section has one `h1`; exactly one screen is visible at a time (architecture.md), so a rendered page has one visible h1.
Report to GRANITE if more than one screen is ever visible.

## 2. Metadata spec (what is in `<head>` and why)

Head order, as shipped: `charset`, `viewport`, inline pre-paint script, `title`, `description`, `canonical`, `robots`, `author`,
`application-name`, two `theme-color`, `color-scheme`, icons + manifest, Open Graph, Twitter, font preload, `modulepreload` x6,
JSON-LD, stylesheet, module script. `charset` stays first (must be in the first 1024 bytes). The whole head is a few KB, which fits the first
TCP flight, and the browser's preload scanner reads ahead of the parser, so the preloads and stylesheet are discovered immediately even
though they sit after the metadata. The inline script sits before the stylesheet on purpose, so `lang` and `dir` are final before first paint.

| Item | Value | Why |
|---|---|---|
| `<title>` | `Lock Puzzle: Code-Cracking Logic Puzzle Game` (44 chars) | Name first, then what it is. Under 60 so it is not truncated in results. No em dash (house copy rule). |
| `meta description` | 151 chars: crack the code from logic clues, pixel-art, Classic at your own pace, 3-minute Blood mode, English and Arabic | Benefit-led and true: every claim exists in the app (Classic has no time limit, Blood is a 3:00 countdown, language toggle). Under 155. |
| `link canonical` | `https://op-h.github.io/lock-puzzle-game/` (trailing slash) | One URL for one page; `?query` and `#hash` variants collapse to it. Absolute is required for canonical to be reliable. |
| `meta robots` | `index,follow,max-image-preview:large` | Allows the large social/search image. No `noindex` anywhere. |
| `meta author` | `OPH` | Matches the visible credit "Made by OPH". |
| `meta application-name` | `Lock Puzzle` | Name used when pinned or installed on desktop browsers. |
| `theme-color` x2 | `#12151C` (dark), `#D9DEEA` (light), each with `media="(prefers-color-scheme: ...)"` | Values from design.md 10.3. Browser chrome follows the OS scheme. The manifest carries the dark value only (a manifest cannot switch by scheme). |
| `color-scheme` | `dark light` | Native controls and the canvas default match the scheme before CSS loads (DoD 5). |
| Icons | `favicon.svg` (`sizes="any"`), PNG 192 and 512, `apple-touch-icon` 180 | All relative paths so the project-site subpath works. `sizes="any"` stops Chrome preferring a raster over the SVG. No `.ico` is shipped: see RISKS. |
| `link manifest` | `./manifest.webmanifest` | Installability metadata; relative for the `/lock-puzzle-game/` subpath. |
| Open Graph | type `website`, site_name, title, description, url, image (absolute, 1200x630, `image/png`, alt), locale `en_US`, alternate `ar_AR` | `og:url` and `og:image` must be absolute; they use the canonical base. Width and height let scrapers lay out the card before downloading the image. |
| Twitter | `summary_large_image`, title, description, image, image:alt | X falls back to OG for most fields; the explicit tags are the documented minimum. No `twitter:site`/`creator`: no account is known, and none is invented. |
| Font preload | `./assets/fonts/pixelify-sans-latin.woff2`, `as="font" type="font/woff2" crossorigin` | QUARTZ verdict (perf.md 2.3): recommended, about one RTT earlier font swap, same URL as the `@font-face` so it is a cache hit. `crossorigin` is mandatory even same-origin. Does not move LCP. QUARTZ owns the measurement that confirms or deletes it. |
| `modulepreload` x6 | `main.js`, `i18n/en.js`, `sync/sync.js`, `sync/merge.js`, `sync/identity.js`, `ui/auth.js` | CIRCUIT's first-load list, in dependency order, to cut the ES-module waterfall (perf.md section 4). All six files exist. If CIRCUIT moves any of them to a lazy `import()`, remove it here, or the browser logs a "preloaded but not used" warning (DoD 7). |
| JSON-LD | one `VideoGame` block | See 5. |

Alt text of `assets/og.png` was written from the actual image (checked 2026-10-07): dark blue framed card, left a pixel-art vault door
(steel-blue plate, four white corner bolts, amber wheel with a black cross, green lamp at top), right the amber words "Lock Puzzle", a
rule line, and "Made by OPH". If QUARTZ redraws the image, rewrite `og:image:alt` and `twitter:image:alt` to match.

Language. Crawlers do not run the language toggle, so the title, description and card are English only. `og:locale:alternate` is declared
because the app does ship an Arabic UI, but there is one URL, so no `hreflang` is used (hreflang needs one URL per language). Arabic
metadata would need a second URL; not worth it for an app shell. TODO(content): decide whether an Arabic landing page is wanted.

### Preconnect to Firestore: not added

Verdict: no `<link rel="preconnect" href="https://firestore.googleapis.com">` (and no `dns-prefetch`).
- Privacy: any preconnect makes every visitor's browser contact a Google host at page load, before the player has done anything.
  architecture.md allows Firestore only after a user action or on resume of an existing session, and says "never before consent-free
  first paint". A hint breaks that promise for visitors who never sign in, and it would be the only third-party origin on first paint
  (perf.md budget: 0).
- Perf: the connection costs DNS + TLS on a throttled phone (about 2-3 RTT at 150 ms) in parallel with the LCP-critical CSS, for a
  request most first-time visitors never make.
- Upside is small: it would only speed up the resume of an existing session by roughly one connection setup.
- If QUARTZ measures that resume latency matters, the safe version is to inject the preconnect from JS only when `lp1.session` exists
  in localStorage (CIRCUIT), never in static HTML. That needs a CSP/privacy note from SENTRY and an ATLAS decision.

## 3. The inline pre-paint script: exact bytes (for the CSP hash)

SENTRY hashes this script for `script-src 'sha256-...'`. A hash covers the exact characters between `<script>` and `</script>`: one
changed space, quote or newline gives a different hash and the browser blocks the script. **Never reformat, minify or edit it. A change
needs a new hash from SENTRY in the same commit.** Source of truth is the `index.html` `<head>`; the text, with no leading or trailing
whitespace or newline inside the tags, is:

```
try{var l=localStorage.getItem('lp1.lang')||(/^ar/i.test(navigator.language)?'ar':'en');document.documentElement.lang=l;document.documentElement.dir=l==='ar'?'rtl':'ltr'}catch(e){}
```

Properties: one line, LF only (no CR; keep `.gitattributes`/editor from converting line endings, though no newline is inside the script),
ASCII only, single quotes, no trailing semicolon. The line before it in `index.html` is an HTML comment, which is outside the hashed
content and may be edited freely.

Compute the hash without retyping the snippet (no quoting problems, run from the project root):

```sh
python3 -I - <<'PY'
import re, hashlib, base64
html = open('index.html', encoding='utf-8').read()
m = re.search(r'<script>(.*?)</script>', html, re.S)
print('chars:', len(m.group(1)))
print("'sha256-" + base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode() + "'")
PY
```
The first `<script>` with no attributes in the file is this one (the module script and JSON-LD carry attributes). If GRANITE ever adds
another attribute-less inline script above it, the regex must be tightened. The JSON-LD block is a data block (`type="application/ld+json"`),
never executed, so CSP `script-src` does not apply to it and it needs no hash.

## 4. Crawlability

- `robots.txt`: allow all, absolute `Sitemap:` line. **Limit worth knowing:** crawlers only read `robots.txt` at the host root
  (`https://op-h.github.io/robots.txt`), which belongs to the `op-h.github.io` user-site repo, not this project. The file shipped here
  is correct documentation of intent and works if the project later moves to a custom domain, but today search engines will ignore it.
  Nothing here needs blocking, so the practical effect is nil. Same for the `Sitemap:` line: submit the sitemap in Search Console instead.
- `sitemap.xml`: the one real URL. No `lastmod` on purpose: a date that is not kept in step with real changes is worse than none.
  Hash routes are not listed (not indexable).
- Status codes: GitHub Pages returns 200 for the page and a plain 404 for unknown paths; there are no redirects to maintain. The
  canonical keeps a trailing slash, and Pages redirects `/lock-puzzle-game` to `/lock-puzzle-game/` itself.
- `.nojekyll` (QUARTZ) already stops Jekyll from touching `manifest.webmanifest` or underscore paths.
- Search Console: add a URL-prefix property for `https://op-h.github.io/lock-puzzle-game/`, verify with the HTML-tag or file method
  (owner action, creates one extra token in the head or a file), then submit `sitemap.xml`.

BLOCKED (human): GitHub Pages is not enabled on `github.com/op-h/lock-puzzle-game` yet. Until it is (Settings > Pages > deploy from
branch / Actions, HTTPS enforced), every absolute URL in this file 404s and social cards cannot be checked. If the final URL differs
(custom domain, different repo name), update: canonical, `og:url`, `og:image`, `twitter:image`, JSON-LD (`@id`, `url`, `image`),
`robots.txt`, `sitemap.xml`. Those are the only absolute URLs in the project.

## 5. Structured data

One JSON-LD block in the head, type `VideoGame`. Why not `WebApplication` + `Game`: schema.org defines `VideoGame` as a `Game` and a
`SoftwareApplication`, with `gamePlatform`, `playMode` and `applicationCategory` available, so one type is enough and no second node is
needed. Fields used, all backed by visible content or facts the owner stated:

| Property | Value | Backing |
|---|---|---|
| `name`, `url`, `@id`, `image` | working title, canonical, `#game` fragment, og.png | the page itself |
| `description` | one sentence on the browser game with Classic and Blood modes | home screen copy |
| `applicationCategory` | `Game` | |
| `gamePlatform` | `Web browser` | |
| `genre` | `Puzzle`, `Logic` | the puzzles are logic/deduction |
| `playMode` | `https://schema.org/SinglePlayer` | one player per round; the leaderboard is a score list, not multiplayer |
| `inLanguage` | `en`, `ar` | language toggle |
| `isAccessibleForFree` | `true` | no purchase exists in the app |
| `author`, `creator` | Person "OPH", `sameAs` https://github.com/op-h | visible credit "Made by OPH" links there |

Deliberately absent: `aggregateRating`, `review`, `offers`, `operatingSystem`, `datePublished`, `publisher`, `numberOfPlayers`. There are no
ratings or reviews, no price object, and no dates or facts we can state truthfully. Add them only with real data.
Google has no rich-result type for `VideoGame`, so expect no visual enhancement; the block is for machine-readable identity only.

Validate:
1. Parses as JSON (offline):
   ```sh
   python3 -I - <<'PY'
   import re, json
   h = open('index.html', encoding='utf-8').read()
   m = re.search(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)
   d = json.loads(m.group(1)); print('ok', d['@type'], d['url'])
   PY
   ```
2. Once Pages is live: paste the URL into https://validator.schema.org/ (the Schema Markup Validator). Expect 0 errors and 0 warnings for
   `VideoGame`. (Google's Rich Results Test does not support this type; do not treat its "no items" as a failure.)
3. When the visible name, languages or modes change, edit the JSON-LD in the same commit. Structured data that disagrees with the page is
   a manual-action risk.

## 6. Social preview verification (after Pages is live)

1. `curl -sI https://op-h.github.io/lock-puzzle-game/assets/og.png` returns 200 and `content-type: image/png`; the file is 1200x630 and
   about 3 KB (well under every platform's size limit).
2. `curl -s https://op-h.github.io/lock-puzzle-game/ | grep -E 'og:|twitter:|canonical'` lists the tags. Scrapers read raw HTML only, so
   they must be in the served file, not injected by JS (they are static).
3. Run the URL through Facebook's Sharing Debugger (https://developers.facebook.com/tools/debug/), LinkedIn's Post Inspector
   (https://www.linkedin.com/post-inspector/), and a Bluesky/Mastodon compose box (they fetch the card live). X has no public validator now:
   paste the link in a draft post. Press "Scrape again" in the Facebook tool after any change; platforms cache cards for days.
4. Confirm: large image card, title and description as in 2, the picture shows the vault door and "Lock Puzzle", alt text appears where the
   platform supports it, no broken-image icon, HTTPS everywhere.
5. Check the install metadata: Chrome DevTools > Application > Manifest shows no errors, 3 icons load, "Installability" has no blockers
   that are BEACON's (a service worker is CIRCUIT's).

## 7. Analytics: event dictionary

**Current state: the site has no analytics, no cookies, no tracking script, and sends no request to any measurement service.**
**Recommendation: keep it that way by default.** The audience is mostly casual players on phones, the app already has a
personal-data surface (player names, public leaderboard), and the two success metrics that matter (does the game get used, does it get
finished) are not worth a privacy trade for a hobby project. Do not add analytics unless the owner asks for numbers.

If the owner does want metrics, the only acceptable shape is:
- Cookieless and consent-free by construction: no cookie, no localStorage/sessionStorage identifier, no fingerprinting, no IP stored,
  no cross-day or cross-site visitor id. Aggregate counters only: "N times this happened today".
- Counts only; no per-user stream. Events are not queued offline (a queue is a stored log); if the send fails, the event is dropped.
- Honors `navigator.doNotTrack === "1"` and Global Privacy Control (`navigator.globalPrivacyControl === true`): send nothing.
- Either self-hosted (a counter endpoint the owner runs) or a vendor whose product is cookieless and aggregate-only (for example
  GoatCounter, Plausible or Umami in their cookieless configurations; BEACON names them as examples, not as a decision, and has not
  verified current terms).
- It is a **new third-party origin**, which today violates architecture.md ("zero requests to third-party origins except Firestore")
  and the perf budget. So it needs: an ATLAS ADR (what, which vendor, gzipped cost, why), a CSP `script-src`/`connect-src` change from
  SENTRY, and CIRCUIT to implement behind one function. No analytics script has been added by this change.
- Whether "no consent needed" holds depends on jurisdiction and the vendor's data handling; that is a legal call for the owner, not BEACON.

### Events worth counting (maximum six; all are counters, `snake_case`, fired only after the action succeeded)

| Event | Properties (closed sets, no free text) | Fires when | Question it answers |
|---|---|---|---|
| `sign_up_completed` | none | the player ticked "I saved my code" and continued (not on dialog open) | Do people get past the first screen? |
| `sign_in_succeeded` | none | a name + code sign-in was accepted | Do returning players come back on another device? |
| `classic_solved` | `difficulty`: `rookie` \| `agent` \| `hacker` \| `master` | a Classic puzzle was solved | Which difficulties are actually played and finished? |
| `blood_run_finished` | `solved_bucket`: `0` \| `1-2` \| `3-5` \| `6+` (proposed buckets; tune once there is data) | a Blood run ended (time up or quit) | Is Blood too hard or too easy? Bucketed so no exact score is sent. |
| `lang_switched` (optional) | `to`: `en` \| `ar` | the language button was used | Is the Arabic UI used enough to justify more investment? |

Total: four core events plus one optional. A page view, if the chosen tool counts it, is the aggregate "visits" number and needs no event.

### Never record

- Player names, the 6-digit code, player ids, `boardId`, save contents, the `lp1.*` storage keys or their values.
- Exact scores, times, guesses, puzzle ids or seeds, history rows (a rare score identifies a leaderboard player).
- `copy_code`, any share action, any code-dialog interaction other than the aggregate `sign_up_completed`. The code is a credential.
- Sign-in failures, which name or code half was wrong (the app deliberately hides that), error text, or anything that helps guess codes.
- Anything per-user or per-session: user id, session id, device id, fingerprint, IP, precise location, referrer path beyond the origin,
  timestamps finer than a day.
- Free text of any kind. Event properties must be one of the enumerated values above.
- Leaderboard views, hint usage and scroll/click heatmaps (not needed to answer any question above, and heatmaps need session recording).
