#!/bin/sh
# Downloads and imports the cached boxel_index tables from a recent CI build.
# Best-effort: exits 0 on any failure so the normal startup flow continues.
# Called from mise-tasks/lib/dev-common.sh after migrations have run.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/env-slug.sh"

DB_NAME="${PGDATABASE:-boxel}"
PG_PORT="${PGPORT:-5435}"
REPO="cardstack/boxel"
ARTIFACT_NAME="boxel-index-cache"
DOWNLOAD_DIR="/tmp/boxel-index-cache-$$"

cleanup() {
  rm -rf "$DOWNLOAD_DIR"
}
trap cleanup EXIT

# Check if the database already has index data — if so, skip.
ROW_COUNT=$(docker exec boxel-pg psql -U postgres -d "$DB_NAME" -tAc \
  "SELECT COUNT(*) FROM realm_versions" 2>/dev/null) || ROW_COUNT=""
if [ -n "$ROW_COUNT" ] && [ "$ROW_COUNT" -gt 0 ] 2>/dev/null; then
  echo "Database already has index data ($ROW_COUNT realm versions), skipping cache import."
  exit 0
fi

# Require gh CLI
if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found, skipping index cache import."
  exit 0
fi

# Find the latest successful CI run on main
echo "Looking for cached index from CI..."
RUN_ID=$(gh run list -w ci.yaml -b main -s success -L 1 \
  --json databaseId -q '.[0].databaseId' -R "$REPO" 2>/dev/null) || RUN_ID=""
if [ -z "$RUN_ID" ]; then
  echo "No successful CI run found on main, skipping index cache import."
  exit 0
fi

# Download the artifact
echo "Downloading index cache from CI run $RUN_ID..."
if ! gh run download "$RUN_ID" -n "$ARTIFACT_NAME" -D "$DOWNLOAD_DIR" -R "$REPO" 2>/dev/null; then
  echo "Failed to download index cache artifact, skipping."
  exit 0
fi

CACHE_FILE="$DOWNLOAD_DIR/boxel-index-cache.sql.gz"
if [ ! -f "$CACHE_FILE" ]; then
  echo "Cache file not found in artifact, skipping."
  exit 0
fi

# Build the import pipeline.
# In BOXEL_ENVIRONMENT mode, remap URLs from CI standard mode (localhost:4201)
# to the environment's Traefik hostname.
if [ -n "${BOXEL_ENVIRONMENT:-}" ]; then
  SLUG=$(compute_env_slug "$BOXEL_ENVIRONMENT")
  echo "Remapping URLs: localhost:4201 -> realm-server.${SLUG}.localhost"
  gunzip -c "$CACHE_FILE" \
    | sed "s|http://localhost:4201|http://realm-server.${SLUG}.localhost|g" \
    | docker exec -i boxel-pg psql -U postgres -d "$DB_NAME" --quiet --no-psqlrc
else
  gunzip -c "$CACHE_FILE" \
    | docker exec -i boxel-pg psql -U postgres -d "$DB_NAME" --quiet --no-psqlrc
fi

IMPORT_STATUS=$?
if [ $IMPORT_STATUS -eq 0 ]; then
  echo "Index cache imported successfully."
else
  echo "Index cache import had errors (status $IMPORT_STATUS), server will reindex as needed."
fi

exit 0
