#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"

wait_for_postgres

MATRIX_REGISTRATION_SHARED_SECRET=$(ts-node --transpileOnly "$SCRIPTS_DIR/matrix-registration-secret.ts")
export MATRIX_REGISTRATION_SHARED_SECRET

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  PGPORT=5435 \
  PGDATABASE=boxel \
  LOG_LEVELS='*=info' \
  REALM_SECRET_SEED="shhh! it's a secret" \
  MATRIX_URL=http://localhost:8008 \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  EXCLUDED_PUBLIC_REALMS='http://localhost:4201/seed/,https://cardstack.com/base/,http://localhost:4202/test/,http://localhost:4202/node-test/,http://localhost:4203/,http://localhost:4204/,http://localhost:4205/test/' \
  ts-node \
  --transpileOnly main \
  --port=4201 \
  --matrixURL='http://localhost:8008' \
  --realmsRootPath='./realms' \
  --matrixRegistrationSecretFile='../matrix/registration_secret.txt' \
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
  --path='../catalog-realm' \
  --username='catalog_realm' \
  --fromUrl='http://localhost:4201/catalog/' \
  --toUrl='http://localhost:4201/catalog/'
