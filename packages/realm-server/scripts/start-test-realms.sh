#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"
. "$SCRIPTS_DIR/ensure-traefik.sh"

# In environment mode, share the dev icons server; otherwise start our own
if [ -z "$BOXEL_ENVIRONMENT" ]; then
  sh "$SCRIPTS_DIR/start-icons.sh" &
  ICONS_PID=$!
  cleanup_icons_server() {
    if [ -n "$ICONS_PID" ]; then
      kill "$ICONS_PID" >/dev/null 2>&1 || true
    fi
  }
  trap cleanup_icons_server EXIT INT TERM
else
  ensure_traefik
fi

wait_for_postgres

# Environment-mode configuration
if [ -n "$BOXEL_ENVIRONMENT" ]; then
  ENV_SLUG=$(echo "$BOXEL_ENVIRONMENT" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  REALM_TEST_URL="http://realm-test.${ENV_SLUG}.localhost"
  REALM_BASE_URL="http://realm-server.${ENV_SLUG}.localhost"
  TEST_PORT=0
  PGDATABASE_VAL="boxel_test_${ENV_SLUG}"
  REALMS_ROOT="./realms/${ENV_SLUG}_test"
  PRERENDER_URL="${PRERENDER_URL:-http://prerender.${ENV_SLUG}.localhost}"
  WORKER_MANAGER_ARG="--workerManagerUrl=http://worker-test.${ENV_SLUG}.localhost"
  SERVICE_NAME_ARG="--serviceName=realm-test"
  MATRIX_URL_VAL="http://matrix.${ENV_SLUG}.localhost"

  # Ensure per-environment test database exists
  sh "$SCRIPTS_DIR/../../../scripts/ensure-branch-db.sh" "test_${ENV_SLUG}"
else
  REALM_TEST_URL="http://localhost:4202"
  REALM_BASE_URL="http://localhost:4201"
  TEST_PORT=4202
  PGDATABASE_VAL="boxel_test"
  REALMS_ROOT="./realms/localhost_4202"
  PRERENDER_URL="${PRERENDER_URL:-http://localhost:4221}"
  WORKER_MANAGER_ARG="$1"
  SERVICE_NAME_ARG=""
  MATRIX_URL_VAL="http://localhost:8008"
fi

pnpm --dir=../skills-realm skills:setup

if [ -z "$MATRIX_REGISTRATION_SHARED_SECRET" ]; then
  MATRIX_REGISTRATION_SHARED_SECRET=$(ts-node --transpileOnly "$SCRIPTS_DIR/matrix-registration-secret.ts")
  export MATRIX_REGISTRATION_SHARED_SECRET
fi

NODE_ENV=test \
  PGPORT=5435 \
  PGDATABASE="${PGDATABASE_VAL}" \
  NODE_NO_WARNINGS=1 \
  REALM_SERVER_SECRET_SEED="mum's the word" \
  REALM_SECRET_SEED="shhh! it's a secret" \
  GRAFANA_SECRET="shhh! it's a secret" \
  MATRIX_URL="${MATRIX_URL_VAL}" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ts-node \
  --transpileOnly main \
  --port="${TEST_PORT}" \
  --matrixURL="${MATRIX_URL_VAL}" \
  --realmsRootPath="${REALMS_ROOT}" \
  --matrixRegistrationSecretFile='../matrix/registration_secret.txt' \
  --migrateDB \
  --prerendererUrl="${PRERENDER_URL}" \
  $WORKER_MANAGER_ARG \
  $SERVICE_NAME_ARG \
  \
  --path='./tests/cards' \
  --username='node-test_realm' \
  --fromUrl="${REALM_TEST_URL}/node-test/" \
  --toUrl="${REALM_TEST_URL}/node-test/" \
  \
  --path='../host/tests/cards' \
  --username='test_realm' \
  --fromUrl="${REALM_TEST_URL}/test/" \
  --toUrl="${REALM_TEST_URL}/test/" \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl="${REALM_BASE_URL}/base/"
