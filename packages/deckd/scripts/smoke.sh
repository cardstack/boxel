#!/usr/bin/env bash
# Smoke-test deckd against a temp depot. Requires: curl, jq, deckd on :8787, jj.
# History-only layout check (identity JS; esbuild plane optional).
set -euo pipefail
BASE="${DECKD_URL:-http://127.0.0.1:8787}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPOT="${SMOKE_DEPOT:-$ROOT/smoke-depot}"
rm -rf "$DEPOT"
mkdir -p "$DEPOT/demo/hello"
cat >"$DEPOT/demo/hello/hello.js" <<'EOF'
export const greeting = 'smoke';
EOF

curl -sf "$BASE/health" | grep -q ok
curl -sf -X POST "$BASE/ensure" -H 'content-type: application/json' \
  -d "{\"dir\":\"$DEPOT\",\"watch\":true}" >/dev/null

# Thin stub: .jj/repo is a file pointer; store under .deck/history/repo.
test -d "$DEPOT/.deck/history/repo"
test -f "$DEPOT/.jj/repo"
test -d "$DEPOT/.jj/working_copy"
test ! -L "$DEPOT/.jj"
test ! -e "$DEPOT/.deck/history/.jj"
test ! -e "$DEPOT/.git"
grep -q '\.deck/history/repo' "$DEPOT/.jj/repo"

CHANGE=$(curl -sf -X POST "$BASE/seal" -H 'content-type: application/json' \
  -d "{\"dir\":\"$DEPOT\",\"message\":\"first\",\"actor\":{\"name\":\"vale\",\"email\":\"vale@boxel.ai\"}}" \
  | jq -r '.changeId')
test -n "$CHANGE" && test "$CHANGE" != null

PATHS=$(curl -sf -X POST "$BASE/file-list-at" -H 'content-type: application/json' \
  -d "{\"dir\":\"$DEPOT\",\"revisionId\":\"$CHANGE\"}")
echo "$PATHS" | jq -e '.paths | index("demo/hello/hello.js")' >/dev/null
LEAK=$(echo "$PATHS" | jq '[.paths[] | select(startswith(".deck/") or startswith(".jj/"))]|length')
test "$LEAK" = "0"

echo " second" >>"$DEPOT/demo/hello/hello.js"
CHANGE2=$(curl -sf -X POST "$BASE/seal" -H 'content-type: application/json' \
  -d "{\"dir\":\"$DEPOT\",\"message\":\"second\"}" | jq -r '.changeId')
test -n "$CHANGE2"

LIST=$(curl -sf -X POST "$BASE/list" -H 'content-type: application/json' -d "{\"dir\":\"$DEPOT\"}")
COUNT=$(echo "$LIST" | jq 'length')
test "$COUNT" -ge 2
echo "$LIST" | jq -e "map(.changeId) | index(\"$CHANGE\")" >/dev/null
echo "$LIST" | jq -e "map(select(.changeId == \"$CHANGE\"))[0].author == \"vale\"" >/dev/null

# Watchexec-shaped FS plane: mutate without HTTP /seal; debounce (~400ms) must seal.
BEFORE=$COUNT
echo " watch-plane" >>"$DEPOT/demo/hello/hello.js"
# Allow note debounce + spawn_blocking seal.
sleep 1.2
LIST=$(curl -sf -X POST "$BASE/list" -H 'content-type: application/json' -d "{\"dir\":\"$DEPOT\"}")
COUNT=$(echo "$LIST" | jq 'length')
test "$COUNT" -gt "$BEFORE"
TIP=$(echo "$LIST" | jq -r '.[0].changeId')
DESC=$(echo "$LIST" | jq -r '.[0].description')
echo "$DESC" | grep -q 'hello.js'

echo "smoke ok — steps=$COUNT tip=$TIP watch_seal=ok depot=$DEPOT"
