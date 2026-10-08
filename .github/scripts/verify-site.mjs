// Pre-deploy gate on the STAGED directory (pure fs, no dependencies): the artifact must be complete and clean.
//   node .github/scripts/verify-site.mjs [_site]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.argv[2] || '_site');
const errors = [];
const fail = (m) => errors.push(m);
const exists = (rel) => fs.existsSync(path.join(root, rel));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 1. nothing that must not ship
const FORBIDDEN = [/^tests\//, /^docs\//, /^node_modules\//, /^\.git/, /^package(-lock)?\.json$/, /^firestore\.rules$/, /^firebase\.json$/, /^README\.md$/, /^_site\//, /^\.github\//, /\.test\.mjs$/, /\.spec\.mjs$/, /\.map$/];
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(path.relative(root, p).split(path.sep).join('/'));
  }
})(root);
for (const f of files) if (FORBIDDEN.some((re) => re.test(f)) && f !== '.nojekyll') fail(`forbidden file staged: ${f}`);
for (const must of ['index.html', 'sw.js', 'manifest.webmanifest', '.nojekyll', 'css/main.css', 'js/main.js', 'assets/sprites.svg', 'assets/fonts/pixelify-sans-latin.woff2']) if (!exists(must)) fail(`missing ${must}`);

// 2a. release token: the literal must be gone from the VERSION line (comments may still mention it) (otherwise the worker is a no-op passthrough) and the passthrough guard intact
const vline = /^const VERSION = '([^']*)';/m.exec(read('sw.js'));
if (!vline) fail("sw.js: `const VERSION = '...'` line not found");
else if (vline[1].startsWith('__BUILD') || vline[1] === 'dev' || !/^[A-Za-z0-9._-]{3,}$/.test(vline[1])) fail(`sw.js VERSION is not a release id: ${vline[1]}`);
if (!/VERSION\.startsWith\('__BUILD'\)/.test(read('sw.js'))) fail('sw.js PASSTHROUGH guard missing or rewritten');

// 2. every path the service worker precaches exists (the worker swallows a 404 per file, so this is the only guard)
const sw = read('sw.js');
const list = /const PRECACHE = \[([\s\S]*?)\];/.exec(sw);
if (!list) fail('sw.js: PRECACHE list not found');
else for (const m of list[1].matchAll(/'([^']+)'/g)) if (m[1] !== './' && !exists(m[1].replace(/^\.\//, ''))) fail(`sw.js precaches a missing file: ${m[1]}`);

// 3. every relative reference in index.html, the manifest and the CSS resolves, and none is root-absolute
const html = read('index.html');
for (const m of html.matchAll(/\b(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
  const u = m[1];
  if (/^(https?:|data:|mailto:)/.test(u)) continue;
  if (u.startsWith('/')) fail(`index.html: root-absolute URL ${u} breaks under /lock-puzzle-game/`);
  else if (!exists(u.replace(/^\.\//, ''))) fail(`index.html references missing ${u}`);
}
const mani = JSON.parse(read('manifest.webmanifest'));
for (const i of mani.icons) if (!exists(i.src.replace(/^\.\//, ''))) fail(`manifest icon missing: ${i.src}`);
for (const k of ['start_url', 'scope', 'id']) if (String(mani[k]).startsWith('/')) fail(`manifest ${k} is root-absolute: ${mani[k]}`);
const css = read('css/main.css');
for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
  if (m[1].startsWith('data:') || m[1].startsWith('#')) continue;
  if (m[1].startsWith('/')) fail(`css: root-absolute url ${m[1]}`);
  else if (!fs.existsSync(path.resolve(root, 'css', m[1]))) fail(`css url() missing: ${m[1]}`);
}
// module graph: every static import and import() in js/ resolves
for (const f of files.filter((x) => x.startsWith('js/'))) {
  const src = read(f);
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    if (!fs.existsSync(path.resolve(root, path.dirname(f), m[1]))) fail(`${f} imports missing ${m[1]}`);
  }
}

// 4. CSP: the meta tag exists and its sha256 is the hash of the actual inline script
const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
if (!meta) fail('index.html has no CSP meta');
else {
  const inline = /<script>([\s\S]*?)<\/script>/.exec(html);
  const h = inline ? "'sha256-" + crypto.createHash('sha256').update(inline[1], 'utf8').digest('base64') + "'" : null;
  if (!h || !meta[1].includes(h)) fail(`CSP does not contain the hash of the inline script (${h})`);
  if (/unsafe-inline|unsafe-eval/.test(meta[1])) fail('CSP allows unsafe-inline/unsafe-eval');
  if (/frame-ancestors|report-uri|sandbox/.test(meta[1])) fail('CSP meta carries a directive that is ignored in a meta element');
  if ((html.match(/<script>/g) || []).length !== 1) fail('expected exactly one attribute-less inline script');
}

// 5. no secrets: nothing that looks like a private key or token (the Firebase Web API key is a public identifier by ADR 0002)
const SECRET = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /ghp_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{30,}/, /sk-[A-Za-z0-9]{32,}/, /AKIA[0-9A-Z]{16}/, /xox[abp]-[A-Za-z0-9-]{10,}/, /"private_key"\s*:/, /client_secret/i];
for (const f of files.filter((x) => /\.(js|html|css|json|webmanifest|svg|txt|xml)$/.test(x))) for (const re of SECRET) if (re.test(read(f))) fail(`${f}: matches secret pattern ${re}`);
const keys = new Set();
for (const f of files.filter((x) => /\.(js|html)$/.test(x))) for (const m of read(f).matchAll(/AIza[0-9A-Za-z_-]{35}/g)) keys.add(m[0] + ' in ' + f);
if (keys.size > 1) fail(`more than one Google API key literal: ${[...keys].join(', ')}`);

if (errors.length) {
  console.error('verify-site FAILED:\n - ' + errors.join('\n - '));
  process.exit(1);
}
console.log(`verify-site OK: ${files.length} files, every precached/referenced path exists, CSP hash matches, nothing forbidden staged`);
