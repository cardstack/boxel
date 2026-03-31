#!/bin/sh
# Start Synapse with per-environment data directory when BOXEL_ENVIRONMENT is set.

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/../../../scripts/env-slug.sh"

if [ -n "$BOXEL_ENVIRONMENT" ]; then
  SLUG=$(resolve_env_slug)
  SYNAPSE_DATA_DIR="./synapse-data-${SLUG}"
else
  SYNAPSE_DATA_DIR="./synapse-data"
fi

mkdir -p "${SYNAPSE_DATA_DIR}/db"
export SYNAPSE_DATA_DIR
exec ts-node --transpileOnly ./scripts/synapse.ts start
