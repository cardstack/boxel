#!/bin/bash
# Downloads and imports the cached boxel_index tables from a recent CI build.
# Exits 0 on success or when import is unnecessary (DB already has data).
# Exits 1 on failure. The caller uses the exit code to decide whether to
# set REALM_SERVER_FULL_INDEX_ON_STARTUP=false.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/env-slug.sh"

DB_NAME="${PGDATABASE:-boxel}"
REPO="cardstack/boxel"
ARTIFACT_NAME="boxel-index-cache"
DOWNLOAD_DIR="/tmp/boxel-index-cache-$$"

cleanup() {
  rm -rf "$DOWNLOAD_DIR"
}
trap cleanup EXIT

# Check if the database already has index data — if so, skip.
ROW_COUNT=$(docker exec boxel-pg psql -U postgres -d "$DB_NAME" -tAc \
  "SELECT COUNT(*) FROM realm_generations" 2>/dev/null) || ROW_COUNT=""
if [ -n "$ROW_COUNT" ] && [ "$ROW_COUNT" -gt 0 ] 2>/dev/null; then
  echo "Database already has index data ($ROW_COUNT realm generations), skipping cache import."
  exit 0
fi

# Require gh CLI
if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found, skipping index cache import."
  exit 1
fi

# Find the latest successful CI run on main that produced the cache artifact.
echo "Looking for cached index from CI..."
RUN_ID=$(gh run list -w ci.yaml -b main -s success -L 1 \
  --json databaseId -q '.[0].databaseId' -R "$REPO" 2>/dev/null) || RUN_ID=""
if [ -z "$RUN_ID" ]; then
  echo "No CI run with index cache found, skipping."
  exit 1
fi

# Download the artifact
echo "Downloading index cache from CI run $RUN_ID..."
if ! gh run download "$RUN_ID" -n "$ARTIFACT_NAME" -D "$DOWNLOAD_DIR" -R "$REPO" 2>/dev/null; then
  echo "Failed to download index cache artifact, skipping."
  exit 1
fi

CACHE_FILE="$DOWNLOAD_DIR/boxel-index-cache.sql.gz"
if [ ! -f "$CACHE_FILE" ]; then
  echo "Cache file not found in artifact, skipping."
  exit 1
fi

# Clear any partial data before importing.
echo "Truncating index tables..."
docker exec boxel-pg psql -U postgres -d "$DB_NAME" --quiet --no-psqlrc -c \
  "TRUNCATE boxel_index, prerendered_html, realm_generations, realm_meta"

# Import the cache into the local database.
# In BOXEL_ENVIRONMENT mode, remap URLs from CI standard mode (localhost:4201)
# to the environment's Traefik hostname.
PSQL_OPTS="-U postgres -d $DB_NAME --quiet --no-psqlrc -v ON_ERROR_STOP=1"
if [ -n "${BOXEL_ENVIRONMENT:-}" ]; then
  SLUG=$(compute_env_slug "$BOXEL_ENVIRONMENT")
  echo "Remapping URLs for environment '${SLUG}'..."
  # Match both http and https canonicals — local dev now stores
  # https://localhost:4201/... in the index (CS-11114), but older
  # cached snapshots still have http://. Either prefix in the snapshot
  # gets remapped to the env-mode Traefik hostname. Use `sed -E` (POSIX
  # ERE) so the optional-`s` quantifier works under BSD sed too — the
  # basic-regex `\?` form is a GNU extension that macOS sed treats as a
  # literal, silently skipping the remap. The destinations are https:
  # the env-mode realm server and icons host register their realms and
  # URLs under https://<service>.<slug>.localhost, so http-form rows
  # would never match a served realm and the cache would be ignored.
  gunzip -c "$CACHE_FILE" \
    | sed -E \
      -e "s|https?://localhost:4201|https://realm-server.${SLUG}.localhost|g" \
      -e "s|https?://localhost:4206|https://icons.${SLUG}.localhost|g" \
    | docker exec -i boxel-pg psql $PSQL_OPTS
else
  gunzip -c "$CACHE_FILE" \
    | docker exec -i boxel-pg psql $PSQL_OPTS
fi

echo "Index cache imported successfully."
