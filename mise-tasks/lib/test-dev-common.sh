#!/usr/bin/env bash
# Lightweight self-test for kill_tree in dev-common.sh.
#
# Spawns a 3-level sleep tree, asks kill_tree to take it down, and asserts
# every pid is gone shortly after kill_tree returns. The short sleep before
# the check is for the OS to reap SIGKILL'd descendants — kill_tree itself
# returns as soon as it has delivered the last signal, not after the kernel
# has finished tearing down the entries. The point is to catch regressions
# where kill_tree returns while children are still *running* (which is what
# the original SIGTERM-only walk did, causing leaked dev-stack processes
# after Ctrl-C).
#
# Not wired into CI — running it touches real signals and would race with
# any concurrent dev-stack on the same host. Invoke directly:
#   ./mise-tasks/lib/test-dev-common.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
# `dev-common.sh` derives REPO_ROOT from "../.."; load it from a cwd that
# resolves to the realm-server package so its initial cd doesn't fail.
cd "$SCRIPT_DIR/../../packages/realm-server"
# Stub the env-driven globals dev-common.sh references during sourcing so
# the script doesn't error out before we get to kill_tree.
: "${REALM_BASE_URL:=https://localhost:4201}"
: "${REALM_TEST_URL:=https://localhost:4202}"
: "${MATRIX_URL_VAL:=http://localhost:8008}"
: "${ICONS_URL:=http://localhost:4206}"
export REALM_BASE_URL REALM_TEST_URL MATRIX_URL_VAL ICONS_URL
# shellcheck disable=SC1091
. "$SCRIPT_DIR/dev-common.sh"

# Shorten the grace window so this test runs in a few seconds instead of
# the default ~5s; we still want >0 to exercise the wait path.
KILL_TREE_GRACE_SECS=2

fail=0

# Spawn a 3-level tree: bash → bash → sleep
bash -c 'bash -c "sleep 300 & sleep 300 & wait" &
         bash -c "sleep 300 & wait" &
         wait' &
ROOT_PID=$!

# Give the tree a moment to fully spawn before we collect descendants.
sleep 1

EXPECTED_PIDS="$ROOT_PID"
collect_descendants() {
  # `|| true` so the empty-output exit-1 from pgrep doesn't trip set -e
  # on leaf pids (which is the normal recursion terminator).
  for child in $(pgrep -P "$1" 2>/dev/null || true); do
    EXPECTED_PIDS="$EXPECTED_PIDS $child"
    collect_descendants "$child"
  done
}
collect_descendants "$ROOT_PID"

echo "Spawned tree: $EXPECTED_PIDS"

before=0
for pid in $EXPECTED_PIDS; do
  if kill -0 "$pid" 2>/dev/null; then
    before=$((before + 1))
  fi
done
if [ "$before" -lt 3 ]; then
  echo "FAIL: expected at least 3 live pids before kill_tree, got $before" >&2
  exit 1
fi

kill_tree "$ROOT_PID"

# kill_tree must return only after every pid is gone (or after the SIGKILL
# escalation). Give the OS a beat to reap, then check.
sleep 1
alive=0
for pid in $EXPECTED_PIDS; do
  if kill -0 "$pid" 2>/dev/null; then
    echo "FAIL: pid $pid still alive after kill_tree returned" >&2
    alive=$((alive + 1))
  fi
done

if [ "$alive" -gt 0 ]; then
  fail=1
fi

# Second scenario: a child that ignores SIGTERM must still be killed via
# SIGKILL within the grace window. `disown` so bash doesn't print its own
# job-control "Killed" line when SIGKILL lands; we report success ourselves.
bash -c 'trap "" TERM; exec sleep 300' &
STUBBORN_PID=$!
disown 2>/dev/null || true
sleep 1
kill_tree "$STUBBORN_PID"
sleep 1
if kill -0 "$STUBBORN_PID" 2>/dev/null; then
  echo "FAIL: SIGTERM-ignoring child $STUBBORN_PID survived kill_tree" >&2
  kill -KILL "$STUBBORN_PID" 2>/dev/null || true
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS: kill_tree flattened the tree and killed a SIGTERM-ignoring child"
fi

exit "$fail"
