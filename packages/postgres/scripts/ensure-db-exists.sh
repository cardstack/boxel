#!/bin/sh

# wait until postgres inside the container accepts connections
wait_for_postgres() {
  ATTEMPTS=0
  MAX_ATTEMPTS="${PG_WAIT_ATTEMPTS:-60}"

  while [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
    if docker exec boxel-pg pg_isready -h localhost -p 5432 -U postgres >/dev/null 2>&1; then
      return 0
    fi

    ATTEMPTS=$((ATTEMPTS + 1))
    sleep 1
  done

  echo "Timed out waiting for Postgres to become ready after $MAX_ATTEMPTS seconds" >&2
  return 1
}

if ! wait_for_postgres; then
  exit 1
fi

# Force TCP to localhost inside the container: postgres:16.3's image does
# not always create the /var/run/postgresql unix socket, so a bare
# `psql -U postgres` from inside the container fails with
# `connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed`.
# Postgres listens on `*:5432` inside the container (POSTGRES_HOST_AUTH_METHOD
# trust), so `-h localhost -p 5432` works regardless of socket availability.
# Also exit non-zero when CREATE DATABASE fails so the migrate step doesn't
# silently move on to a missing database.
set -e
if docker exec boxel-pg psql -h localhost -p 5432 -U postgres -w -lqt | cut -d \| -f 1 | grep -qw "$PGDATABASE"; then
  echo "Database $PGDATABASE exists"
else
  docker exec boxel-pg psql -h localhost -p 5432 -U postgres -w -c "CREATE DATABASE $PGDATABASE"
  echo "created database $PGDATABASE"
fi
