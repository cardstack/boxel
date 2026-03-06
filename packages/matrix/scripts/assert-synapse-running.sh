#!/bin/sh
# Check if the correct Synapse container is running (environment-aware).
# If not running, start it.

if [ -n "$BOXEL_ENVIRONMENT" ]; then
  SLUG=$(echo "$BOXEL_ENVIRONMENT" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
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
