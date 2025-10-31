#! /bin/sh

set -e

ensure_trailing_slash() {
  case "$1" in
    */) printf '%s' "$1" ;;
    *) printf '%s/' "$1" ;;
  esac
}

to_wait_url() {
  case "$1" in
    http://*) printf 'http-get://%s' "${1#http://}" ;;
    https://*) printf 'https-get://%s' "${1#https://}" ;;
    *) printf '%s' "$1" ;;
  esac
}

DEFAULT_BASE_REALM_URL='http://localhost:4201/base/'
DEFAULT_CATALOG_REALM_URL='http://localhost:4201/catalog/'
DEFAULT_SKILLS_REALM_URL='http://localhost:4201/skills/'

BASE_REALM_URL=$(ensure_trailing_slash "${RESOLVED_BASE_REALM_URL:-$DEFAULT_BASE_REALM_URL}")
CATALOG_REALM_URL=$(ensure_trailing_slash "${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}")
SKILLS_REALM_URL=$(ensure_trailing_slash "${RESOLVED_SKILLS_REALM_URL:-$DEFAULT_SKILLS_REALM_URL}")

NODE_TEST_REALM="http-get://localhost:4202/node-test/"
TEST_REALM="http-get://localhost:4202/test/"

READY_PATH="_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"

BASE_REALM_READY="$(to_wait_url "${BASE_REALM_URL}")${READY_PATH}"
CATALOG_REALM_READY="$(to_wait_url "${CATALOG_REALM_URL}")${READY_PATH}"
NODE_TEST_REALM_READY="$NODE_TEST_REALM$READY_PATH"
SKILLS_REALM_READY="$(to_wait_url "${SKILLS_REALM_URL}")${READY_PATH}"
TEST_REALM_READY="$TEST_REALM$READY_PATH"

SYNAPSE_URL="http://localhost:8008"
SMTP_4_DEV_URL="http://localhost:5001"

WAIT_RESOURCES="$BASE_REALM_READY|$CATALOG_REALM_READY|$NODE_TEST_REALM_READY|$SKILLS_REALM_READY|$TEST_REALM_READY|$SYNAPSE_URL|$SMTP_4_DEV_URL"
WAIT_ON_TIMEOUT=${WAIT_ON_TIMEOUT:-600000}

if [ "${HOST_TEST_WAIT_ONLY:-}" = "true" ] || [ "${HOST_TEST_WAIT_ONLY:-}" = "1" ]; then
  OLD_IFS=$IFS
  IFS='|'
  set -- $WAIT_RESOURCES
  IFS=$OLD_IFS
  pnpm exec -- wait-on -t "$WAIT_ON_TIMEOUT" "$@"
  exit 0
fi

if [ "${HOST_TEST_SKIP_WAIT:-}" = "true" ] || [ "${HOST_TEST_SKIP_WAIT:-}" = "1" ]; then
  exec pnpm ember-test-pre-built
fi

WAIT_ON_TIMEOUT=$WAIT_ON_TIMEOUT NODE_NO_WARNINGS=1 start-server-and-test \
  'pnpm run wait' \
  "$WAIT_RESOURCES" \
  'ember-test-pre-built'
