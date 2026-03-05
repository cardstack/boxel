#!/usr/bin/env bash
set -euo pipefail

# Finds and kills stuck realm-server test processes on macOS/Linux.
# Targets:
# - qunit runners from `pnpm test` / `pnpm test-module`
# - run-qunit wrapper scripts
# - listeners on common test ports (realm:4444, prerender:4460)
# - descendants of the above processes (for chrome/prerender children)

SCRIPT_NAME="$(basename "$0")"
PID_FILE="$(mktemp)"
ALIVE_FILE="$(mktemp)"
trap 'rm -f "$PID_FILE" "$ALIVE_FILE"' EXIT

add_pid() {
  local pid="$1"
  case "$pid" in
    '' | *[!0-9]*)
      return
      ;;
  esac

  if [ "$pid" -le 1 ] || [ "$pid" -eq "$$" ] || [ "$pid" -eq "$PPID" ]; then
    return
  fi

  echo "$pid" >>"$PID_FILE"
}

collect_by_pattern() {
  local pattern="$1"
  ps -axo pid=,command= \
    | awk -v p="$pattern" '$0 ~ p { print $1 }' \
    | while IFS= read -r pid; do
      add_pid "$pid"
    done
}

collect_by_port() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null \
      | while IFS= read -r pid; do
        add_pid "$pid"
      done || true
    return
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$port" 2>/dev/null \
      | sed -nE 's/.*pid=([0-9]+).*/\1/p' \
      | while IFS= read -r pid; do
        add_pid "$pid"
      done || true
  fi
}

collect_by_pattern 'qunit/bin/qunit\.js'
collect_by_pattern 'tests/scripts/run-qunit-with-test-pg\.sh'
collect_by_pattern 'ts-node/register/transpile-only'
collect_by_port 4444
collect_by_port 4460

if [ -s "$PID_FILE" ]; then
  sort -nu "$PID_FILE" -o "$PID_FILE"
fi

# Expand to descendants of matched pids (for browser/prerender child procs).
changed=1
while [ "$changed" -eq 1 ] && [ -s "$PID_FILE" ]; do
  changed=0
  while read -r pid ppid; do
    [ -z "$pid" ] && continue
    if grep -qx "$ppid" "$PID_FILE" && ! grep -qx "$pid" "$PID_FILE"; then
      add_pid "$pid"
      changed=1
    fi
  done <<EOF
$(ps -axo pid=,ppid=)
EOF
  sort -nu "$PID_FILE" -o "$PID_FILE"
done

if [ ! -s "$PID_FILE" ]; then
  echo "${SCRIPT_NAME}: no stuck realm-server test processes found"
  exit 0
fi

pid_csv="$(paste -sd, "$PID_FILE")"

echo "${SCRIPT_NAME}: terminating these processes:"
ps -o pid=,ppid=,command= -p "$pid_csv" || true

# Graceful pass first.
while IFS= read -r pid; do
  kill -TERM "$pid" >/dev/null 2>&1 || true
done <"$PID_FILE"

sleep 1

while IFS= read -r pid; do
  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "$pid" >>"$ALIVE_FILE"
  fi
done <"$PID_FILE"

if [ -s "$ALIVE_FILE" ]; then
  echo "${SCRIPT_NAME}: forcing kill on remaining processes"
  while IFS= read -r pid; do
    kill -KILL "$pid" >/dev/null 2>&1 || true
  done <"$ALIVE_FILE"
fi

echo "${SCRIPT_NAME}: done"
