#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"
. "$SCRIPTS_DIR/wait-for-prerender.sh"

wait_for_postgres
PRERENDER_URL="${PRERENDER_URL:-http://localhost:4222}"
wait_for_prerender "$PRERENDER_URL"

NODE_ENV=test \
  PGPORT=5435 \
  PGDATABASE=boxel_test \
  NODE_NO_WARNINGS=1 \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
  REALM_SECRET_SEED="shhh! it's a secret" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ts-node \
  --transpileOnly worker-manager \
  --port=4211 \
  --matrixURL='http://localhost:8008' \
  --distURL="${HOST_URL:-http://localhost:4200}" \
  --prerendererUrl="${PRERENDER_URL}" \
  \
  --fromUrl='http://localhost:4202/node-test/' \
  --toUrl='http://localhost:4202/node-test/' \
  \
  --fromUrl='http://localhost:4202/test/' \
  --toUrl='http://localhost:4202/test/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/' \
  --fromUrl='http://localhost:4201/skills/' \
  --toUrl='http://localhost:4201/skills/'
