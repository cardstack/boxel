#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"
. "$SCRIPTS_DIR/ensure-traefik.sh"

ensure_traefik
wait_for_postgres

if [ -z "$MATRIX_REGISTRATION_SHARED_SECRET" ]; then
  MATRIX_REGISTRATION_SHARED_SECRET=$(ts-node --transpileOnly "$SCRIPTS_DIR/matrix-registration-secret.ts")
  export MATRIX_REGISTRATION_SHARED_SECRET
fi

# Environment-mode configuration
if [ -n "$BOXEL_ENVIRONMENT" ]; then
  ENV_SLUG=$(echo "$BOXEL_ENVIRONMENT" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  REALM_BASE_URL="http://realm-server.${ENV_SLUG}.localhost"
  REALM_PORT=0
  REALMS_ROOT="./realms/${ENV_SLUG}"
  PGDATABASE_VAL="boxel_${ENV_SLUG}"
  MATRIX_URL_VAL="http://matrix.${ENV_SLUG}.localhost"
  PRERENDER_URL="${PRERENDER_URL:-http://prerender.${ENV_SLUG}.localhost}"
  WORKER_MANAGER_ARG="--workerManagerUrl=http://worker.${ENV_SLUG}.localhost"
  # Ensure per-environment database exists
  sh "$SCRIPTS_DIR/../../../scripts/ensure-branch-db.sh" "$ENV_SLUG"
else
  REALM_BASE_URL="http://localhost:4201"
  REALM_PORT=4201
  REALMS_ROOT="./realms/localhost_4201_base"
  PGDATABASE_VAL="boxel_base"
  MATRIX_URL_VAL="http://localhost:8008"
  PRERENDER_URL="${PRERENDER_URL:-http://localhost:4221}"
  WORKER_MANAGER_ARG="$1"
fi

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  PGPORT=5435 \
  PGDATABASE="${PGDATABASE_VAL}" \
  REALM_SERVER_SECRET_SEED="mum's the word" \
  REALM_SECRET_SEED="shhh! it's a secret" \
  GRAFANA_SECRET="shhh! it's a secret" \
  MATRIX_URL="${MATRIX_URL_VAL}" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ts-node \
  --transpileOnly main \
  --port="${REALM_PORT}" \
  --matrixURL="${MATRIX_URL_VAL}" \
  --realmsRootPath="${REALMS_ROOT}" \
  --prerendererUrl="${PRERENDER_URL}" \
  --migrateDB \
  $WORKER_MANAGER_ARG \
  \
  --path='../base' \
  --username='base_realm' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl="${REALM_BASE_URL}/base/"
