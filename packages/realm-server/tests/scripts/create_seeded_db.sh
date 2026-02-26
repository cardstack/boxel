#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
POSTGRES_PKG_DIR="${ROOT_DIR}/packages/postgres"

SEED_CONTAINER="${TEST_PG_SEED_CONTAINER:-boxel-realm-test-pg-seed-build}"
SEED_PORT="${TEST_PG_SEED_PORT:-55435}"
SEED_DB="${TEST_PG_SEED_DB:-boxel_migrated}"
SEED_TAR="${TEST_PG_SEED_TAR:-/tmp/boxel-realm-test-pgdata-seeded.tar}"

cleanup() {
  docker rm -f "$SEED_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$(dirname "$SEED_TAR")"

docker rm -f "$SEED_CONTAINER" >/dev/null 2>&1 || true

cid=$(docker run -d \
  --name "$SEED_CONTAINER" \
  -p "${SEED_PORT}:5432" \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:16.3-alpine \
  -c fsync=off \
  -c full_page_writes=off \
  -c synchronous_commit=off)

attempts=0
max_attempts=1200 # ~60s at 50ms
until docker exec "$SEED_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge "$max_attempts" ]; then
    echo "Timed out waiting for seed postgres container $SEED_CONTAINER" >&2
    docker logs "$cid" >&2 || true
    exit 1
  fi
  sleep 0.05
done

# Official postgres image can briefly report ready during init before final restart.
attempts=0
until docker exec "$SEED_CONTAINER" psql -U postgres -d postgres -Atqc "select 1" >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge "$max_attempts" ]; then
    echo "Timed out waiting for SQL round trip in seed container $SEED_CONTAINER" >&2
    docker logs "$cid" >&2 || true
    exit 1
  fi
  sleep 0.05
done

docker exec "$SEED_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "CREATE DATABASE ${SEED_DB};"

(
  cd "$POSTGRES_PKG_DIR"

  PGHOST=127.0.0.1 \
  PGPORT="${SEED_PORT}" \
  PGUSER=postgres \
  PGDATABASE="${SEED_DB}" \
  pnpm exec ts-node --transpileOnly ./scripts/fix-migration-names.ts

  PGHOST=127.0.0.1 \
  PGPORT="${SEED_PORT}" \
  PGUSER=postgres \
  PGDATABASE="${SEED_DB}" \
  pnpm exec node-pg-migrate \
    --migrations-table migrations \
    --check-order false \
    up
)

# Pre-create a template DB in the seed for future test-db cloning paths.
docker exec "$SEED_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "CREATE DATABASE ${SEED_DB}_template TEMPLATE ${SEED_DB};"
docker exec "$SEED_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "ALTER DATABASE ${SEED_DB}_template WITH IS_TEMPLATE true;"

# Clean shutdown so PGDATA is consistent before snapshotting.
docker stop "$SEED_CONTAINER" >/dev/null

# Snapshot PGDATA.
docker cp "$SEED_CONTAINER":/var/lib/postgresql/data - > "$SEED_TAR"

docker rm "$SEED_CONTAINER" >/dev/null
trap - EXIT

echo "Seed snapshot written to $SEED_TAR"
