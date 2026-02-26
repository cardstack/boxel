#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
POSTGRES_PKG_DIR="${ROOT_DIR}/packages/postgres"
source "${SCRIPT_DIR}/test-pg-config.sh"

cleanup() {
  docker rm -f "$TEST_PG_SEED_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$TEST_PG_CACHE_DIR"

docker rm -f "$TEST_PG_SEED_CONTAINER" >/dev/null 2>&1 || true

cid=$(docker run -d \
  --name "$TEST_PG_SEED_CONTAINER" \
  -p "127.0.0.1:${TEST_PG_SEED_PORT}:5432" \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:16.3-alpine \
  -c fsync=off \
  -c full_page_writes=off \
  -c synchronous_commit=off)
"${SCRIPT_DIR}/wait-for-container-pg.sh" "$TEST_PG_SEED_CONTAINER" "$cid"

docker exec "$TEST_PG_SEED_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "CREATE DATABASE ${TEST_PG_SEED_DB};"

(
  cd "$POSTGRES_PKG_DIR"

  PGHOST=127.0.0.1 \
  PGPORT="${TEST_PG_SEED_PORT}" \
  PGUSER=postgres \
  PGDATABASE="${TEST_PG_SEED_DB}" \
  pnpm exec node-pg-migrate \
    --migrations-table migrations \
    --check-order false \
    --no-verbose \
    up
)

# Pre-create a template DB in the seed for future test-db cloning paths.
docker exec "$TEST_PG_SEED_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "CREATE DATABASE ${TEST_PG_SEED_DB}_template TEMPLATE ${TEST_PG_SEED_DB};"
docker exec "$TEST_PG_SEED_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "ALTER DATABASE ${TEST_PG_SEED_DB}_template WITH IS_TEMPLATE true;"

# Clean shutdown so PGDATA is consistent before snapshotting.
docker stop "$TEST_PG_SEED_CONTAINER" >/dev/null

# Snapshot PGDATA.
docker cp "$TEST_PG_SEED_CONTAINER":/var/lib/postgresql/data - > "$TEST_PG_SEED_TAR"

docker rm "$TEST_PG_SEED_CONTAINER" >/dev/null
trap - EXIT

echo "Seed snapshot written to $TEST_PG_SEED_TAR"
