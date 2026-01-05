#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"

wait_for_postgres

MIGRATE_FLAG=""
if [ "$MIGRATE_DB" = "true" ]; then
  MIGRATE_FLAG="--migrateDB"
fi

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
  PGPORT=5435 \
  PGDATABASE=boxel \
  LOG_LEVELS='*=info' \
  ts-node \
  --transpileOnly daily-credit-grant \
  $MIGRATE_FLAG \
  --priority="${DAILY_CREDIT_GRANT_PRIORITY:-0}"
