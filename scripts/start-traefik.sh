#!/bin/sh
# Starts the Traefik reverse proxy if not already running.
# Idempotent — safe to call multiple times.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if docker ps --format '{{.Names}}' | grep -q '^boxel-traefik$'; then
  echo "Traefik is already running."
  exit 0
fi

if docker ps -a --format '{{.Names}}' | grep -q '^boxel-traefik$'; then
  echo "Restarting stopped Traefik container..."
  docker start boxel-traefik
else
  echo "Starting Traefik..."
  docker compose -f "$REPO_ROOT/docker-compose.traefik.yml" up -d
fi
echo "Traefik started. Dashboard at http://localhost:4230"
