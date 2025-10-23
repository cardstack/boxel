#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"

wait_for_postgres

pnpm --dir=../skills-realm skills:setup

if [ -z "$MATRIX_REGISTRATION_SHARED_SECRET" ]; then
  MATRIX_REGISTRATION_SHARED_SECRET=$(ts-node --transpileOnly "$SCRIPTS_DIR/matrix-registration-secret.ts")
  export MATRIX_REGISTRATION_SHARED_SECRET
fi

START_EXPERIMENTS=$(if [ -z "$SKIP_EXPERIMENTS" ]; then echo "true"; else echo ""; fi)

DEFAULT_CATALOG_REALM_URL='http://localhost:4201/catalog/'
CATALOG_REALM_URL="${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}"

NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  PGPORT=5435 \
  PGDATABASE=boxel \
  LOG_LEVELS='*=info' \
  REALM_SERVER_SECRET_SEED="mum's the word" \
  REALM_SECRET_SEED="shhh! it's a secret" \
  GRAFANA_SECRET="shhh! it's a secret" \
  MATRIX_URL=http://localhost:8008 \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ENABLE_FILE_WATCHER=true \
  ts-node \
  --transpileOnly main \
  --port=4201 \
  --matrixURL='http://localhost:8008' \
  --realmsRootPath='./realms/localhost_4201' \
  --migrateDB \
  $1 \
  \
  --path='../base' \
  --username='base_realm' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/' \
  \
  --path='../catalog-realm' \
  --username='catalog_realm' \
  --fromUrl="${CATALOG_REALM_URL}" \
  --toUrl="${CATALOG_REALM_URL}" \
  \
  --path='../skills-realm/contents' \
  --username='skills_realm' \
  --fromUrl='http://localhost:4201/skills/' \
  --toUrl='http://localhost:4201/skills/' \
  \
  ${START_EXPERIMENTS:+--path='../experiments-realm'} \
  ${START_EXPERIMENTS:+--username='experiments_realm'} \
  ${START_EXPERIMENTS:+--fromUrl='http://localhost:4201/experiments/'} \
  ${START_EXPERIMENTS:+--toUrl='http://localhost:4201/experiments/'}
