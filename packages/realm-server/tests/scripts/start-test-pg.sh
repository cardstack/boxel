#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/test-pg-config.sh"

if [ ! -f "$TEST_PG_SEED_TAR" ]; then
  echo "Seed tar not found at $TEST_PG_SEED_TAR. Run ./tests/scripts/create_seeded_db.sh first." >&2
  exit 1
fi

docker rm -f "$TEST_PG_CONTAINER" >/dev/null 2>&1 || true

start_container() {
  docker run -d \
    --name "$TEST_PG_CONTAINER" \
    -p "127.0.0.1:${TEST_PG_PORT}:5432" \
    --tmpfs /var/lib/postgresql/data:rw \
    -e POSTGRES_HOST_AUTH_METHOD=trust \
    -v "${TEST_PG_SEED_TAR}:/seed/pgdata.tar:ro" \
    -v "${SCRIPT_DIR}/boot_preseeded.sh:/usr/local/bin/pg-seeded-tmpfs-entrypoint.sh:ro" \
    --entrypoint /bin/sh \
    postgres:16.3-alpine \
    -c /usr/local/bin/pg-seeded-tmpfs-entrypoint.sh
}

print_start_diagnostics() {
  echo "=== Docker containers ===" >&2
  docker ps -a >&2 || true

  echo "=== Matching test containers ===" >&2
  docker ps -a \
    --filter "name=${TEST_PG_CONTAINER}" \
    --filter "name=${TEST_PG_SEED_CONTAINER}" >&2 || true

  echo "=== Port ${TEST_PG_PORT} listeners ===" >&2
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "( sport = :${TEST_PG_PORT} )" >&2 || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${TEST_PG_PORT}" -sTCP:LISTEN >&2 || true
  else
    echo "Neither ss nor lsof is available for port diagnostics" >&2
  fi

  echo "=== ${TEST_PG_CONTAINER} logs (if present) ===" >&2
  docker logs "$TEST_PG_CONTAINER" >&2 || true
}

cid=""
max_attempts=5
attempt=1
while [ "$attempt" -le "$max_attempts" ]; do
  if cid="$(start_container 2>&1)"; then
    break
  fi

  if printf '%s' "$cid" | grep -qi 'address already in use'; then
    if [ "$attempt" -lt "$max_attempts" ]; then
      echo "Port ${TEST_PG_PORT} still in use, retrying container start (${attempt}/${max_attempts})..." >&2
      docker rm -f "$TEST_PG_CONTAINER" >/dev/null 2>&1 || true
      sleep 1
      attempt=$((attempt + 1))
      continue
    fi
  fi

  print_start_diagnostics
  echo "$cid" >&2
  exit 1
done

if [ -z "$cid" ]; then
  echo "Failed to start $TEST_PG_CONTAINER after ${max_attempts} attempts" >&2
  print_start_diagnostics
  exit 1
fi

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
