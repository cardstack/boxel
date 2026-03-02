#! /bin/sh

# Ensures Traefik is running when in branch mode (BOXEL_BRANCH is set).
# Sources like wait-for-pg.sh: `. "$SCRIPTS_DIR/ensure-traefik.sh"`
# Call ensure_traefik after sourcing.

ensure_traefik() {
  if [ -z "$BOXEL_BRANCH" ]; then
    return 0
  fi

  REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
  sh "$REPO_ROOT/scripts/start-traefik.sh"
}
