#! /bin/sh
echo "running tests: ${1}"

# `<index>/<total>`, or empty for the whole suite. playwright.config.ts reads
# this and narrows `testMatch` to the spec files bin-packed onto this shard;
# Playwright's own `--shard` is not used because it balances test count rather
# than test cost. See packages/matrix/support/shard-spec-files.ts.
MATRIX_TEST_SHARD="${1:-}"
export MATRIX_TEST_SHARD

BASE_REALM="https-get://localhost:4201/base/"

READY_PATH="_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"

BASE_REALM_READY="$BASE_REALM$READY_PATH"

# START_SERVER_AND_TEST_INSECURE=1: wait-on against https-get://localhost:4201
# needs the strictSSL escape hatch because start-server-and-test pins
# strictSSL:true on the in-process axios used for the readiness probe.
# DO NOT MERGE: repeat one flaky test across every shard, retries off.
if [ -n "$MATRIX_SYNAPSE_TEMPLATE" ]; then
  echo "repeat run: skipping the $MATRIX_SYNAPSE_TEMPLATE job"
  exit 0
fi
unset MATRIX_TEST_SHARD

WAIT_ON_TIMEOUT=600000 START_SERVER_AND_TEST_INSECURE=1 start-server-and-test \
  'pnpm run wait' \
  "$BASE_REALM_READY" \
  'pnpm playwright test tests/messages.spec.ts --grep "escape html tags" --repeat-each=100 --retries=0'
