#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"

wait_for_postgres

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  PGPORT=5435 \
  PGDATABASE=boxel \
  LOG_LEVELS='*=info' \
  REALM_SECRET_SEED="shhh! it's a secret" \
  ts-node \
  --transpileOnly worker-manager \
  --allPriorityCount="${WORKER_ALL_PRIORITY_COUNT:-1}" \
  --highPriorityCount="${WORKER_HIGH_PRIORITY_COUNT:-0}" \
  --port=4210 \
  --matrixURL='http://localhost:8008' \
  --distURL="${HOST_URL:-http://localhost:4200}" \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/' \
  \
  --fromUrl='http://localhost:4201/experiments/' \
  --toUrl='http://localhost:4201/experiments/' \
  \
  --fromUrl='http://localhost:4201/seed/' \
  --toUrl='http://localhost:4201/seed/' \
  \
  --fromUrl='http://localhost:4201/catalog/' \
  --toUrl='http://localhost:4201/catalog/'
