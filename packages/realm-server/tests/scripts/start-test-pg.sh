#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/test-pg-config.sh"

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
"${SCRIPT_DIR}/wait-for-container-pg.sh" "$TEST_PG_CONTAINER" "$cid"

# Sanity check the migrated DB exists in the seeded cluster.
seed_db_present="$(docker exec "$TEST_PG_CONTAINER" psql -h 127.0.0.1 -U postgres -d postgres -Atqc \
  "select datname from pg_database where datname = '${TEST_PG_SEED_DB}'")"
if [ "$seed_db_present" != "$TEST_PG_SEED_DB" ]; then
  echo "Expected seeded DB '${TEST_PG_SEED_DB}' to exist in $TEST_PG_CONTAINER" >&2
  docker logs "$cid" >&2 || true
  exit 1
fi

echo "Started $TEST_PG_CONTAINER on 127.0.0.1:${TEST_PG_PORT}"
