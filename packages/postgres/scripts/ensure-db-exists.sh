#!/bin/sh

# wait until postgres inside the container accepts connections
wait_for_postgres() {
  ATTEMPTS=0
  MAX_ATTEMPTS="${PG_WAIT_ATTEMPTS:-60}"

  while [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
    if docker exec boxel-pg pg_isready -U postgres >/dev/null 2>&1; then
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

if docker exec boxel-pg psql -U postgres -w -lqt | cut -d \| -f 1 | grep -qw "$PGDATABASE"; then
  echo "Database $PGDATABASE exists"
else
  docker exec boxel-pg psql -U postgres -w -c "CREATE DATABASE $PGDATABASE"
  echo "created database $PGDATABASE"
fi
