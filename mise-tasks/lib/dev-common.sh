#!/bin/sh
# Shared setup for dev and dev-all mise tasks.
# Sourced (not executed) — sets variables and bootstraps infra.
# Expects to run with MISE dir=packages/realm-server.

REPO_ROOT="$(cd "../.." && pwd)"

# boxel_pg_is_ready and friends, shared with the scripts that start boxel-pg.
. "$REPO_ROOT/scripts/pg-container.sh"

# Use absolute paths so spawned processes carry absolute argv[0]; this keeps
# the regex sweeps in `sweep_orphaned_services` anchored to this checkout
# reliable regardless of how the binary was originally resolved by PATH.
export PATH="${REPO_ROOT}/node_modules/.bin:${REPO_ROOT}/packages/realm-server/node_modules/.bin:./node_modules/.bin:$PATH"

# In *standard* dev mode, pin the published-realm domain to a 3-label
# form that browsers and Node accept as a wildcard SAN
# (`*.boxel-dev.localhost`). RFC 6125 §7.2 refuses single-label
# wildcards like `*.localhost`, so the dev cert can't usefully cover
# `<tenant>.localhost` no matter what's in the SAN list.
#
# Skip when BOXEL_ENVIRONMENT is set — env-mode uses Traefik-routed
# `https://realm-server.<slug>.localhost` URLs on dynamic ports
# (see lib/env-vars.sh), and forcing `boxel-dev.localhost:4201`
# there would steer the publish-realm modal at a host that isn't
# being served. Env-mode harnesses set their own
# PUBLISHED_REALM_BOXEL_* values explicitly when they need them.
#
# Setting these here (rather than in lib/env-vars.sh) also keeps
# matrix-test runs unaffected: the matrix harness doesn't source
# dev-common.sh, so it keeps relying on the `localhost:4201` literal
# sentinel that handlers/serve-index.ts rewrites on the fly.
# Per-shell overrides still win via the `:-` default.
if [ -z "${BOXEL_ENVIRONMENT:-}" ]; then
  export PUBLISHED_REALM_BOXEL_SPACE_DOMAIN="${PUBLISHED_REALM_BOXEL_SPACE_DOMAIN:-boxel-dev.localhost:4201}"
  export PUBLISHED_REALM_BOXEL_SITE_DOMAIN="${PUBLISHED_REALM_BOXEL_SITE_DOMAIN:-boxel-dev.localhost:4201}"
fi

# How long to wait for SIGTERM'd processes to exit before escalating to
# SIGKILL. The dev stack has slow propagators in it (pnpm, npm exec, vite,
# start-server-and-test, run-p) that don't immediately forward SIGTERM to
# their children, so we have to give them a real grace window — but not so
# long that the user is staring at a hung terminal after Ctrl-C.
KILL_TREE_GRACE_SECS=2
SWEEP_GRACE_SECS=3
PGROUP_GRACE_SECS=2

# Pidfile records the top-level pgroup leaders dev-all/dev spawn so that
# `mise run kill-all` can recover after an abnormal exit (SIGKILL, OOM,
# parent terminal killed) that prevented the trap from firing. Default
# location prefers $XDG_RUNTIME_DIR (typically /run/user/$UID, mode 0700,
# per-user) over /tmp (world-writable sticky) so the file can't be
# symlink-targeted by another local user.
#
# The `$$` suffix makes the pidfile unique to *this* dev-all session —
# without it, a Ctrl-C + restart cycle would race: dev-all #2's
# `init_pidfile` wipes the shared file and writes #2's pgroup leaders,
# then dev-all #1's still-watching guardian fires and reads #2's
# leaders as if they were its own, sending SIGTERM/SIGKILL to #2's
# services. The shared-path heritage is what caused vite-serve to be
# `Killed: 9` on dev-all restart. Override via BOXEL_DEV_ALL_PIDFILE
# for explicit harnesses that need a known path.
PIDFILE="${BOXEL_DEV_ALL_PIDFILE:-${XDG_RUNTIME_DIR:-/tmp}/boxel-dev-all-$$.pids}"

# Reset the pidfile at script start. Stale pids from a previous run would
# either be reused by unrelated processes or simply gone, both bad. `rm -f`
# unlinks any pre-existing symlink (rm targets the link, not its referent),
# so the subsequent truncate-via-redirect creates a fresh file even if the
# location was symlink-poisoned. `chmod 600` then narrows the file to the
# owning user.
init_pidfile() {
  rm -f "$PIDFILE" 2>/dev/null || true
  : > "$PIDFILE"
  chmod 600 "$PIDFILE" 2>/dev/null || true
}

# Append `<label>=<pid>` to the pidfile. The pid passed in must be a pgroup
# leader (i.e. spawned via `&` in a shell with `set -m`) — kill_from_pidfile
# signals the *process group*, not just this pid.
record_dev_pid() {
  printf '%s=%s\n' "$1" "$2" >> "$PIDFILE"
}

# SIGTERM the entire process group, give it PGROUP_GRACE_SECS to exit, then
# SIGKILL. Negative pid in `kill` targets the pgid; with `set -m` the
# top-level `&` children are pgroup leaders so PID == PGID, and one signal
# reaches the whole subtree atomically (no race with grandchildren
# reparenting to init before we walk to them).
kill_pgroup_escalating() {
  _kpe_pid="$1"
  _kpe_timeout="${2:-$PGROUP_GRACE_SECS}"
  kill -TERM -- "-$_kpe_pid" 2>/dev/null || true
  sleep "$_kpe_timeout"
  kill -KILL -- "-$_kpe_pid" 2>/dev/null || true
}

# Drain the pidfile: signal each recorded pgroup leader with TERM→KILL, then
# delete the file. Safe to call when the pidfile is missing or empty.
kill_from_pidfile() {
  if [ ! -f "$PIDFILE" ]; then
    return 0
  fi
  while IFS='=' read -r _kfp_label _kfp_pid; do
    [ -z "$_kfp_pid" ] && continue
    kill_pgroup_escalating "$_kfp_pid"
  done < "$PIDFILE"
  rm -f "$PIDFILE" 2>/dev/null || true
}

# Spawn a detached guardian process that polls the given parent pid and
# runs `kill_from_pidfile` + `sweep_orphaned_services` once that pid dies.
# This is the safety net for the case where dev-all's trap can't run —
# e.g. dev-all bash gets SIGKILL, mise terminates without forwarding INT/
# HUP, or the controlling session collapses before the trap handler can
# execute. The trap path is still the primary cleanup; the guardian only
# matters when the trap is denied a chance to fire.
#
# Implementation notes:
#   - `setsid` puts the guardian in its own session so it doesn't get
#     SIGHUP'd when dev-all's session dies. macOS doesn't ship setsid in
#     the base system (it's a Linux util-linux tool); we fall through to
#     plain `&` + `disown` + nohup-style ignored SIGHUP. The trap path is
#     still the primary cleanup signal — this guardian is a safety net
#     that only matters when the trap is denied a chance to fire — so
#     the marginal session-isolation guarantee setsid adds isn't worth
#     a hard dependency on util-linux.
#   - stdin/stdout/stderr are redirected away from the terminal so the
#     guardian can survive after the user's shell exits.
#   - Output goes to a log file so the user can audit what fired.
#   - The guardian exits as soon as it has run cleanup once; if cleanup
#     already ran via the trap (which deleted the pidfile), the guardian's
#     own `kill_from_pidfile` call is a no-op and the sweep is the only
#     real work, which is idempotent.
#   - `disown` removes the guardian from bash's job table so dev-all
#     doesn't try to wait on it at exit.
spawn_cleanup_guardian() {
  _scg_parent_pid="$1"
  _scg_log="${BOXEL_DEV_ALL_GUARDIAN_LOG:-${XDG_RUNTIME_DIR:-/tmp}/boxel-dev-all-guardian.log}"
  _scg_lib="$(cd "$(dirname "$0")" && pwd)/lib/dev-common.sh"
  if command -v setsid >/dev/null 2>&1; then
    _scg_session_prefix="setsid"
  else
    # macOS fallback: no session-leader detachment, but `trap '' HUP` in
    # the guardian body makes SIGHUP a no-op so a terminal hangup on the
    # parent shell doesn't kill us before cleanup runs.
    _scg_session_prefix=""
  fi
  $_scg_session_prefix sh -c "
    trap '' HUP
    exec </dev/null >>'$_scg_log' 2>&1
    echo \"[guardian \$(date +%H:%M:%S)] watching dev-all pid $_scg_parent_pid (pidfile $PIDFILE)\"
    while kill -0 $_scg_parent_pid 2>/dev/null; do
      sleep 1
    done
    echo \"[guardian \$(date +%H:%M:%S)] dev-all pid $_scg_parent_pid is gone; running cleanup\"
    BOXEL_DEV_COMMON_CLEANUP_ONLY=1
    BOXEL_DEV_ALL_PIDFILE='$PIDFILE'
    . '$_scg_lib'
    kill_from_pidfile
    sweep_orphaned_services
    echo \"[guardian \$(date +%H:%M:%S)] All dev-stack processes stopped (via guardian).\"
  " &
  disown 2>/dev/null || true
}

# Recursively SIGTERM a pid and all its descendants, sleep
# KILL_TREE_GRACE_SECS, then SIGKILL stragglers. Walks by parent-pid (PPID)
# rather than pgid because some callers pass a pid that isn't a pgroup
# leader (e.g. a service supervisor whose pgid was rewritten by mise);
# kill_pgroup_escalating is the preferred primitive when the pid *is* a
# pgroup leader.
#
# Two-phase TERM-then-KILL because the wrapper layers in this stack (pnpm,
# npm exec, run-p, start-server-and-test) frequently exit *before* relaying
# SIGTERM to their grandchildren. A bare SIGTERM-only walk returns while
# those grandchildren are still alive, the calling script exits, and they
# reparent to init and keep their ports bound — which is exactly the leak
# this helper is supposed to prevent.
# All locals carry an `_kill_tree_` prefix because this file is sourced, so
# bare names like `pid` would become globals in the caller's shell and
# could clobber its variables. `local` would be cleaner but isn't in POSIX
# sh and this file runs under `#!/bin/sh`.
kill_tree() {
  _kill_tree_collect_pids "$1"
  _kill_tree_pids="$_kill_tree_collected"

  for _kill_tree_pid in $_kill_tree_pids; do
    kill -TERM "$_kill_tree_pid" 2>/dev/null || true
  done

  # Poll at 100ms intervals up to KILL_TREE_GRACE_SECS so a fast,
  # well-behaved SIGTERM shutdown isn't penalized with the full grace
  # window. Each tick re-checks whether any tracked pid is still alive
  # via `kill -0`; we exit as soon as the set is empty. Plain integer
  # tick counter rather than nanosecond-deadline math because `date +%N`
  # isn't POSIX (BSD date rejects it).
  _kill_tree_ticks=$(( KILL_TREE_GRACE_SECS * 10 ))
  while [ "$_kill_tree_ticks" -gt 0 ]; do
    _kill_tree_alive=0
    for _kill_tree_pid in $_kill_tree_pids; do
      if kill -0 "$_kill_tree_pid" 2>/dev/null; then
        _kill_tree_alive=1
        break
      fi
    done
    [ "$_kill_tree_alive" -eq 0 ] && break
    sleep 0.1
    _kill_tree_ticks=$(( _kill_tree_ticks - 1 ))
  done

  for _kill_tree_pid in $_kill_tree_pids; do
    kill -KILL "$_kill_tree_pid" 2>/dev/null || true
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

# `|| true` because pgrep exits 1 when a pid has no children, which would
# abort callers running under `set -e` even though "no children" is the
# normal terminating case for the recursion.
_kill_tree_walk() {
  for _kill_tree_child in $(pgrep -P "$1" 2>/dev/null || true); do
    _kill_tree_walk "$_kill_tree_child"
  done
  _kill_tree_collected="$_kill_tree_collected $1"
}

. "$REPO_ROOT/mise-tasks/lib/orphaned-services.sh"

READY_PATH="_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"

# Pick wait-on's protocol prefix based on the realm-server's scheme. Local
# dev runs HTTPS+HTTP/2 by default; tests/CI fall back to plain HTTP when
# `infra:ensure-dev-cert` hasn't run. `${REALM_BASE_URL#*://}` strips
# whichever scheme is in use to feed wait-on's authority-only form.
case "$REALM_BASE_URL" in
  https://*) REALM_READY_SCHEME="https-get" ;;
  *)         REALM_READY_SCHEME="http-get"  ;;
esac
case "$REALM_TEST_URL" in
  https://*) REALM_TEST_READY_SCHEME="https-get" ;;
  *)         REALM_TEST_READY_SCHEME="http-get"  ;;
esac

# Phase 1 readiness URLs
BASE_REALM_READY="${REALM_READY_SCHEME}://${REALM_BASE_URL#*://}/base/${READY_PATH}"
SKILLS_READY="${REALM_READY_SCHEME}://${REALM_BASE_URL#*://}/skills/${READY_PATH}"
# choreo-gallery and pretui boot last and the test realms need neither, so they
# finish indexing while the test realms start.
PHASE1_URLS="${BASE_REALM_READY}|${SKILLS_READY}"

if [ -z "${SKIP_CATALOG:-}" ]; then
  PHASE1_URLS="${PHASE1_URLS}|${REALM_READY_SCHEME}://${REALM_BASE_URL#*://}/catalog/${READY_PATH}"
fi
if [ -z "${SKIP_BOXEL_HOMEPAGE:-}" ]; then
  PHASE1_URLS="${PHASE1_URLS}|${REALM_READY_SCHEME}://${REALM_BASE_URL#*://}/boxel-homepage/${READY_PATH}"
fi
if [ -z "${SKIP_EXPERIMENTS:-}" ]; then
  PHASE1_URLS="${PHASE1_URLS}|${REALM_READY_SCHEME}://${REALM_BASE_URL#*://}/experiments/${READY_PATH}"
fi
PHASE1_URLS="${PHASE1_URLS}|${REALM_READY_SCHEME}://${REALM_BASE_URL#*://}/software-factory/${READY_PATH}"

PHASE1_URLS="${PHASE1_URLS}|${MATRIX_URL_VAL}|http://localhost:5001|${ICONS_URL}"

# Phase 2 readiness URL
NODE_TEST_REALM_READY="${REALM_TEST_READY_SCHEME}://${REALM_TEST_URL#*://}/node-test/${READY_PATH}"

# In environment mode, bootstrap infra before starting services. The cleanup
# guardian loads this file only for its functions, after the stack has exited,
# and must not bring the environment's database, index or Synapse back up.
if [ -n "$BOXEL_ENVIRONMENT" ] && [ -z "${BOXEL_DEV_COMMON_CLEANUP_ONLY:-}" ]; then
  ./scripts/start-pg.sh
  echo "Waiting for Postgres to accept connections…"
  until boxel_pg_is_ready; do sleep 1; done
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
