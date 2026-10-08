#!/usr/bin/env bash
# Stage ONLY the files GitHub Pages should serve into _site/. Allow-list, never a deny-list: a new file in the repo
# (tests, docs, firestore.rules, package files, .git, node_modules) cannot leak into production by accident.
# Also stamps the release token: sw.js ships `const VERSION = '__BUILD_ID__'` (service-worker passthrough, no caching,
# so a dev server never serves stale files). Only the STAGED copy gets the real id, which switches caching on.
# Usage: [BUILD_ID=<id>] .github/scripts/stage-site.sh [outdir]   (id defaults to $GITHUB_SHA, else git HEAD, else "local")
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out="${1:-$root/_site}"
rm -rf "$out"
mkdir -p "$out"
cd "$root"
# files
for f in index.html sw.js manifest.webmanifest robots.txt sitemap.xml .nojekyll; do
  [ -e "$f" ] || { echo "stage-site: missing required file $f" >&2; exit 1; }
  cp -p "$f" "$out/$f"
done
# directories: only what the page loads
for d in css js assets; do
  [ -d "$d" ] || { echo "stage-site: missing directory $d" >&2; exit 1; }
  cp -rp "$d" "$out/$d"
done
id="${BUILD_ID:-${GITHUB_SHA:-$(git -C "$root" rev-parse HEAD 2>/dev/null || echo local)}}"
id="$(printf '%s' "$id" | tr -c 'A-Za-z0-9._-' '-')"
# replace the literal on the VERSION line only; the PASSTHROUGH check compares the prefix '__BUILD' so it survives
sed -i "s/^const VERSION = '__BUILD_ID__';/const VERSION = '$id';/" "$out/sw.js"
if grep -q "^const VERSION = '__BUILD" "$out/sw.js"; then echo "stage-site: release token was not replaced" >&2; exit 1; fi
echo "release id: $id"
echo "staged $(find "$out" -type f | wc -l | tr -d ' ') files, $(du -sk "$out" | cut -f1) KB -> $out"
