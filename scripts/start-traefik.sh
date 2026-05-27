#!/bin/sh
# Starts the Traefik reverse proxy if not already running.
# Also cleans up stale per-environment Synapse containers.
# Idempotent — safe to call multiple times.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# If a Traefik container exists but its dynamic-config bind mount points
# at a directory other than this worktree's traefik/dynamic (e.g. the
# originating worktree was deleted), remove it so the compose-up branch
# below recreates it from the current worktree.
if docker ps -a --format '{{.Names}}' | grep -q '^boxel-traefik$'; then
  MOUNTED="$(docker inspect boxel-traefik --format '{{range .Mounts}}{{if eq .Destination "/etc/traefik/dynamic"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
  EXPECTED="$REPO_ROOT/traefik/dynamic"
  if [ -n "$MOUNTED" ] && [ "$MOUNTED" != "$EXPECTED" ]; then
    echo "Traefik dynamic-config mount is stale ($MOUNTED); recreating from $EXPECTED"
    docker rm -f boxel-traefik >/dev/null
  fi
fi

# --- Start Traefik ---
if docker ps --format '{{.Names}}' | grep -q '^boxel-traefik$'; then
  echo "Traefik is already running."
elif docker ps -a --format '{{.Names}}' | grep -q '^boxel-traefik$'; then
  echo "Restarting stopped Traefik container..."
  docker start boxel-traefik
  echo "Traefik started. Dashboard at http://localhost:4230"
else
  echo "Starting Traefik..."
  docker compose -f "$REPO_ROOT/docker-compose.traefik.yml" up -d
  echo "Traefik started. Dashboard at http://localhost:4230"
fi

# --- Clean up stale Synapse containers ---
# Stop any boxel-synapse-* containers whose environment has no running processes.
for CONTAINER in $(docker ps --format '{{.Names}}' | grep '^boxel-synapse-'); do
  SLUG="${CONTAINER#boxel-synapse-}"
  # Check if any process is using this environment's slug (realm server, host, etc.)
  if ! ps ax -o command 2>/dev/null | grep -q "${SLUG}\.localhost"; then
    echo "Removing stale Synapse container: $CONTAINER (no running services for $SLUG)"
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
done
