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

# Make host-test startup logs focus on indexing progress rather than per-request noise.
HOST_TEST_LOG_LEVELS="${HOST_TEST_LOG_LEVELS:-*=info,realm:requests=warn,realm-index-updater=debug,index-runner=debug,index-perf=debug,index-writer=debug,worker=debug,worker-manager=debug}"

# There is a race condition starting up the servers that setting up the
# submission realm triggers which triggers the start-development.sh script to
# SIGTERM. currently we don't need the submission realm for host tests to
# skipping that. but this issue needs to be fixed.
WAIT_ON_TIMEOUT=900000 \
  SKIP_EXPERIMENTS=true \
  SKIP_CATALOG=true \
  SKIP_BOXEL_HOMEPAGE=true \
  SKIP_SUBMISSION=true \
  CATALOG_REALM_PATH="$CATALOG_TEMP_PATH" \
  LOG_LEVELS="$HOST_TEST_LOG_LEVELS" \
  NODE_NO_WARNINGS=1 \
  start-server-and-test \
    'run-p -ln start:pg start:prerender-dev start:prerender-manager-dev start:matrix start:smtp start:worker-development start:development' \
    'http-get://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http://localhost:8008|http://localhost:5001' \
    'run-p -ln start:worker-test start:test-realms' \
    'http-get://localhost:4202/node-test/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson' \
    'wait'
