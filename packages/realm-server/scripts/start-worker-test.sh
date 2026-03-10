#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"
. "$SCRIPTS_DIR/wait-for-prerender.sh"
. "$SCRIPTS_DIR/ensure-traefik.sh"

if [ -n "$BOXEL_ENVIRONMENT" ]; then
  ensure_traefik
fi

wait_for_postgres

# Environment-mode configuration
if [ -n "$BOXEL_ENVIRONMENT" ]; then
  ENV_SLUG=$(echo "$BOXEL_ENVIRONMENT" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  REALM_TEST_URL="http://realm-test.${ENV_SLUG}.localhost"
  REALM_BASE_URL="http://realm-server.${ENV_SLUG}.localhost"
  WORKER_PORT=0
  PGDATABASE_VAL="boxel_test_${ENV_SLUG}"
  PRERENDER_URL="${PRERENDER_URL:-http://prerender-mgr.${ENV_SLUG}.localhost}"
  SERVICE_NAME_ARG="--serviceName=worker-test"
  MIGRATE_ARG="--migrateDB"
  MATRIX_URL_VAL="http://matrix.${ENV_SLUG}.localhost"

  # Ensure per-environment test database exists
  sh "$SCRIPTS_DIR/../../../scripts/ensure-branch-db.sh" "test_${ENV_SLUG}"
else
  REALM_TEST_URL="http://localhost:4202"
  REALM_BASE_URL="http://localhost:4201"
  WORKER_PORT=4211
  PGDATABASE_VAL="boxel_test"
  PRERENDER_URL="${PRERENDER_URL:-http://localhost:4222}"
  SERVICE_NAME_ARG=""
  MIGRATE_ARG=""
  MATRIX_URL_VAL="http://localhost:8008"
fi

wait_for_prerender "$PRERENDER_URL"

NODE_ENV=test \
  PGPORT=5435 \
  PGDATABASE="${PGDATABASE_VAL}" \
  NODE_NO_WARNINGS=1 \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
  REALM_SECRET_SEED="shhh! it's a secret" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  LOW_CREDIT_THRESHOLD=2000 \
  ts-node \
  --transpileOnly worker-manager \
  --port="${WORKER_PORT}" \
  --matrixURL="${MATRIX_URL_VAL}" \
  --prerendererUrl="${PRERENDER_URL}" \
  $SERVICE_NAME_ARG \
  $MIGRATE_ARG \
  \
  --fromUrl="${REALM_TEST_URL}/node-test/" \
  --toUrl="${REALM_TEST_URL}/node-test/" \
  \
  --fromUrl="${REALM_TEST_URL}/test/" \
  --toUrl="${REALM_TEST_URL}/test/" \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl="${REALM_BASE_URL}/base/" \
  --fromUrl="${REALM_BASE_URL}/skills/" \
  --toUrl="${REALM_BASE_URL}/skills/"
