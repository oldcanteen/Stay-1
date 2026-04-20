#!/usr/bin/env bash
#
# build-store-zip.sh — produce the zip you upload to the Chrome Web Store.
#
# What it does:
#   1. Reads the version from manifest.json.
#   2. Copies manifest.json to a temp file with the store-only tweaks:
#        • removes http://127.0.0.1/* and http://localhost/* from
#          content_scripts.matches (those are dev-only and will raise
#          reviewer questions).
#   3. Zips the project, excluding dev junk (.git, .cursor, .claude, .DS_Store,
#      editor files, test pages, older zips) and using the patched manifest.
#   4. Restores the original manifest.json so local "Load unpacked" dev
#      continues to work.
#
# Output: ./stay-<version>.zip
#
# Usage:  ./build-store-zip.sh
#

set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f manifest.json ]]; then
  echo "error: manifest.json not found in $(pwd)" >&2
  exit 1
fi

# Pull the version field out of manifest.json without needing jq.
VERSION=$(sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' manifest.json | head -n1)
if [[ -z "${VERSION}" ]]; then
  echo "error: could not parse \"version\" from manifest.json" >&2
  exit 1
fi

OUT="stay-${VERSION}.zip"
BACKUP="manifest.json.devbak"

echo "→ Building Chrome Web Store zip for version ${VERSION}"

# 1. Back up the dev manifest.
cp manifest.json "${BACKUP}"

# Trap restores the dev manifest even if anything below fails.
restore() {
  if [[ -f "${BACKUP}" ]]; then
    mv "${BACKUP}" manifest.json
    echo "→ Dev manifest restored."
  fi
}
trap restore EXIT

# 2. Strip the localhost matches from content_scripts for the store build.
#    We use a small awk program because BSD sed (macOS) doesn't do
#    multi-line pattern edits comfortably.
awk '
  /"http:\/\/127\.0\.0\.1\/\*"/ { next }   # drop localhost IPv4 line
  /"http:\/\/localhost\/\*"/     { next }  # drop localhost line
  { print }
' "${BACKUP}" > manifest.json

# Clean up a potential trailing comma left behind (",\n      ]").
#   The awk above can leave this when the *last* array entry was one of
#   the removed lines. Normalise by converting ",<ws>]" → "<ws>]".
python3 - <<'PY' manifest.json
import re, sys
p = sys.argv[1]
s = open(p).read()
# collapse ",\s*]" patterns on JSON arrays
s = re.sub(r',\s*]', lambda m: m.group(0).replace(',', '', 1), s)
open(p, 'w').write(s)
PY

# 3. Remove any prior build so the new one is clean.
rm -f "${OUT}"

# 4. Build the zip. manifest.json lives at the zip root (required).
zip -rq "${OUT}" . \
  -x ".git/*" \
     ".cursor/*" \
     ".claude/*" \
     ".vscode/*" \
     ".idea/*" \
     ".DS_Store" "*/.DS_Store" \
     ".gitignore" \
     "chatgpt-wait-extension.code-workspace" \
     "push-to-github.ps1" \
     "test.html" \
     "build-store-zip.sh" \
     "PRIVACY_POLICY.md" \
     "STORE_LISTING.md" \
     "README.md" \
     "manifest.json.devbak" \
     "*.zip"

# trap restores manifest.json on exit.

SIZE=$(du -h "${OUT}" | awk '{print $1}')
FILES=$(unzip -l "${OUT}" | tail -n 1 | awk '{print $2}')

echo
echo "✓ ${OUT} built (${SIZE}, ${FILES} files)"
echo "  Upload this file at https://chrome.google.com/webstore/devconsole"
echo
