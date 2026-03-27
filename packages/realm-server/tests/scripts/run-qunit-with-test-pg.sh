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

LOG_LEVELS="$EFFECTIVE_LOG_LEVELS" \
NODE_NO_WARNINGS=1 \
PGPORT=55436 \
STRIPE_WEBHOOK_SECRET=stripe-webhook-secret \
STRIPE_API_KEY=stripe-api-key \
qunit --require ts-node/register/transpile-only "$@" tests/index.ts
