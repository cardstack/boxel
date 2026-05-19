#! /bin/sh

READY_PATH="_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"
BASE_REALM_READY="https-get://localhost:4201/base/${READY_PATH}"
SYNAPSE_URL="http://localhost:8008"
SMTP_4_DEV_URL="http://localhost:5001"

# Pick wait-on's protocol prefix from whichever scheme the caller used.
to_wait_scheme() {
  case "$1" in
    https://*) printf 'https-get' ;;
    *) printf 'http-get' ;;
  esac
}

if [ -n "$REALM_URL" ]; then
  REALM_HOST="$REALM_URL"
  REALM_SCHEME="$(to_wait_scheme "$REALM_URL")"
  case "$REALM_HOST" in
    http://*) REALM_HOST="${REALM_HOST#http://}" ;;
    https://*) REALM_HOST="${REALM_HOST#https://}" ;;
  esac
  case "$REALM_HOST" in
    */) ;;
    *) REALM_HOST="${REALM_HOST}/" ;;
  esac
  REALM_READY="${REALM_SCHEME}://${REALM_HOST}${READY_PATH}"
  READY_URLS="$BASE_REALM_READY|$REALM_READY|$SYNAPSE_URL|$SMTP_4_DEV_URL"
else
  CATALOG_REALM_READY="https-get://localhost:4201/catalog/${READY_PATH}"
  READY_URLS="$BASE_REALM_READY|$CATALOG_REALM_READY|$SYNAPSE_URL|$SMTP_4_DEV_URL"
fi

# See test-wait-for-servers.sh for the rationale on
# START_SERVER_AND_TEST_INSECURE=1 — wait-on against
# https-get://localhost:42XX needs the strictSSL escape hatch under
# start-server-and-test, otherwise the readiness probe flakes against
# the self-signed mkcert leaf.
WAIT_ON_TIMEOUT=600000 NODE_NO_WARNINGS=1 START_SERVER_AND_TEST_INSECURE=1 \
  REALM_URL="${REALM_URL:-}" start-server-and-test \
  'pnpm run wait' \
  "$READY_URLS" \
  'ember test --config-file testem-live.js --path ./dist'
