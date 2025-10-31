#! /bin/sh

# Start the prerender manager in staging

NODE_ENV=production \
  NODE_NO_WARNINGS=1 \
  ts-node \
  --transpileOnly prerender/manager-server \
  --port=${PRERENDER_MANAGER_PORT:-4222}
