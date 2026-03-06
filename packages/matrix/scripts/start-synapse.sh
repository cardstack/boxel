#!/bin/sh
# Start Synapse with per-environment data directory when BOXEL_ENVIRONMENT is set.

if [ -n "$BOXEL_ENVIRONMENT" ]; then
  SLUG=$(echo "$BOXEL_ENVIRONMENT" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  SYNAPSE_DATA_DIR="./synapse-data-${SLUG}"
else
  SYNAPSE_DATA_DIR="./synapse-data"
fi

mkdir -p "${SYNAPSE_DATA_DIR}/db"
export SYNAPSE_DATA_DIR
exec ts-node --transpileOnly ./scripts/synapse.ts start
