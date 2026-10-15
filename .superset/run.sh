#!/usr/bin/env bash
# Superset run command: starts the host app and the full dev stack for this
# workspace in environment mode, so any number of workspaces can run side by
# side without contending for ports, databases or realm directories. The fixed
# localhost ports (4200, 4201, ...) stay free for the shared test stack.
set -euo pipefail

. "$(cd "$(dirname "$0")" && pwd)/lib.sh"
cd "$WORKSPACE_PATH"

# The first start of a new environment imports CI's pre-built index instead
# of indexing every realm from scratch. Later starts keep the workspace's own
# index, which the realm-server's file watcher keeps current.
INDEX_MARKER="$STATE_DIR/index-imported"
if [ ! -f "$INDEX_MARKER" ] && [ -z "${INDEX_CACHE:-}" ] && command -v gh >/dev/null 2>&1; then
  export INDEX_CACHE=true
  touch "$INDEX_MARKER"
fi

log "environment: $BOXEL_ENVIRONMENT"
log "host app:     https://host.${BOXEL_ENVIRONMENT}.localhost"
log "realm server: https://realm-server.${BOXEL_ENVIRONMENT}.localhost"
exec mise run dev-all
