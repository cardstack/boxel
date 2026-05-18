#! /bin/sh
shard_flag=${1:+--shard}
echo "running tests: ${1}"

BASE_REALM="https-get://localhost:4201/base/"

READY_PATH="_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"

BASE_REALM_READY="$BASE_REALM$READY_PATH"

# START_SERVER_AND_TEST_INSECURE=1: wait-on against https-get://localhost:4201
# needs the strictSSL escape hatch because start-server-and-test pins
# strictSSL:true on the in-process axios used for the readiness probe.
WAIT_ON_TIMEOUT=600000 START_SERVER_AND_TEST_INSECURE=1 start-server-and-test \
  'pnpm run wait' \
  "$BASE_REALM_READY" \
  "pnpm playwright test ${shard_flag} ${1}"
