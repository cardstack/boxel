#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"
. "$SCRIPTS_DIR/wait-for-prerender.sh"

wait_for_postgres
PRERENDER_URL="${PRERENDER_URL:-http://localhost:4222}"
wait_for_prerender "$PRERENDER_URL"

DEFAULT_CATALOG_REALM_URL='http://localhost:4201/catalog/'
CATALOG_REALM_URL="${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}"

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
  PGPORT=5435 \
  PGDATABASE=boxel \
  LOG_LEVELS='*=info' \
  REALM_SECRET_SEED="shhh! it's a secret" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  LOW_CREDIT_THRESHOLD=2000 \
  ts-node \
  --transpileOnly worker-manager \
  --allPriorityCount="${WORKER_ALL_PRIORITY_COUNT:-1}" \
  --highPriorityCount="${WORKER_HIGH_PRIORITY_COUNT:-0}" \
  --port=4210 \
  --matrixURL='http://localhost:8008' \
  --prerendererUrl="${PRERENDER_URL}" \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/' \
  \
  --fromUrl='http://localhost:4201/experiments/' \
  --toUrl='http://localhost:4201/experiments/' \
  \
  --fromUrl="${CATALOG_REALM_URL}" \
  --toUrl="${CATALOG_REALM_URL}" \
  \
  --fromUrl='http://localhost:4201/skills/' \
  --toUrl='http://localhost:4201/skills/'
