#! /bin/sh

READY_PATH="_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"
BASE_REALM_READY="http-get://localhost:4201/base/${READY_PATH}"
SYNAPSE_URL="http://localhost:8008"
SMTP_4_DEV_URL="http://localhost:5001"

if [ -n "$REALM_URL" ]; then
  REALM_HOST="$REALM_URL"
  case "$REALM_HOST" in
    http://*) REALM_HOST="${REALM_HOST#http://}" ;;
    https://*) REALM_HOST="${REALM_HOST#https://}" ;;
  esac
  case "$REALM_HOST" in
    */) ;;
    *) REALM_HOST="${REALM_HOST}/" ;;
  esac
  REALM_READY="http-get://${REALM_HOST}${READY_PATH}"
  READY_URLS="$BASE_REALM_READY|$REALM_READY|$SYNAPSE_URL|$SMTP_4_DEV_URL"
else
  CATALOG_REALM_READY="http-get://localhost:4201/catalog/${READY_PATH}"
  READY_URLS="$BASE_REALM_READY|$CATALOG_REALM_READY|$SYNAPSE_URL|$SMTP_4_DEV_URL"
fi

WAIT_ON_TIMEOUT=600000 NODE_NO_WARNINGS=1 REALM_URL="${REALM_URL:-}" start-server-and-test \
  'pnpm run wait' \
  "$READY_URLS" \
  'ember test --config-file testem-live.js --path ./dist'
