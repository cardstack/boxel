#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

TEST_PG_CONTAINER="${TEST_PG_CONTAINER:-boxel-realm-test-pg}"
TEST_PG_PORT="${TEST_PG_PORT:-55436}"
TEST_PG_SEED_DB="${TEST_PG_SEED_DB:-boxel_migrated}"
TEST_PG_SEED_TAR="${TEST_PG_SEED_TAR:-/tmp/boxel-realm-test-pgdata-seeded.tar}"

if [ ! -f "$TEST_PG_SEED_TAR" ]; then
  echo "Seed tar not found at $TEST_PG_SEED_TAR. Run ./tests/scripts/create_seeded_db.sh first." >&2
  exit 1
fi

docker rm -f "$TEST_PG_CONTAINER" >/dev/null 2>&1 || true

cid=$(docker run -d \
  --name "$TEST_PG_CONTAINER" \
  -p "${TEST_PG_PORT}:5432" \
  --tmpfs /var/lib/postgresql/data:rw \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -v "${TEST_PG_SEED_TAR}:/seed/pgdata.tar:ro" \
  -v "${SCRIPT_DIR}/boot_preseeded.sh:/usr/local/bin/pg-seeded-tmpfs-entrypoint.sh:ro" \
  --entrypoint /bin/sh \
  postgres:16.3-alpine \
  -c /usr/local/bin/pg-seeded-tmpfs-entrypoint.sh)

attempts=0
max_attempts=1200 # ~60s at 50ms
until docker exec "$TEST_PG_CONTAINER" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge "$max_attempts" ]; then
    echo "Timed out waiting for postgres in container $TEST_PG_CONTAINER" >&2
    docker logs "$cid" >&2 || true
    exit 1
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo false)" != "true" ]; then
    echo "Test postgres container exited before becoming ready" >&2
    docker logs "$cid" >&2 || true
    exit 1
  fi
  sleep 0.05
done

attempts=0
until docker exec "$TEST_PG_CONTAINER" psql -U postgres -h 127.0.0.1 -d postgres -Atqc "select 1" >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge "$max_attempts" ]; then
    echo "Timed out waiting for SQL round trip in $TEST_PG_CONTAINER" >&2
    docker logs "$cid" >&2 || true
    exit 1
  fi
  sleep 0.05
done

# Sanity check the migrated DB exists in the seeded cluster.
seed_db_present="$(docker exec "$TEST_PG_CONTAINER" psql -h 127.0.0.1 -U postgres -d postgres -Atqc \
  "select datname from pg_database where datname = '${TEST_PG_SEED_DB}'")"
if [ "$seed_db_present" != "$TEST_PG_SEED_DB" ]; then
  echo "Expected seeded DB '${TEST_PG_SEED_DB}' to exist in $TEST_PG_CONTAINER" >&2
  docker logs "$cid" >&2 || true
  exit 1
fi

echo "Started $TEST_PG_CONTAINER on 127.0.0.1:${TEST_PG_PORT}"
