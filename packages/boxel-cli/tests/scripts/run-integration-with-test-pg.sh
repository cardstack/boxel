#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REALM_SERVER_SCRIPTS="$(cd "$SCRIPT_DIR/../../../realm-server/tests/scripts" && pwd)"

"${REALM_SERVER_SCRIPTS}/prepare-test-pg.sh"
trap '"${REALM_SERVER_SCRIPTS}/stop-test-pg.sh" >/dev/null 2>&1 || true' EXIT INT TERM

# A junit report is the only record of *which* integration test failed that
# survives CI: the suite prints tens of thousands of lines of realm-server
# request logging, and the dev-stack log printed after it adds tens of
# thousands more, so vitest's own summary sits too far from either end of the
# job log for a log reader to reach. CI sets JUNIT_OUTPUT_FILE and uploads the
# report as an artifact; locally the console reporter alone is enough.
VITEST_ARGS=(run --pool=forks --poolOptions.forks.singleFork)
if [ -n "${JUNIT_OUTPUT_FILE:-}" ]; then
  mkdir -p "$(dirname "${JUNIT_OUTPUT_FILE}")"
  VITEST_ARGS+=(
    --reporter=default
    --reporter=junit
    "--outputFile.junit=${JUNIT_OUTPUT_FILE}"
  )
fi

NODE_NO_WARNINGS=1 \
PGPORT=55436 \
  vitest "${VITEST_ARGS[@]}" tests/integration/**
