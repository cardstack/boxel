#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/test-pg-config.sh"

docker rm -f "$TEST_PG_CONTAINER" >/dev/null 2>&1 || true
