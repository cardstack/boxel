#!/bin/sh
# Start Synapse with per-branch data directory when BOXEL_BRANCH is set.

if [ -n "$BOXEL_BRANCH" ]; then
  SLUG=$(echo "$BOXEL_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  SYNAPSE_DATA_DIR="./synapse-data-${SLUG}"
else
  SYNAPSE_DATA_DIR="./synapse-data"
fi

mkdir -p "${SYNAPSE_DATA_DIR}/db"
export SYNAPSE_DATA_DIR
exec ts-node --transpileOnly ./scripts/synapse.ts start
