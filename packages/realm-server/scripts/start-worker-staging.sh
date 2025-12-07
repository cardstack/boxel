#! /bin/sh

DEFAULT_CATALOG_REALM_URL='https://realms-staging.stack.cards/catalog/'
CATALOG_REALM_URL="${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}"

NODE_NO_WARNINGS=1 \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ts-node \
  --transpileOnly worker-manager \
  --allPriorityCount="${WORKER_ALL_PRIORITY_COUNT:-1}" \
  --highPriorityCount="${WORKER_HIGH_PRIORITY_COUNT:-0}" \
  --prerendererUrl='http://boxel-prerender-manager.boxel-staging-internal:4222' \
  --matrixURL='https://matrix-staging.stack.cards' \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms-staging.stack.cards/base/' \
  \
  --fromUrl='https://realms-staging.stack.cards/experiments/' \
  --toUrl='https://realms-staging.stack.cards/experiments/' \
  \
  --fromUrl="${CATALOG_REALM_URL}" \
  --toUrl="${CATALOG_REALM_URL}" \
  \
  --fromUrl='https://realms-staging.stack.cards/skills/' \
  --toUrl='https://realms-staging.stack.cards/skills/' \
  
