#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"

wait_for_postgres

NODE_ENV=test \
  PGPORT=5435 \
  PGDATABASE=boxel_test \
  NODE_NO_WARNINGS=1 \
  REALM_SECRET_SEED="shhh! it's a secret" \
  ts-node \
  --transpileOnly worker-manager \
  --port=4211 \
  --matrixURL='http://localhost:8008' \
  --distURL="${HOST_URL:-http://localhost:4200}" \
  \
  --fromUrl='http://localhost:4202/node-test/' \
  --toUrl='http://localhost:4202/node-test/' \
  \
  --fromUrl='http://localhost:4202/test/' \
  --toUrl='http://localhost:4202/test/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/'
