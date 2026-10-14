#!/usr/bin/env bash
# Superset workspace teardown. Stops only what belongs to this workspace: its
# own environment-mode stack (processes, Traefik routes and databases keyed by
# its slug).
#
# Everything else on the machine is shared, and agents share it by agreement:
# the fixed-port test stack, the realm-server test lane, and the Docker
# containers every stack uses. Who may stop or move one of those is settled
# between the live agents (see the agent-peer-collaboration skill), never by a
# script. Deleting this worktree pulls the files out from under anything
# running from it, so if any shared resource is hosted here, teardown fails
# and names it, and the handoff happens between agents before the workspace
# is deleted.
set -euo pipefail

. "$(cd "$(dirname "$0")" && pwd)/lib.sh"
cd "$WORKSPACE_PATH"

if is_root_checkout; then
  log "refusing to tear down the root checkout's environment"
  exit 0
fi

# Shared resources are recognised the way the agent-peer-collaboration skill
# defines them: a listener on one of the fixed-port test stack's ports, or a
# realm-server test run, whose process was launched from this worktree.
in_workspace() {
  case "$(readlink "/proc/$1/cwd" 2>/dev/null || true)" in
    "$WORKSPACE_PATH" | "$WORKSPACE_PATH"/*) return 0 ;;
  esac
  return 1
}
describe() {
  tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null | cut -c -160
}

hosted=""
for port in 4200 4201 4202 4206 4208 4210 4211 4213 4221 4222; do
  for pid in $(ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do
    if in_workspace "$pid"; then
      hosted="${hosted}  :$port (pid $pid) $(describe "$pid")"$'\n'
    fi
  done
done
for pid in $(pgrep -f '^node .*tests/index\.ts' 2>/dev/null || true); do
  if in_workspace "$pid"; then
    hosted="${hosted}  realm-server test run (pid $pid) $(describe "$pid")"$'\n'
  fi
done

# Shared containers whose bind mounts live in this worktree, e.g. Traefik's
# dynamic config dir when this workspace was the first to start Traefik.
for container in $(docker ps --format '{{.Names}}' 2>/dev/null); do
  case "$container" in boxel-synapse-"$BOXEL_ENVIRONMENT") continue ;; esac
  while IFS= read -r src; do
    case "$src" in
      "$WORKSPACE_PATH" | "$WORKSPACE_PATH"/*)
        hosted="${hosted}  container $container mounts $src"$'\n'
        ;;
    esac
  done < <(docker inspect "$container" --format '{{range .Mounts}}{{println .Source}}{{end}}' 2>/dev/null || true)
done

if [ -n "$hosted" ]; then
  echo
  log "this workspace still hosts shared resources other agents may depend on:"
  printf '%s' "$hosted"
  log "deleting the worktree would break them. Before deleting, the agent in this"
  log "workspace hands them off to the live peers (agent-peer-collaboration skill):"
  log "ask who is riding them, agree who restarts them from which checkout, and"
  log "announce the stop before it happens. Then delete the workspace again."
  exit 1
fi

log "stopping environment $BOXEL_ENVIRONMENT"
mise exec -- ./scripts/stop-environment.sh "$BOXEL_ENVIRONMENT" --drop-db

# The dev cert carries a SAN for every slug in this list; dropping the slug
# keeps the list from growing with every workspace. The cert itself is left
# alone, since extra SANs are harmless and it is only regenerated when one is
# missing.
SLUGS_FILE="${BOXEL_DEV_CERT_DIR:-$HOME/.local/share/boxel/dev-certs}/known-env-slugs.txt"
if [ -f "$SLUGS_FILE" ] && grep -qxF "$BOXEL_ENVIRONMENT" "$SLUGS_FILE"; then
  grep -vxF "$BOXEL_ENVIRONMENT" "$SLUGS_FILE" > "$SLUGS_FILE.tmp" || true
  mv "$SLUGS_FILE.tmp" "$SLUGS_FILE"
  log "removed $BOXEL_ENVIRONMENT from $SLUGS_FILE"
fi

log "teardown complete"
