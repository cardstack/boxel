#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

ENV="${1:?Usage: $0 <staging|production>}"
ENV_FILE="packages/host/config/${ENV}.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Unknown environment '${ENV}'. Use 'staging' or 'production'."
  exit 1
fi

# This launcher is commonly invoked from non-interactive shells (including
# agents and IDE tasks), where mise's shell hook has not populated the
# worktree-local environment. Load it here so a `.mise.local.toml` environment
# slug, dynamic Host URL, and remote-service opt-in survive every rebuild.
if command -v mise >/dev/null 2>&1; then
  eval "$(mise env -s bash)"
fi

echo "Starting host against ${ENV}..."

set -a
source "$ENV_FILE"
set +a

# Environment mode normally protects isolated worktrees from accidentally
# inheriting another process's service URLs. This launcher is the explicit
# exception: its entire purpose is to connect the local Host to the selected
# remote control plane.
if [ -n "${BOXEL_ENVIRONMENT:-}" ]; then
  export BOXEL_ENVIRONMENT_REMOTE_SERVICES=true
fi

if [ "$ENV" = "staging" ]; then
  case "${MATRIX_URL:-}" in
    https://matrix-staging.stack.cards) ;;
    *)
      echo "Refusing to start: staging Matrix is not configured (got '${MATRIX_URL:-unset}')." >&2
      exit 1
      ;;
  esac
  case "${REALM_SERVER_DOMAIN:-}" in
    https://realms-staging.stack.cards/) ;;
    *)
      echo "Refusing to start: staging realm server is not configured (got '${REALM_SERVER_DOMAIN:-unset}')." >&2
      exit 1
      ;;
  esac
fi

echo "Host URL: ${HOST_URL:-https://localhost:4200}"
echo "Matrix: ${MATRIX_URL}"
echo "Realm server: ${REALM_SERVER_DOMAIN}"

pnpm install
pnpm --filter @cardstack/host start
