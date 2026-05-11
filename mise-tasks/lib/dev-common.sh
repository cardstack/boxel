#!/bin/sh
# Shared setup for dev and dev-all mise tasks.
# Sourced (not executed) — sets variables and bootstraps infra.
# Expects to run with MISE dir=packages/realm-server.

REPO_ROOT="$(cd "../.." && pwd)"

# Use absolute paths so spawned processes carry absolute argv[0]; this keeps
# the regex sweeps in `sweep_orphaned_services` anchored to this checkout
# reliable regardless of how the binary was originally resolved by PATH.
export PATH="${REPO_ROOT}/node_modules/.bin:${REPO_ROOT}/packages/realm-server/node_modules/.bin:./node_modules/.bin:$PATH"

# Recursively SIGTERM a pid and all its descendants. Walks by parent-pid
# (independent of pgid, which `mise run` rewrites for its tasks) so we catch
# the whole tree before any layer dies and orphans its children to init.
kill_tree() {
  for child in $(pgrep -P "$1" 2>/dev/null); do
    kill_tree "$child"
  done
  kill -TERM "$1" 2>/dev/null || true
}

# Sweep orphaned mise services scoped to this checkout. mise's task supervisor
# reparents long-running task scripts to init, so a tree-walk from a known
# pid can't reach them via PPID. SIGTERM first for anything that listens,
# brief grace, then SIGKILL — belt-and-suspenders for processes that don't
# respond to TERM.
#
# `pkill -f` matches its pattern as ERE, so $REPO_ROOT must be regex-escaped
# before interpolating; otherwise a checkout path with metacharacters (e.g.
# `boxel.worktrees/...`, where `.` matches any char) would over-match and
# signal unrelated processes outside this checkout. The trailing
# `node_modules.*--transpileOnly …` is an INTENTIONAL regex: `node_modules.*`
# matches whichever subpath the ts-node binary resolves through, and the
# alternation lists every service entrypoint that holds a port (worker /
# worker-manager → 4210, main → 4201/4202, prerender/* → 4221/4222).
# Wrappers that just invoke ts-node don't `exec` it, so killing the wrapper
# alone leaves the ts-node grandchild reparented to init with its port
# still bound.
sweep_orphaned_services() {
  REPO_ROOT_RE="$(printf '%s' "$REPO_ROOT" | sed -E 's/[][\\.*^$+?(){}|]/\\&/g')"
  TSNODE_RE="${REPO_ROOT_RE}/packages/realm-server/node_modules.*--transpileOnly (worker|main|prerender)"
  pkill -TERM -f "${REPO_ROOT_RE}/mise-tasks/services/" 2>/dev/null || true
  pkill -TERM -f "$TSNODE_RE" 2>/dev/null || true
  sleep 2
  pkill -KILL -f "${REPO_ROOT_RE}/mise-tasks/services/" 2>/dev/null || true
  pkill -KILL -f "$TSNODE_RE" 2>/dev/null || true
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
