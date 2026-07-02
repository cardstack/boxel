#!/usr/bin/env bash
# Restore the realm index from a CI-built cache instead of indexing live.
#
# CI's `cache-index` job (.github/workflows/ci.yaml) indexes every realm and
# uploads a `pg_dump --data-only` of boxel_index / realm_versions / realm_meta
# as the `boxel-index-cache` artifact. Importing it turns the multi-minute
# prerender indexing into a seconds-long SQL restore.
#
# This is the gh-free sibling of scripts/import-cached-index.sh: this cloud
# session cannot reach api.github.com directly (it 403s — only the Claude
# GitHub MCP integration can read Actions), so this script imports from a
# LOCAL cache file rather than calling `gh run download`. A Claude session
# fetches the artifact via the Actions API (MCP) and drops it at the default
# path below; `gh` is still used as a fallback for devs who have it.
#
# Exit 0 = index restored (caller should boot with
#          REALM_SERVER_FULL_INDEX_ON_STARTUP=false).
# Exit 1 = nothing imported (DB already warm, no cache, or import failed);
#          caller should let the realm-server index live.
set -uo pipefail

REPO="cardstack/boxel"
DB_NAME="${PGDATABASE:-boxel}"
CACHE_FILE="${BOXEL_INDEX_CACHE_FILE:-$HOME/.local/share/boxel/index-cache/boxel-index-cache.sql.gz}"

# Already warm? The realm-server persists its index in boxel-pg; if the volume
# survived from a previous session there's nothing to restore.
ROW_COUNT=$(docker exec boxel-pg psql -U postgres -d "$DB_NAME" -tAc \
  "SELECT COUNT(*) FROM realm_versions" 2>/dev/null) || ROW_COUNT=""
if [ -n "$ROW_COUNT" ] && [ "$ROW_COUNT" -gt 0 ] 2>/dev/null; then
  echo "[index-cache] DB already has index data ($ROW_COUNT realm versions); skipping import."
  exit 1
fi

# Fall back to `gh` when a local cache file isn't present and the CLI exists.
if [ ! -f "$CACHE_FILE" ] && command -v gh >/dev/null 2>&1; then
  RUN_ID=$(gh run list -w ci.yaml -b main -s success -L 1 \
    --json databaseId -q '.[0].databaseId' -R "$REPO" 2>/dev/null) || RUN_ID=""
  if [ -n "$RUN_ID" ]; then
    echo "[index-cache] Downloading cache from CI run $RUN_ID via gh…"
    mkdir -p "$(dirname "$CACHE_FILE")"
    gh run download "$RUN_ID" -n boxel-index-cache \
      -D "$(dirname "$CACHE_FILE")" -R "$REPO" 2>/dev/null || true
  fi
fi

if [ ! -f "$CACHE_FILE" ]; then
  echo "[index-cache] No cache file at $CACHE_FILE (and no gh download); will index live."
  echo "[index-cache] To use a cache, fetch the boxel-index-cache artifact from a"
  echo "[index-cache] successful main CI run into that path (a Claude session can do"
  echo "[index-cache] this via the GitHub Actions API; raw api.github.com is blocked here)."
  exit 1
fi

# The data-only dump needs the schema to exist, so migrate first. Idempotent.
echo "[index-cache] Migrating schema before restore…"
if ! mise exec -- pnpm --dir=packages/realm-server migrate >/dev/null 2>&1; then
  echo "[index-cache] Migration failed; will index live." >&2
  exit 1
fi

echo "[index-cache] Restoring index from $CACHE_FILE …"
docker exec boxel-pg psql -U postgres -d "$DB_NAME" --quiet --no-psqlrc -c \
  "TRUNCATE boxel_index, realm_versions, realm_meta" || { echo "[index-cache] truncate failed" >&2; exit 1; }

# The cache stores https://localhost:4201/... URLs, which is exactly the
# standard-dev runtime origin — no remapping needed (unlike env mode).
if gunzip -c "$CACHE_FILE" \
  | docker exec -i boxel-pg psql -U postgres -d "$DB_NAME" --quiet --no-psqlrc -v ON_ERROR_STOP=1; then
  RESTORED=$(docker exec boxel-pg psql -U postgres -d "$DB_NAME" -tAc \
    "SELECT COUNT(*) FROM realm_versions" 2>/dev/null)
  echo "[index-cache] Restored ($RESTORED realm versions). Realm server will boot without a full index."
  exit 0
fi

echo "[index-cache] Import failed; truncating partial data and indexing live." >&2
docker exec boxel-pg psql -U postgres -d "$DB_NAME" --quiet --no-psqlrc -c \
  "TRUNCATE boxel_index, realm_versions, realm_meta" >/dev/null 2>&1 || true
exit 1
