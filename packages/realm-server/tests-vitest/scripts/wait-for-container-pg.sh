#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <container-name> <container-id-for-logs> [database]" >&2
  exit 1
fi

CONTAINER_NAME="$1"
CONTAINER_ID="$2"
DATABASE_NAME="${3:-postgres}"
MAX_ATTEMPTS=1200 # ~60s at 50ms

attempts=0
until docker exec "$CONTAINER_NAME" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge "$MAX_ATTEMPTS" ]; then
    echo "Timed out waiting for postgres in container $CONTAINER_NAME" >&2
    docker logs "$CONTAINER_ID" >&2 || true
    exit 1
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_ID" 2>/dev/null || echo false)" != "true" ]; then
    echo "Postgres container exited before becoming ready: $CONTAINER_NAME" >&2
    docker logs "$CONTAINER_ID" >&2 || true
    exit 1
  fi
  sleep 0.05
done

# Official postgres image can briefly report ready during init before final restart.
attempts=0
until docker exec "$CONTAINER_NAME" psql -U postgres -h 127.0.0.1 -d "$DATABASE_NAME" -Atqc "select 1" >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge "$MAX_ATTEMPTS" ]; then
    echo "Timed out waiting for SQL round trip in $CONTAINER_NAME (db=$DATABASE_NAME)" >&2
    docker logs "$CONTAINER_ID" >&2 || true
    exit 1
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_ID" 2>/dev/null || echo false)" != "true" ]; then
    echo "Postgres container exited before SQL round trip succeeded: $CONTAINER_NAME" >&2
    docker logs "$CONTAINER_ID" >&2 || true
    exit 1
  fi
  sleep 0.05
done
