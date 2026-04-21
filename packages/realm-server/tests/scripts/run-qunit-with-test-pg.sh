#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

"${SCRIPT_DIR}/prepare-test-pg.sh"
trap '"${SCRIPT_DIR}/stop-test-pg.sh" >/dev/null 2>&1 || true' EXIT INT TERM

BASE_LOG_LEVELS="*=error,prerenderer-chrome=none,pg-adapter=warn,realm:requests=warn"
EXTRA_LOG_LEVELS="${LOG_LEVELS-}"
if [ -n "$EXTRA_LOG_LEVELS" ]; then
  EFFECTIVE_LOG_LEVELS="${BASE_LOG_LEVELS},${EXTRA_LOG_LEVELS}"
else
  EFFECTIVE_LOG_LEVELS="$BASE_LOG_LEVELS"
fi

JUNIT_REPORTER_ARGS=()
if [ -n "${JUNIT_OUTPUT_FILE-}" ]; then
  JUNIT_REPORTER_ARGS=(--require "${SCRIPT_DIR}/../../scripts/junit-reporter.js")
fi

# Disable Node's V8 compile cache (Node 22+). When enabled, it caches
# transpiled JS of test files at /tmp/node-compile-cache and
# /tmp/v8-compile-cache-1000, and when a test file changes on disk the
# cache can serve a stale compiled version — edits to test files then
# silently don't reach the runner. See:
# https://nodejs.org/api/module.html#moduleenablecompilecachecachedir
LOG_LEVELS="$EFFECTIVE_LOG_LEVELS" \
NODE_NO_WARNINGS=1 \
NODE_DISABLE_COMPILE_CACHE=1 \
PGPORT=55436 \
STRIPE_WEBHOOK_SECRET=stripe-webhook-secret \
STRIPE_API_KEY=stripe-api-key \
qunit --require ts-node/register/transpile-only ${JUNIT_REPORTER_ARGS[@]+"${JUNIT_REPORTER_ARGS[@]}"} "$@" tests/index.ts
