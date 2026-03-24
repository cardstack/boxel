#!/bin/sh
# Check if the correct Synapse container is running (environment-aware).
# If not running, start it.

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/../../../scripts/env-slug.sh"

if [ -n "$BOXEL_ENVIRONMENT" ]; then
  SLUG=$(resolve_env_slug)
  CONTAINER_NAME="boxel-synapse-${SLUG}"
else
  CONTAINER_NAME="boxel-synapse"
fi

RUNNING=$(docker ps -f "name=^${CONTAINER_NAME}$" --format '{{.Names}}')

if [ "$RUNNING" = "$CONTAINER_NAME" ]; then
  echo "synapse is already running (${CONTAINER_NAME})"
else
  pnpm run start:synapse
fi
