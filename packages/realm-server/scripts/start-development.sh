#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"
. "$SCRIPTS_DIR/ensure-traefik.sh"

ensure_traefik

sh "$SCRIPTS_DIR/start-icons.sh" &
ICONS_PID=$!
cleanup_icons_server() {
  if [ -n "$ICONS_PID" ]; then
    kill "$ICONS_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup_icons_server EXIT INT TERM

wait_for_postgres

pnpm --dir=../skills-realm skills:setup

if [ -z "${SKIP_BOXEL_HOMEPAGE:-}" ]; then
  pnpm --dir=../boxel-homepage-realm boxel-homepage:setup
fi

if [ -z "$MATRIX_REGISTRATION_SHARED_SECRET" ]; then
  MATRIX_REGISTRATION_SHARED_SECRET=$(ts-node --transpileOnly "$SCRIPTS_DIR/matrix-registration-secret.ts")
  export MATRIX_REGISTRATION_SHARED_SECRET
fi

START_EXPERIMENTS=$(if [ -z "$SKIP_EXPERIMENTS" ]; then echo "true"; else echo ""; fi)
START_CATALOG=true
if [ "${SKIP_CATALOG:-}" = "true" ]; then
  START_CATALOG=""
fi
START_BOXEL_HOMEPAGE=$(if [ -z "$SKIP_BOXEL_HOMEPAGE" ]; then echo "true"; else echo ""; fi)
START_SUBMISSION=$(if [ -z "$SKIP_SUBMISSION" ]; then echo "true"; else echo ""; fi)

# Environment-mode configuration: when BOXEL_ENVIRONMENT is set, use dynamic ports and
# Traefik routing instead of hardcoded ports.
if [ -n "$BOXEL_ENVIRONMENT" ]; then
  ENV_SLUG=$(echo "$BOXEL_ENVIRONMENT" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  REALM_BASE_URL="http://realm-server.${ENV_SLUG}.localhost"
  REALM_PORT=0
  REALMS_ROOT="./realms/${ENV_SLUG}"
  PGDATABASE_VAL="boxel_${ENV_SLUG}"
  MATRIX_URL_VAL="http://matrix.${ENV_SLUG}.localhost"
  # Ensure per-environment database exists
  sh "$SCRIPTS_DIR/../../../scripts/ensure-branch-db.sh" "$ENV_SLUG"
else
  REALM_BASE_URL="http://localhost:4201"
  REALM_PORT=4201
  REALMS_ROOT="./realms/localhost_4201"
  PGDATABASE_VAL="boxel"
  MATRIX_URL_VAL="http://localhost:8008"
fi

DEFAULT_CATALOG_REALM_URL="${REALM_BASE_URL}/catalog/"
CATALOG_REALM_URL="${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}"
DEFAULT_BOXEL_HOMEPAGE_REALM_URL="${REALM_BASE_URL}/boxel-homepage/"
BOXEL_HOMEPAGE_REALM_URL="${RESOLVED_BOXEL_HOMEPAGE_REALM_URL:-$DEFAULT_BOXEL_HOMEPAGE_REALM_URL}"
DEFAULT_SUBMISSION_REALM_URL="${REALM_BASE_URL}/submissions/"
SUBMISSION_REALM_URL="${RESOLVED_SUBMISSION_REALM_URL:-$DEFAULT_SUBMISSION_REALM_URL}"

# This can be overridden from the environment to point to a different catalog
# and is used in start-services-for-host-tests.sh to point to a trimmed down
# version of the catalog-realm for faster startup.
CATALOG_REALM_PATH="${CATALOG_REALM_PATH:-../catalog-realm}"
SUBMISSION_REALM_PATH="${SUBMISSION_REALM_PATH:-${REALMS_ROOT}/submissions}"

if [ -n "$USE_EXTERNAL_CATALOG" ]; then
  pnpm --dir=../catalog catalog:setup
  pnpm --dir=../catalog catalog:update
  CATALOG_REALM_PATH='../catalog/contents'
fi

if [ -n "$START_SUBMISSION" ]; then
  sh "$SCRIPTS_DIR/setup-submission-realm.sh" "$SUBMISSION_REALM_PATH"
fi


# In environment mode, override prerender URL and worker manager arg to use Traefik hostnames
if [ -n "$BOXEL_ENVIRONMENT" ]; then
  PRERENDER_URL="${PRERENDER_URL:-http://prerender.${ENV_SLUG}.localhost}"
  WORKER_MANAGER_ARG="--workerManagerUrl=http://worker.${ENV_SLUG}.localhost"
else
  PRERENDER_URL="${PRERENDER_URL:-http://localhost:4221}"
  WORKER_MANAGER_ARG="$1"
fi

LOW_CREDIT_THRESHOLD="${LOW_CREDIT_THRESHOLD:-2000}" \
  NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  PGPORT=5435 \
  PGDATABASE="${PGDATABASE_VAL}" \
  LOG_LEVELS='*=info' \
  REALM_SERVER_SECRET_SEED="mum's the word" \
  REALM_SECRET_SEED="shhh! it's a secret" \
  GRAFANA_SECRET="shhh! it's a secret" \
  MATRIX_URL="${MATRIX_URL_VAL}" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ENABLE_FILE_WATCHER=true \
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
  --toUrl="${REALM_BASE_URL}/base/" \
  \
  ${START_CATALOG:+--path="${CATALOG_REALM_PATH}"} \
  ${START_CATALOG:+--username='catalog_realm'} \
  ${START_CATALOG:+--fromUrl='@cardstack/catalog/'} \
  ${START_CATALOG:+--toUrl="${CATALOG_REALM_URL}"} \
  \
  --path='../skills-realm/contents' \
  --username='skills_realm' \
  --fromUrl="${REALM_BASE_URL}/skills/" \
  --toUrl="${REALM_BASE_URL}/skills/" \
  \
  ${START_SUBMISSION:+--path="${SUBMISSION_REALM_PATH}"} \
  ${START_SUBMISSION:+--username='submission_realm'} \
  ${START_SUBMISSION:+--fromUrl="${SUBMISSION_REALM_URL}"} \
  ${START_SUBMISSION:+--toUrl="${SUBMISSION_REALM_URL}"} \
  \
  ${START_BOXEL_HOMEPAGE:+--path='../boxel-homepage-realm/contents'} \
  ${START_BOXEL_HOMEPAGE:+--username='boxel_homepage_realm'} \
  ${START_BOXEL_HOMEPAGE:+--fromUrl="${BOXEL_HOMEPAGE_REALM_URL}"} \
  ${START_BOXEL_HOMEPAGE:+--toUrl="${BOXEL_HOMEPAGE_REALM_URL}"} \
  \
  ${START_EXPERIMENTS:+--path='../experiments-realm'} \
  ${START_EXPERIMENTS:+--username='experiments_realm'} \
  ${START_EXPERIMENTS:+--fromUrl="${REALM_BASE_URL}/experiments/"} \
  ${START_EXPERIMENTS:+--toUrl="${REALM_BASE_URL}/experiments/"}
