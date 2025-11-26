#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"

wait_for_postgres

if [ -z "$MATRIX_REGISTRATION_SHARED_SECRET" ]; then
  MATRIX_REGISTRATION_SHARED_SECRET=$(ts-node --transpileOnly "$SCRIPTS_DIR/matrix-registration-secret.ts")
  export MATRIX_REGISTRATION_SHARED_SECRET
fi

PRERENDER_URL="${PRERENDER_URL:-http://localhost:4221}"

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  PGPORT=5435 \
  PGDATABASE=boxel_base \
  REALM_SERVER_SECRET_SEED="mum's the word" \
  REALM_SECRET_SEED="shhh! it's a secret" \
  GRAFANA_SECRET="shhh! it's a secret" \
  MATRIX_URL=http://localhost:8008 \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ts-node \
  --transpileOnly main \
  --port=4201 \
  --matrixURL='http://localhost:8008' \
  --realmsRootPath='./realms/localhost_4201_base' \
  --prerendererUrl="${PRERENDER_URL}" \
  --migrateDB \
  $1 \
  \
  --path='../base' \
  --username='base_realm' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/'
