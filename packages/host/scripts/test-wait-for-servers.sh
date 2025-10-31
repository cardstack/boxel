#!/usr/bin/env bash

ensure_trailing_slash() {
  case "$1" in
    */) printf '%s' "$1" ;;
    *) printf '%s/' "$1" ;;
  esac
}

to_wait_url() {
  case "$1" in
    http://*) printf 'http-get://%s' "${1#http://}" ;;
    https://*) printf 'https-get://%s' "${1#https://}" ;;
    *) printf '%s' "$1" ;;
  esac
}

from_wait_url() {
  case "$1" in
    http-get://*) printf 'http://%s' "${1#http-get://}" ;;
    https-get://*) printf 'https://%s' "${1#https-get://}" ;;
    *) printf '%s' "$1" ;;
  esac
}

DEFAULT_BASE_REALM_URL='http://localhost:4201/base/'
DEFAULT_CATALOG_REALM_URL='http://localhost:4201/catalog/'
DEFAULT_SKILLS_REALM_URL='http://localhost:4201/skills/'

BASE_REALM_URL=$(ensure_trailing_slash "${RESOLVED_BASE_REALM_URL:-$DEFAULT_BASE_REALM_URL}")
CATALOG_REALM_URL=$(ensure_trailing_slash "${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}")
SKILLS_REALM_URL=$(ensure_trailing_slash "${RESOLVED_SKILLS_REALM_URL:-$DEFAULT_SKILLS_REALM_URL}")

NODE_TEST_REALM="http-get://localhost:4202/node-test/"
TEST_REALM="http-get://localhost:4202/test/"

READY_PATH="_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"

BASE_REALM_READY="$(to_wait_url "${BASE_REALM_URL}")${READY_PATH}"
CATALOG_REALM_READY="$(to_wait_url "${CATALOG_REALM_URL}")${READY_PATH}"
NODE_TEST_REALM_READY="$NODE_TEST_REALM$READY_PATH"
SKILLS_REALM_READY="$(to_wait_url "${SKILLS_REALM_URL}")${READY_PATH}"
TEST_REALM_READY="$TEST_REALM$READY_PATH"

SYNAPSE_URL="http://localhost:8008"
SMTP_4_DEV_URL="http://localhost:5001"

HOST_TESTS_STARTED_FILE="${HOST_TESTS_STARTED_FILE:-/tmp/host-tests-started}"
rm -f "$HOST_TESTS_STARTED_FILE"

WAIT_TIMEOUT_MS=${HOST_WAIT_TIMEOUT_MS:-600000}
timeout_minutes=$(awk "BEGIN { print $WAIT_TIMEOUT_MS / 60000 }")

READINESS_TARGETS=(
  "$BASE_REALM_READY"
  "$CATALOG_REALM_READY"
  "$NODE_TEST_REALM_READY"
  "$SKILLS_REALM_READY"
  "$TEST_REALM_READY"
  "$SYNAPSE_URL"
  "$SMTP_4_DEV_URL"
)

printf '⏳  Waiting up to %.1f minutes for realm services to report readiness...\n' "$timeout_minutes" >&2

WAIT_ON_ARG=$(IFS='|'; printf '%s' "${READINESS_TARGETS[*]}")

WAIT_ON_TIMEOUT=$WAIT_TIMEOUT_MS NODE_NO_WARNINGS=1 start-server-and-test \
  'pnpm run wait' \
  "$WAIT_ON_ARG" \
  './scripts/run-tests-with-logs.sh'

status=$?

if [ ! -f "$HOST_TESTS_STARTED_FILE" ]; then
  printf '\n⚠️  Host shard never executed the test runner because the readiness poll timed out after %.1f minutes.\n' "$timeout_minutes" >&2
  if [ "$status" -eq 253 ] 2>/dev/null; then
    printf 'start-server-and-test exited with code 253, which indicates the wait-on step gave up while polling realm readiness URLs. This usually means the realm server failed to boot or finish indexing.\n' >&2
  fi
  printf 'Endpoints that never reported ready:\n' >&2
  for target in "${READINESS_TARGETS[@]}"; do
    printf '  • %s\n' "$(from_wait_url "$target")" >&2
  done
  realm_log="/tmp/server.log"
  if [ -f "$realm_log" ]; then
    printf '\nRealm server log tail (last 200 lines):\n' >&2
    if ! tail -n 200 "$realm_log" >&2; then
      printf '(failed to read %s)\n' "$realm_log" >&2
    fi

    recent_errors=$(grep -in 'error' "$realm_log" | tail -n 20)
    if [ -n "$recent_errors" ]; then
      printf '\nRealm server log lines matching "error" (last %d):\n' "$(printf '%s' "$recent_errors" | wc -l)" >&2
      printf '%s\n' "$recent_errors" >&2
    fi
  else
    printf '\nRealm server log not found at %s\n' "$realm_log" >&2
  fi
  printf 'See the realm server logs above for startup or indexing errors.\n' >&2
fi

rm -f "$HOST_TESTS_STARTED_FILE"

exit "$status"
