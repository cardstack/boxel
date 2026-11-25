#!/bin/sh
# Start Synapse with per-environment data directory when BOXEL_ENVIRONMENT is set.
# Otherwise the machine-wide dev synapse uses the main checkout's synapse-data,
# also when started from a linked worktree (see scripts/synapse-data-dir.js).

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/../../../scripts/env-slug.sh"

if [ -n "$BOXEL_ENVIRONMENT" ]; then
  SLUG=$(resolve_env_slug)
  SYNAPSE_DATA_DIR="./synapse-data-${SLUG}"
else
  SYNAPSE_DATA_DIR=$(node "$SCRIPTS_DIR/../../../scripts/synapse-data-dir.js") || exit 1
fi

mkdir -p "${SYNAPSE_DATA_DIR}/db"
export SYNAPSE_DATA_DIR
exec node ./scripts/synapse.ts start
