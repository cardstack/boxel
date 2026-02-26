#!/usr/bin/env bash
set -euo pipefail

TEST_PG_CONTAINER="${TEST_PG_CONTAINER:-boxel-realm-test-pg}"

docker rm -f "$TEST_PG_CONTAINER" >/dev/null 2>&1 || true
