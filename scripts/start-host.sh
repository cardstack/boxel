#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

ENV="${1:-staging}"
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
pnpm --filter @cardstack/host start
