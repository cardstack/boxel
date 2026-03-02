#!/bin/sh
# Ensure Synapse is running. In branch mode, also auto-register users
# since each branch gets a fresh Synapse data dir.

cd ../matrix

pnpm assert-synapse-running

# In branch mode, register users once per fresh Synapse data dir.
if [ -n "$BOXEL_BRANCH" ]; then
  SLUG=$(echo "$BOXEL_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  export PGDATABASE="${PGDATABASE:-boxel_${SLUG}}"
  export PGPORT="${PGPORT:-5435}"

  MARKER="./synapse-data-${SLUG}/.users-registered"
  if [ ! -f "$MARKER" ]; then
    echo "First start for branch — registering users..."
    pnpm register-all
    touch "$MARKER"
  else
    echo "Users already registered for this branch, skipping."
  fi
fi
