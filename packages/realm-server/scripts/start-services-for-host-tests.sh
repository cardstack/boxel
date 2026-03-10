#! /bin/sh

# Use POSIX flags; pipefail is not portable in /bin/sh
set -eu

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
CATALOG_SRC_PATH="$(cd "$SCRIPTS_DIR/../../catalog-realm" && pwd)"
CATALOG_TEMP_PATH="$(mktemp -d "${TMPDIR:-/tmp}/catalog-realm.hosttests.XXXXXX")"

cleanup() {
  rm -rf "$CATALOG_TEMP_PATH"
}
trap cleanup EXIT INT TERM

# Always include key config files so the realm loads correctly.
for f in .realm.json package.json tsconfig.json .gitignore; do
  if [ -e "$CATALOG_SRC_PATH/$f" ]; then
    cp -a "$CATALOG_SRC_PATH/$f" "$CATALOG_TEMP_PATH/"
  fi
done

# We need the Spec folder for one of the tests
mkdir -p "$CATALOG_TEMP_PATH/Spec"
cp -a "$CATALOG_SRC_PATH/Spec/grid.json" "$CATALOG_TEMP_PATH/Spec/"

# Explicitly keep only the tested parts of the catalog
KEEP_FOLDERS="fields catalog-app components commands"
for item in $KEEP_FOLDERS; do
  if [ -d "$CATALOG_SRC_PATH/$item" ]; then
    cp -a "$CATALOG_SRC_PATH/$item" "$CATALOG_TEMP_PATH/"
  else
    echo "ERROR: required catalog item not found: $item" >&2
    exit 1
  fi
done
# Explicitly keep some files needed for the tests
KEEP_FILES="cloudflare-image.gts index.json Spec/f869024a-cdec-4a73-afca-d8d32f258ead.json"
for item in $KEEP_FILES; do
  if [ -f "$CATALOG_SRC_PATH/$item" ]; then
    cp -a "$CATALOG_SRC_PATH/$item" "$CATALOG_TEMP_PATH/$item"
  else
    echo "ERROR: required catalog item not found: $item" >&2
    exit 1
  fi
done

export CATALOG_REALM_PATH="$CATALOG_TEMP_PATH"

# Environment-mode configuration
if [ -n "$BOXEL_ENVIRONMENT" ]; then
  . "$SCRIPTS_DIR/ensure-traefik.sh"
  ensure_traefik

  ENV_SLUG=$(echo "$BOXEL_ENVIRONMENT" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  REALM_HOST="realm-server.${ENV_SLUG}.localhost"
  REALM_TEST_HOST="realm-test.${ENV_SLUG}.localhost"
  READY_PATH="_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"

  PHASE1_URLS="http-get://${REALM_HOST}/base/${READY_PATH}|http://matrix.${ENV_SLUG}.localhost|http://localhost:5001|http://icons.${ENV_SLUG}.localhost"
  PHASE2_URLS="http-get://${REALM_TEST_HOST}/node-test/${READY_PATH}"

  # Pre-setup: ensure Postgres, database, and migrations are ready before
  # starting the realm server (follows the same pattern as start-all.sh).
  REPO_ROOT="$(cd "$SCRIPTS_DIR/../../.." && pwd)"
  export PGPORT="${PGPORT:-5435}"
  export PGDATABASE="${PGDATABASE:-boxel_${ENV_SLUG}}"

  ./scripts/start-pg.sh
  echo "Waiting for Postgres to accept connections..."
  until docker exec boxel-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  "$REPO_ROOT/scripts/ensure-branch-db.sh" "$ENV_SLUG"
  echo "Running database migrations..."
  pnpm migrate
  ./scripts/start-matrix.sh
else
  PHASE1_URLS="http-get://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http://localhost:8008|http://localhost:5001|http://localhost:4206"
  PHASE2_URLS="http-get://localhost:4202/node-test/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"
fi

# Make host-test startup logs focus on indexing progress rather than per-request noise.
HOST_TEST_LOG_LEVELS="${HOST_TEST_LOG_LEVELS:-*=info,realm:requests=warn,realm-index-updater=debug,index-runner=debug,index-perf=debug,index-writer=debug,worker=debug,worker-manager=debug}"
SKIP_CATALOG="${SKIP_CATALOG:-}"
# There is a race condition starting up the servers that setting up the
# submission realm triggers which triggers the start-development.sh script to
# SIGTERM. currently we don't need the submission realm for host tests to
# skipping that. but this issue needs to be fixed.
WAIT_ON_TIMEOUT=900000 \
  SKIP_EXPERIMENTS=true \
  SKIP_CATALOG="$SKIP_CATALOG" \
  SKIP_BOXEL_HOMEPAGE=true \
  SKIP_SUBMISSION=true \
  CATALOG_REALM_PATH="$CATALOG_TEMP_PATH" \
  LOG_LEVELS="$HOST_TEST_LOG_LEVELS" \
  NODE_NO_WARNINGS=1 \
  start-server-and-test \
    'run-p -ln start:pg start:prerender-dev start:prerender-manager-dev start:matrix start:smtp start:worker-development start:development' \
    "$PHASE1_URLS" \
    'run-p -ln start:worker-test start:test-realms' \
    "$PHASE2_URLS" \
    'wait'
