#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"
. "$SCRIPTS_DIR/wait-for-prerender.sh"
. "$SCRIPTS_DIR/ensure-traefik.sh"

ensure_traefik
wait_for_postgres

# Environment-mode configuration
if [ -n "$BOXEL_ENVIRONMENT" ]; then
  ENV_SLUG=$(echo "$BOXEL_ENVIRONMENT" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  REALM_BASE_URL="http://realm-server.${ENV_SLUG}.localhost"
  WORKER_PORT=0
  PGDATABASE_VAL="boxel_${ENV_SLUG}"
  PRERENDER_URL="${PRERENDER_URL:-http://prerender-mgr.${ENV_SLUG}.localhost}"
  MATRIX_URL_VAL="http://matrix.${ENV_SLUG}.localhost"
else
  REALM_BASE_URL="http://localhost:4201"
  WORKER_PORT=4213
  PGDATABASE_VAL="boxel_base"
  PRERENDER_URL="${PRERENDER_URL:-http://localhost:4222}"
  MATRIX_URL_VAL="http://localhost:8008"
fi

wait_for_prerender "$PRERENDER_URL"

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
  PGPORT=5435 \
  PGDATABASE="${PGDATABASE_VAL}" \
  REALM_SECRET_SEED="shhh! it's a secret" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  LOW_CREDIT_THRESHOLD=2000 \
  ts-node \
  --transpileOnly worker-manager \
  --port="${WORKER_PORT}" \
  --matrixURL="${MATRIX_URL_VAL}" \
  --prerendererUrl="${PRERENDER_URL}" \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl="${REALM_BASE_URL}/base/"
