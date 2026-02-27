#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"
. "$SCRIPTS_DIR/wait-for-prerender.sh"

wait_for_postgres

# Branch-mode configuration
if [ -n "$BOXEL_BRANCH" ]; then
  BRANCH_SLUG=$(echo "$BOXEL_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  REALM_BASE_URL="http://realm.${BRANCH_SLUG}.localdev.boxel.ai"
  WORKER_PORT=0
  PGDATABASE_VAL="boxel_${BRANCH_SLUG}"
  PRERENDER_URL="${PRERENDER_URL:-http://prerender-mgr.${BRANCH_SLUG}.localdev.boxel.ai}"
else
  REALM_BASE_URL="http://localhost:4201"
  WORKER_PORT=4210
  PGDATABASE_VAL="boxel"
  PRERENDER_URL="${PRERENDER_URL:-http://localhost:4222}"
fi

wait_for_prerender "$PRERENDER_URL"

DEFAULT_CATALOG_REALM_URL="${REALM_BASE_URL}/catalog/"
CATALOG_REALM_URL="${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}"

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
  PGPORT=5435 \
  PGDATABASE="${PGDATABASE_VAL}" \
  LOG_LEVELS='*=info' \
  REALM_SECRET_SEED="shhh! it's a secret" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  LOW_CREDIT_THRESHOLD=2000 \
  ts-node \
  --transpileOnly worker-manager \
  --allPriorityCount="${WORKER_ALL_PRIORITY_COUNT:-1}" \
  --highPriorityCount="${WORKER_HIGH_PRIORITY_COUNT:-0}" \
  --port="${WORKER_PORT}" \
  --matrixURL='http://localhost:8008' \
  --prerendererUrl="${PRERENDER_URL}" \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl="${REALM_BASE_URL}/base/" \
  \
  --fromUrl="${REALM_BASE_URL}/experiments/" \
  --toUrl="${REALM_BASE_URL}/experiments/" \
  \
  --fromUrl='@cardstack/catalog/' \
  --toUrl="${CATALOG_REALM_URL}" \
  \
  --fromUrl="${REALM_BASE_URL}/skills/" \
  --toUrl="${REALM_BASE_URL}/skills/"
