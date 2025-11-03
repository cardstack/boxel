#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_TESTS_STARTED_FILE="${HOST_TESTS_STARTED_FILE:-/tmp/host-tests-started}"

touch "$HOST_TESTS_STARTED_FILE"

collect_diagnostics() {
  local exit_code=$1
  if (( exit_code == 0 )); then
    return
  fi

  echo "\n⛑️  Host tests failed – collecting diagnostics..." >&2

  local netlog_targets=()
  if [[ -n "${HOST_TEST_PARTITION:-}" ]]; then
    netlog_targets+=("/tmp/chrome-netlog-${HOST_TEST_PARTITION}.json")
  fi
  while IFS= read -r file; do
    netlog_targets+=("$file")
  done < <(ls /tmp/chrome-netlog-*.json 2>/dev/null || true)

  if (( ${#netlog_targets[@]} == 0 )); then
    echo "No Chrome netlog files were found under /tmp." >&2
  else
    declare -A seen
    for netlog in "${netlog_targets[@]}"; do
      if [[ -f "$netlog" && -z "${seen[$netlog]:-}" ]]; then
        seen[$netlog]=1
        echo "\n─ Chrome netlog summary (${netlog})" >&2
        if ! node "$SCRIPT_DIR/summarize-chrome-netlog.js" "$netlog"; then
          echo "Failed to summarize $netlog" >&2
        fi
      fi
    done
  fi

  local realm_log="/tmp/server.log"
  if [[ -f "$realm_log" ]]; then
    echo "\n─ Realm server log tail (last 200 lines)" >&2
    if ! tail -n 200 "$realm_log" >&2; then
      echo "(failed to read $realm_log)" >&2
    fi

    echo "\n─ Realm indexing analysis" >&2
    if ! node "$SCRIPT_DIR/analyze-realm-log.js" "$realm_log" >&2; then
      echo "Failed to analyze $realm_log" >&2
    fi
  else
    echo "\n─ Realm server log tail" >&2
    echo "Realm server log not found at $realm_log" >&2
  fi

  local readiness_urls=(
    "http://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"
    "http://localhost:4201/catalog/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"
    "http://localhost:4201/skills/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"
    "http://localhost:4202/test/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"
    "http://localhost:4202/node-test/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"
  )

  echo "\n─ Realm readiness checks" >&2
  for url in "${readiness_urls[@]}"; do
    echo "Checking ${url}" >&2
    if ! curl --silent --show-error --max-time 15 "$url"; then
      echo "(request failed)" >&2
    fi
    echo >&2
  done
}

trap 'status=$?; collect_diagnostics "$status"' EXIT

pnpm run ember-test-pre-built
