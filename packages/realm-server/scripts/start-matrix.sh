#!/bin/sh
# Ensure Synapse is running. In environment mode, also auto-register users
# since each environment gets a fresh Synapse data dir.

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/../../../scripts/env-slug.sh"

cd ../matrix

pnpm assert-synapse-running

# In environment mode, register users once per fresh Synapse data dir.
if [ -n "$BOXEL_ENVIRONMENT" ]; then
  SLUG=$(resolve_env_slug)
  export PGDATABASE="${PGDATABASE:-boxel_${SLUG}}"
  export PGPORT="${PGPORT:-5435}"

  MARKER="./synapse-data-${SLUG}/.users-registered"
  if [ ! -f "$MARKER" ]; then
    echo "First start for environment — registering users..."
    pnpm register-all && touch "$MARKER"
  else
    echo "Users already registered for this environment, skipping."
  fi
fi
