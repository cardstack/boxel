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

NODE_NO_WARNINGS=1 \
  PGPORT=5435 \
  PGDATABASE=boxel_test_drafts_root \
  REALM_SECRET_SEED="shhh! it's a secret" \
  ts-node \
  --transpileOnly main \
  --port=4204 \
  \
  --path='../drafts-realm/' \
  --matrixURL='http://localhost:8008' \
  --username='drafts_realm' \
  --password='password' \
  --toUrl='/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/'
