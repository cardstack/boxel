#! /bin/sh

# Ensures Traefik is running when in branch mode (BOXEL_BRANCH is set).
# Sources like wait-for-pg.sh: `. "$SCRIPTS_DIR/ensure-traefik.sh"`
# Call ensure_traefik after sourcing.

ensure_traefik() {
  if [ -z "$BOXEL_BRANCH" ]; then
    return 0
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^boxel-traefik$'; then
    return 0
  fi

  echo "Branch mode requires Traefik. Starting it now..."
  REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
  if [ ! -f "$REPO_ROOT/docker-compose.traefik.yml" ]; then
    echo "ERROR: docker-compose.traefik.yml not found at $REPO_ROOT"
    echo "Cannot start Traefik. Please run: sh scripts/start-traefik.sh"
    exit 1
  fi

  docker compose -f "$REPO_ROOT/docker-compose.traefik.yml" up -d
  if [ $? -ne 0 ]; then
    echo "ERROR: Failed to start Traefik."
    echo "Is Docker running? Try: sh scripts/start-traefik.sh"
    exit 1
  fi
  echo "Traefik started. Dashboard at http://localhost:4230"
}
