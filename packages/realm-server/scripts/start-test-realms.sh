#! /bin/sh
check_postgres_ready() {
  docker exec boxel-pg pg_isready -U postgres >/dev/null 2>&1
}
# remove this check after the feature flag is removed
if [ -n "$PG_INDEXER" ]; then
  while ! check_postgres_ready; do
    printf '.'
    sleep 1
  done
fi

NODE_ENV=test \
  PGPORT=5435 \
  PGDATABASE=boxel_test \
  NODE_NO_WARNINGS=1 \
  REALM_SECRET_SEED="shhh! it's a secret" \
  PGPORT="5435" \
  ts-node \
  --transpileOnly main \
  --port=4202 \
  \
  --path='./tests/cards' \
  --matrixURL='http://localhost:8008' \
  --username='node-test_realm' \
  --password='password' \
  --fromUrl='/node-test/' \
  --toUrl='/node-test/' \
  \
  --path='../host/tests/cards' \
  --matrixURL='http://localhost:8008' \
  --username='test_realm' \
  --password='password' \
  --fromUrl='/test/' \
  --toUrl='/test/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/' \
  \
  --useTestingDomain
