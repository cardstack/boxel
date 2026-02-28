#!/bin/sh
# Ensure Synapse is running. In branch mode, also auto-register users
# since each branch gets a fresh Synapse data dir.

cd ../matrix

pnpm assert-synapse-running

# In branch mode, register users automatically — each branch starts
# with an empty Synapse, so users must be created on every fresh start.
if [ -n "$BOXEL_BRANCH" ]; then
  SLUG=$(echo "$BOXEL_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  export PGDATABASE="${PGDATABASE:-boxel_${SLUG}}"
  export PGPORT="${PGPORT:-5435}"
  pnpm register-all
fi
