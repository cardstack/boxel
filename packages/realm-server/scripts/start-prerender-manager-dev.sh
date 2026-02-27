#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/ensure-traefik.sh"

ensure_traefik

# Start the prerender manager in development
# Ports default to 4222 unless PRERENDER_MANAGER_PORT is provided

# Branch-mode configuration
if [ -n "$BOXEL_BRANCH" ]; then
  DEFAULT_PRERENDER_MGR_PORT=0
else
  DEFAULT_PRERENDER_MGR_PORT=4222
fi

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  PRERENDER_MANAGER_VERBOSE_LOGS=false \
  ts-node \
  --transpileOnly prerender/manager-server \
  --port=${PRERENDER_MANAGER_PORT:-$DEFAULT_PRERENDER_MGR_PORT} \
  --exit-on-signal
