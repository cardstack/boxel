#! /bin/sh

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

WAIT_ON_TIMEOUT=600000 NODE_NO_WARNINGS=1 start-server-and-test \
  'pnpm run wait' \
  "$BASE_REALM_READY|$CATALOG_REALM_READY|$NODE_TEST_REALM_READY|$SKILLS_REALM_READY|$TEST_REALM_READY|$SYNAPSE_URL|$SMTP_4_DEV_URL" \
  'ember-test-pre-built'
