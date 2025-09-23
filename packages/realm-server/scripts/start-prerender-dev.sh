#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# Environment for development prerender server
NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  REALM_SECRET_SEED="shhh! it's a secret" \
  BOXEL_HOST_URL="${HOST_URL:-http://localhost:4200}" \
  ts-node \
  --transpileOnly prerender/prerender-server \
  --port=4221
