#! /bin/sh
shard_flag=${1:+--shard}
echo "running tests: ${1}"

BASE_REALM_HOST="${REALM_BASE_URL:-http://localhost:4201}"
# start-server-and-test needs http-get:// prefix (without the scheme from the URL)
BASE_REALM="http-get://${BASE_REALM_HOST#http://}/base/"

READY_PATH="_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"

BASE_REALM_READY="$BASE_REALM$READY_PATH"

WAIT_ON_TIMEOUT=600000 start-server-and-test \
  'pnpm run wait' \
  "$BASE_REALM_READY" \
  "pnpm playwright test ${shard_flag} ${1}"
