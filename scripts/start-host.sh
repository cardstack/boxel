#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

ENV="${1:?Usage: $0 <staging|production>}"
ENV_FILE="packages/host/config/${ENV}.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Unknown environment '${ENV}'. Use 'staging' or 'production'."
  exit 1
fi

echo "Starting host against ${ENV}..."

set -a
source "$ENV_FILE"
set +a

pnpm install
if [ "$ENV" = "staging" ]; then
  # Re-apply staging after any mise/shell activation and provision the local
  # HTTPS endpoint used by the iframe renderer. Two Vite hosts from the same
  # worktree are unsupported because they share generated config/cache state.
  pnpm --filter @cardstack/host start:staging
else
  pnpm --filter @cardstack/host start
fi
