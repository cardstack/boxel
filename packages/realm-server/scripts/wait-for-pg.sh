#! /bin/sh

wait_for_postgres() {
  COUNT=0
  MAX_ATTEMPTS=10

  check_postgres_ready() {
    docker exec boxel-pg pg_isready -U postgres >/dev/null 2>&1
  }
  # remove this check after the feature flag is removed
  if [ -n "$PG_INDEXER" ]; then
    while ! check_postgres_ready; do
      if [ $COUNT -eq 0 ]; then
        echo "Waiting for postgres"
      fi
      if [ $COUNT -eq $MAX_ATTEMPTS ]; then
        echo "Failed to detect postgres after $MAX_ATTEMPTS attempts."
        exit 1
      fi
      COUNT=$((COUNT + 1))
      printf '.'
      sleep 5
    done
  fi
}
