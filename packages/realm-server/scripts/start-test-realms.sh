#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"

wait_for_postgres
PRERENDER_URL="${PRERENDER_URL:-http://localhost:4221}"

pnpm --dir=../skills-realm skills:setup

if [ -z "$MATRIX_REGISTRATION_SHARED_SECRET" ]; then
  MATRIX_REGISTRATION_SHARED_SECRET=$(ts-node --transpileOnly "$SCRIPTS_DIR/matrix-registration-secret.ts")
  export MATRIX_REGISTRATION_SHARED_SECRET
fi

NODE_ENV=test \
  PGPORT=5435 \
  PGDATABASE=boxel_test \
  NODE_NO_WARNINGS=1 \
  REALM_SERVER_SECRET_SEED="mum's the word" \
  REALM_SECRET_SEED="shhh! it's a secret" \
  GRAFANA_SECRET="shhh! it's a secret" \
  MATRIX_URL=http://localhost:8008 \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ts-node \
  --transpileOnly main \
  --port=4202 \
  --matrixURL='http://localhost:8008' \
  --realmsRootPath='./realms/localhost_4202' \
  --matrixRegistrationSecretFile='../matrix/registration_secret.txt' \
  --migrateDB \
  --prerendererUrl="${PRERENDER_URL}" \
  $1 \
  \
  --path='./tests/cards' \
  --username='node-test_realm' \
  --fromUrl='http://localhost:4202/node-test/' \
  --toUrl='http://localhost:4202/node-test/' \
  \
  --path='../host/tests/cards' \
  --username='test_realm' \
  --fromUrl='http://localhost:4202/test/' \
  --toUrl='http://localhost:4202/test/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/'
