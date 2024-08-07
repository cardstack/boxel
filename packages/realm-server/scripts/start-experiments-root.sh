#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"

wait_for_postgres

NODE_NO_WARNINGS=1 \
  PGPORT=5435 \
  PGDATABASE=boxel_test_experiments_root \
  REALM_SECRET_SEED="shhh! it's a secret" \
  REALM_SERVER_SECRET_SEED="shhh! it's a secret" \
  MATRIX_URL=http://localhost:8008 \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  REALM_SERVER_MATRIX_PASSWORD=password \
  ts-node \
  --transpileOnly main \
  --port=4204 \
  \
  --path='../experiments-realm/' \
  --matrixURL='http://localhost:8008' \
  --username='experiments_realm' \
  --password='password' \
  --toUrl='/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/'
