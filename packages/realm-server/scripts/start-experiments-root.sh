#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"

wait_for_postgres

MATRIX_REGISTRATION_SHARED_SECRET=$(ts-node --transpileOnly "$SCRIPTS_DIR/matrix-registration-secret.ts")
export MATRIX_REGISTRATION_SHARED_SECRET

NODE_NO_WARNINGS=1 \
  PGPORT=5435 \
  PGDATABASE=boxel_test_experiments_root \
  REALM_SECRET_SEED="shhh! it's a secret" \
  MATRIX_URL=http://localhost:8008 \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  REALM_SERVER_MATRIX_PASSWORD=password \
  ts-node \
  --transpileOnly main \
  --port=4204 \
  --matrixURL='http://localhost:8008' \
  --realmsRootPath='./realms' \
  --matrixRegistrationSecretFile='../matrix/registration_secret.txt' \
  \
  --path='../experiments-realm/' \
  --username='experiments_realm' \
  --toUrl='/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/'
