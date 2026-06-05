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
  # Re-register with Traefik: a prior dev-all's shutdown (via
  # deregisterEnvironment) deletes every `${slug}-*.yml` from the
  # Traefik dynamic dir, but the synapse container survives across
  # dev-all restarts. Without this, `https://matrix.<slug>.localhost/`
  # has no Traefik route and every login fetch fails the CORS
  # preflight with 404.
  if [ -n "$BOXEL_ENVIRONMENT" ]; then
    HOST_PORT=$(docker port "$CONTAINER_NAME" 8008/tcp 2>/dev/null | head -1 | awk -F: '{print $NF}')
    if [ -n "$HOST_PORT" ]; then
      pnpm exec ts-node --transpileOnly -e "import { registerSynapseWithTraefik } from './support/environment-config'; registerSynapseWithTraefik($HOST_PORT);"
    fi
  fi
else
  pnpm run start:synapse
fi
