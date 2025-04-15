#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"

wait_for_postgres

if [ -z "$MATRIX_REGISTRATION_SHARED_SECRET" ]; then
  MATRIX_REGISTRATION_SHARED_SECRET=$(ts-node --transpileOnly "$SCRIPTS_DIR/matrix-registration-secret.ts")
  export MATRIX_REGISTRATION_SHARED_SECRET
fi

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  PGPORT=5435 \
  PGDATABASE=boxel \
  LOG_LEVELS='*=info' \
  REALM_SERVER_SECRET_SEED="mum's the word" \
  REALM_SECRET_SEED="shhh! it's a secret" \
  MATRIX_URL=http://localhost:8008 \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ENABLE_FILE_WATCHER=true \
  ts-node \
  --transpileOnly main \
  --port=4201 \
  --matrixURL='http://localhost:8008' \
  --realmsRootPath='./realms/localhost_4201' \
  --seedPath='../seed-realm' \
  --seedRealmURL='http://localhost:4201/seed/' \
  --migrateDB \
  $1 \
  \
  --path='../base' \
  --username='base_realm' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/' \
  \
  --path='../experiments-realm' \
  --username='experiments_realm' \
  --fromUrl='http://localhost:4201/experiments/' \
  --toUrl='http://localhost:4201/experiments/' \
  \
  --path='../seed-realm' \
  --username='seed_realm' \
  --fromUrl='http://localhost:4201/seed/' \
  --toUrl='http://localhost:4201/seed/' \
  \
  --path='../catalog-realm-dev' \
  --username='catalog_realm' \
  --fromUrl='http://localhost:4201/catalog/' \
  --toUrl='http://localhost:4201/catalog/'
