#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# Start the prerender manager in development
# Ports default to 4222 unless PRERENDER_MANAGER_PORT is provided

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  ts-node \
  --transpileOnly prerender/manager-server \
  --port=${PRERENDER_MANAGER_PORT:-4222}
