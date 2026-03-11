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
  WORKER_PORT=4210
  PGDATABASE_VAL="boxel"
  PRERENDER_URL="${PRERENDER_URL:-http://localhost:4222}"
  MATRIX_URL_VAL="http://localhost:8008"
fi

wait_for_prerender "$PRERENDER_URL"

DEFAULT_CATALOG_REALM_URL="${REALM_BASE_URL}/catalog/"
CATALOG_REALM_URL="${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}"
DEFAULT_NEW_CATALOG_REALM_URL="${REALM_BASE_URL}/catalog-new/"
NEW_CATALOG_REALM_URL="${RESOLVED_NEW_CATALOG_REALM_URL:-$DEFAULT_NEW_CATALOG_REALM_URL}"

START_EXPERIMENTS=$(if [ -z "${SKIP_EXPERIMENTS:-}" ]; then echo "true"; else echo ""; fi)
START_CATALOG=$(if [ -z "${SKIP_CATALOG:-}" ]; then echo "true"; else echo ""; fi)

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
  PGPORT=5435 \
  PGDATABASE="${PGDATABASE_VAL}" \
  LOG_LEVELS='*=info' \
  REALM_SECRET_SEED="shhh! it's a secret" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  LOW_CREDIT_THRESHOLD=2000 \
  OPENROUTER_REALM_URL="${REALM_BASE_URL}/openrouter/" \
  ts-node \
  --transpileOnly worker-manager \
  --allPriorityCount="${WORKER_ALL_PRIORITY_COUNT:-1}" \
  --highPriorityCount="${WORKER_HIGH_PRIORITY_COUNT:-0}" \
  --port="${WORKER_PORT}" \
  --matrixURL="${MATRIX_URL_VAL}" \
  --prerendererUrl="${PRERENDER_URL}" \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl="${REALM_BASE_URL}/base/" \
  \
  ${START_EXPERIMENTS:+--fromUrl="${REALM_BASE_URL}/experiments/"} \
  ${START_EXPERIMENTS:+--toUrl="${REALM_BASE_URL}/experiments/"} \
  \
  ${START_CATALOG:+--fromUrl='@cardstack/catalog/'} \
  ${START_CATALOG:+--toUrl="${CATALOG_REALM_URL}"} \
  \
  --fromUrl="${REALM_BASE_URL}/skills/" \
  --toUrl="${REALM_BASE_URL}/skills/" \
  \
  ${START_CATALOG:+--fromUrl="${NEW_CATALOG_REALM_URL}"} \
  ${START_CATALOG:+--toUrl="${NEW_CATALOG_REALM_URL}"} \
  \
  --fromUrl='@cardstack/openrouter/' \
  --toUrl="${REALM_BASE_URL}/openrouter/"
