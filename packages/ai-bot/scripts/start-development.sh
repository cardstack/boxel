#!/bin/sh
# Start the ai-bot for local development.
# Branch-aware: auto-discovers Synapse port and database when BOXEL_BRANCH is set.

set -e

export NODE_NO_WARNINGS=1
export PGPORT="${PGPORT:-5435}"

if [ -n "$BOXEL_BRANCH" ]; then
  SLUG=$(echo "$BOXEL_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  CONTAINER_NAME="boxel-synapse-${SLUG}"

  PORT_OUTPUT=$(docker port "$CONTAINER_NAME" 8008/tcp 2>/dev/null | head -1) || true
  if [ -z "$PORT_OUTPUT" ]; then
    echo "ERROR: Synapse container $CONTAINER_NAME is not running."
    echo "Start the realm server first: BOXEL_BRANCH=$BOXEL_BRANCH pnpm start:all"
    exit 1
  fi
  SYNAPSE_PORT=$(echo "$PORT_OUTPUT" | sed 's/.*://')

  export MATRIX_URL="http://localhost:${SYNAPSE_PORT}"
  export PGDATABASE="${PGDATABASE:-boxel_${SLUG}}"

  echo "Branch mode: $BOXEL_BRANCH (slug: $SLUG)"
  echo "  MATRIX_URL=$MATRIX_URL"
  echo "  PGDATABASE=$PGDATABASE"
else
  export PGDATABASE="${PGDATABASE:-boxel}"
fi

exec ts-node --transpileOnly main
