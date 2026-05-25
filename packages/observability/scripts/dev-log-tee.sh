#!/usr/bin/env bash
#
# Tees stdin to ${BOXEL_LOG_DIR:-/tmp/boxel-logs}/<service>.log while passing
# every byte through to stdout unchanged.
#
# Used by the local mise dev tasks (see mise-tasks/services/{realm-server,
# worker, prerender, prerender-mgr}) so the local Alloy log scraper can pick
# up natively-run boxel processes via `loki.source.file`. Alloy's Docker
# socket discovery only sees containers, and these processes are not
# containerized in the dev loop.
#
# Appends across runs (`tee -a`) so Alloy's file-watcher keeps a stable
# inode + monotonically-growing offset — truncating in place confuses the
# tail watcher and drops the first lines of the new run. Devs can wipe the
# accumulated log with `rm $LOG_DIR/*.log` between runs if they want a
# clean slate; Loki queries are time-bounded anyway.
#
# Usage (in a pipeline):
#   long-running-cmd ... 2>&1 | dev-log-tee.sh realm-server
#
# Override the log directory:
#   BOXEL_LOG_DIR=/path/to/logs long-running-cmd ... | dev-log-tee.sh worker

set -uo pipefail

# Dev logs include JWTs and request bodies. Default `022` umask would
# create world-readable files under /tmp; restrict to owner-only.
umask 077

SERVICE_NAME="${1:?dev-log-tee.sh: missing service name}"
LOG_DIR="${BOXEL_LOG_DIR:-/tmp/boxel-logs}"

# Reject relative BOXEL_LOG_DIR overrides — the wrapper resolves relative
# paths from each mise task's `dir=` (packages/realm-server), but Compose
# resolves them from the compose file directory, so a relative override
# silently makes the writer and the Alloy bind-mount point at different
# host directories. The default ("/tmp/boxel-logs") is absolute.
case "$LOG_DIR" in
	/*) ;;
	*)
		echo "dev-log-tee.sh: BOXEL_LOG_DIR must be an absolute path (got: $LOG_DIR)" >&2
		exit 1
		;;
esac

# Best-effort: tee into the per-service log file if the directory is
# writable. Otherwise fall through to plain `cat`, so the dev process keeps
# running even when local Loki can't be fed (e.g. on Linux, `docker compose
# up` may have already created /tmp/boxel-logs as root before this runs).
if mkdir -p "$LOG_DIR" 2>/dev/null && [ -w "$LOG_DIR" ]; then
	exec tee -a "$LOG_DIR/${SERVICE_NAME}.log"
fi

cat >&2 <<EOF
warning: dev-log-tee.sh: ${LOG_DIR} is not writable; ${SERVICE_NAME} logs
  will not show up in local Loki. Most often this means the directory was
  created as root by docker compose. Either remove and recreate it
  (\`sudo rm -rf ${LOG_DIR}\`) or override the path
  (\`BOXEL_LOG_DIR=\$HOME/.cache/boxel-logs\`).
EOF
exec cat
