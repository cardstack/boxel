#! /bin/sh
shard_flag=${1:+--shard}
echo "running tests: ${1}"

BASE_REALM="http-get://localhost:4201/base/"
NODE_TEST_REALM="http-get://localhost:4202/node-test/"
TEST_REALM="http-get://localhost:4202/test/"

READY_PATH="_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"

BASE_REALM_READY="$BASE_REALM$READY_PATH"
NODE_TEST_REALM_READY="$NODE_TEST_REALM$READY_PATH"
TEST_REALM_READY="$TEST_REALM$READY_PATH"

HOST_PATH="http://127.0.0.1:4200"

WAIT_ON_TIMEOUT=600000 start-server-and-test \
  'pnpm run wait' \
  "$BASE_REALM_READY|$NODE_TEST_REALM_READY|$TEST_REALM_READY" \
  "pnpm playwright test ${shard_flag} ${1}"
