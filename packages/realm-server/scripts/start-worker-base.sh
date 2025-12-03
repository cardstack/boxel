#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"
. "$SCRIPTS_DIR/wait-for-prerender.sh"

wait_for_postgres
PRERENDER_URL="${PRERENDER_URL:-http://localhost:4222}"
wait_for_prerender "$PRERENDER_URL"

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
  PGPORT=5435 \
  PGDATABASE=boxel_base \
  REALM_SECRET_SEED="shhh! it's a secret" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ts-node \
  --transpileOnly worker-manager \
  --port=4213 \
  --matrixURL='http://localhost:8008' \
  --distURL="${HOST_URL:-http://localhost:4200}" \
  --prerendererUrl="${PRERENDER_URL}" \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/'
