#! /bin/sh

# Start the prerender server in staging
# Expects REALM_SECRET_SEED to be set in the environment

NODE_ENV=production \
  NODE_NO_WARNINGS=1 \
  BOXEL_HOST_URL=https://realms-staging.stack.cards \
  ts-node \
  --transpileOnly prerender/prerender-server \
  --port=${PRERENDER_PORT:-4221}
