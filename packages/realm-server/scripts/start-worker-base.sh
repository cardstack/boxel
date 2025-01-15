#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"

wait_for_postgres

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  PGPORT=5435 \
  PGDATABASE=boxel_base \
  REALM_SECRET_SEED="shhh! it's a secret" \
  ts-node \
  --transpileOnly worker-manager \
  --port=4213 \
  --matrixURL='http://localhost:8008' \
  --distURL="${HOST_URL:-http://localhost:4200}" \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/'
