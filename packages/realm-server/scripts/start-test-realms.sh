#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"

wait_for_postgres

MATRIX_REGISTRATION_SHARED_SECRET=$(ts-node --transpileOnly "$SCRIPTS_DIR/matrix-registration-secret.ts")
export MATRIX_REGISTRATION_SHARED_SECRET

NODE_ENV=test \
  PGPORT=5435 \
  PGDATABASE=boxel_test \
  NODE_NO_WARNINGS=1 \
  REALM_SECRET_SEED="shhh! it's a secret" \
  MATRIX_URL=http://localhost:8008 \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  EXCLUDED_PUBLIC_REALMS='http://localhost:4201/experiments/,http://localhost:4201/seed/,https://cardstack.com/base/,http://localhost:4203/,http://localhost:4204/' \
  ts-node \
  --transpileOnly main \
  --port=4202 \
  --matrixURL='http://localhost:8008' \
  --realmsRootPath='./realms' \
  --matrixRegistrationSecretFile='../matrix/registration_secret.txt' \
  \
  --path='./tests/cards' \
  --username='node-test_realm' \
  --fromUrl='/node-test/' \
  --toUrl='/node-test/' \
  \
  --path='../host/tests/cards' \
  --username='test_realm' \
  --fromUrl='/test/' \
  --toUrl='/test/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/'
