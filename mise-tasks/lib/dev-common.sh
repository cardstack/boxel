#!/bin/sh
# Shared setup for dev and dev-all mise tasks.
# Sourced (not executed) — sets variables and bootstraps infra.
# Expects to run with MISE dir=packages/realm-server.

REPO_ROOT="$(cd "../.." && pwd)"

# Use absolute paths so spawned processes carry absolute argv[0]; this keeps
# the regex sweeps in `sweep_orphaned_services` anchored to this checkout
# reliable regardless of how the binary was originally resolved by PATH.
export PATH="${REPO_ROOT}/node_modules/.bin:${REPO_ROOT}/packages/realm-server/node_modules/.bin:./node_modules/.bin:$PATH"

# How long to wait for SIGTERM'd processes to exit before escalating to
# SIGKILL. The dev stack has slow propagators in it (pnpm, npm exec, vite,
# start-server-and-test, run-p) that don't immediately forward SIGTERM to
# their children, so we have to give them a real grace window — but not so
# long that the user is staring at a hung terminal after Ctrl-C.
KILL_TREE_GRACE_SECS=5
SWEEP_GRACE_SECS=3

# Recursively SIGTERM a pid and all its descendants, then wait up to
# KILL_TREE_GRACE_SECS for them to exit, then SIGKILL anything still alive.
# Walks by parent-pid (independent of pgid, which `mise run` rewrites for its
# tasks) so we catch the whole tree before any layer dies and orphans its
# children to init.
#
# Two-phase TERM-then-KILL because the wrapper layers in this stack (pnpm,
# npm exec, run-p, start-server-and-test) frequently exit *before* relaying
# SIGTERM to their grandchildren. A bare SIGTERM-only walk returns while
# those grandchildren are still alive, the calling script exits, and they
# reparent to init and keep their ports bound — which is exactly the leak
# this helper is supposed to prevent.
kill_tree() {
  _kill_tree_collect_pids "$1"
  _kill_tree_pids="$_kill_tree_collected"

  for pid in $_kill_tree_pids; do
    kill -TERM "$pid" 2>/dev/null || true
  done

  elapsed=0
  while [ "$elapsed" -lt "$KILL_TREE_GRACE_SECS" ]; do
    any_alive=0
    for pid in $_kill_tree_pids; do
      if kill -0 "$pid" 2>/dev/null; then
        any_alive=1
        break
      fi
    done
    if [ "$any_alive" -eq 0 ]; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  for pid in $_kill_tree_pids; do
    kill -KILL "$pid" 2>/dev/null || true
  done
}

# Collect the pid and all descendants (post-order: leaves first, root last)
# into the global $_kill_tree_collected. Doing this up front lets the caller
# SIGTERM the whole tree, wait once, then SIGKILL stragglers — instead of
# re-walking after every layer dies (which races children reparenting to
# init).
_kill_tree_collect_pids() {
  _kill_tree_collected=""
  _kill_tree_walk "$1"
}

_kill_tree_walk() {
  for child in $(pgrep -P "$1" 2>/dev/null); do
    _kill_tree_walk "$child"
  done
  _kill_tree_collected="$_kill_tree_collected $1"
}

# Sweep orphaned dev-stack processes scoped to this checkout. mise's task
# supervisor reparents long-running task scripts to init, and the wrapper
# layers above ts-node (pnpm, npm exec, run-p, vite, start-server-and-test)
# routinely exit without relaying SIGTERM to their grandchildren — so a
# tree-walk from a known pid can't reach all of them via PPID. SIGTERM first
# for anything that listens, brief grace, then SIGKILL.
#
# `pkill -f` matches its pattern as ERE, so $REPO_ROOT must be regex-escaped
# before interpolating; otherwise a checkout path with metacharacters (e.g.
# `boxel.worktrees/...`, where `.` matches any char) would over-match and
# signal unrelated processes outside this checkout. Every pattern is
# anchored to ${REPO_ROOT_RE} so it never matches outside this checkout —
# the user may have unrelated vite/ember/node processes running for other
# projects.
#
# The patterns:
#   - mise-tasks/services/* — the bash service entrypoints
#   - node_modules.*--transpileOnly (worker|main|prerender) — ts-node
#     grandchildren that actually hold the realm/worker/prerender ports
#     (4201/4202, 4210/4211, 4221/4222). Wrappers that just invoke ts-node
#     don't `exec` it, so killing the wrapper alone leaves the ts-node
#     grandchild reparented to init with its port still bound.
#   - packages/host/.*vite/bin/vite.js — the host dev server (port 4200)
#   - node_modules/.*/start-server-and-test/ — the phase-coordinator that
#     owns the run-p subtree
#   - node_modules/.*/npm-run-all/.*run-[ps] — run-p / run-s, which spawn
#     the `npm run start:*` wrappers and don't always forward signals
sweep_orphaned_services() {
  REPO_ROOT_RE="$(printf '%s' "$REPO_ROOT" | sed -E 's/[][\\.*^$+?(){}|]/\\&/g')"
  TSNODE_RE="${REPO_ROOT_RE}/packages/realm-server/node_modules.*--transpileOnly (worker|main|prerender)"
  VITE_RE="${REPO_ROOT_RE}/packages/host/.*vite/bin/vite\.js"
  SAT_RE="${REPO_ROOT_RE}/.*node_modules/.*start-server-and-test/"
  RUNP_RE="${REPO_ROOT_RE}/.*node_modules/.*npm-run-all/bin/run-[ps]"

  for sig in TERM KILL; do
    pkill -"$sig" -f "${REPO_ROOT_RE}/mise-tasks/services/" 2>/dev/null || true
    pkill -"$sig" -f "$TSNODE_RE" 2>/dev/null || true
    pkill -"$sig" -f "$VITE_RE" 2>/dev/null || true
    pkill -"$sig" -f "$SAT_RE" 2>/dev/null || true
    pkill -"$sig" -f "$RUNP_RE" 2>/dev/null || true
    if [ "$sig" = "TERM" ]; then
      sleep "$SWEEP_GRACE_SECS"
    fi
  done
}

READY_PATH="_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"

# Phase 1 readiness URLs
BASE_REALM_READY="http-get://${REALM_BASE_URL#http://}/base/${READY_PATH}"
SKILLS_READY="http-get://${REALM_BASE_URL#http://}/skills/${READY_PATH}"
PHASE1_URLS="${BASE_REALM_READY}|${SKILLS_READY}"

if [ -z "${SKIP_CATALOG:-}" ]; then
  PHASE1_URLS="${PHASE1_URLS}|http-get://${REALM_BASE_URL#http://}/catalog/${READY_PATH}"
  PHASE1_URLS="${PHASE1_URLS}|http-get://${REALM_BASE_URL#http://}/legacy-catalog/${READY_PATH}"
fi
if [ -z "${SKIP_BOXEL_HOMEPAGE:-}" ]; then
  PHASE1_URLS="${PHASE1_URLS}|http-get://${REALM_BASE_URL#http://}/boxel-homepage/${READY_PATH}"
fi
if [ -z "${SKIP_EXPERIMENTS:-}" ]; then
  PHASE1_URLS="${PHASE1_URLS}|http-get://${REALM_BASE_URL#http://}/experiments/${READY_PATH}"
fi
PHASE1_URLS="${PHASE1_URLS}|http-get://${REALM_BASE_URL#http://}/software-factory/${READY_PATH}"

PHASE1_URLS="${PHASE1_URLS}|${MATRIX_URL_VAL}|http://localhost:5001|${ICONS_URL}"

# Phase 2 readiness URL
NODE_TEST_REALM_READY="http-get://${REALM_TEST_URL#http://}/node-test/${READY_PATH}"

# In environment mode, bootstrap infra before starting services
if [ -n "$BOXEL_ENVIRONMENT" ]; then
  ./scripts/start-pg.sh
  echo "Waiting for Postgres to accept connections…"
  until docker exec boxel-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  "$REPO_ROOT/scripts/ensure-branch-db.sh"
  echo "Running database migrations…"
  pnpm migrate
  if [ "${INDEX_CACHE:-}" = "true" ]; then
    if "$REPO_ROOT/scripts/import-cached-index.sh"; then
      export REALM_SERVER_FULL_INDEX_ON_STARTUP="${REALM_SERVER_FULL_INDEX_ON_STARTUP:-false}"
    fi
  fi
  ./scripts/start-matrix.sh
fi
