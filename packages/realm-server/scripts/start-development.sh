#! /bin/sh
pnpm setup:base-assets
NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  LOG_LEVELS='*=info' \
  REALM_SECRET_SEED="shhh! it's a secret" \
  PGPORT="5435" \
  PGPASSWORD="postgres" \
  ts-node \
  --transpileOnly main \
  --port=4201 \
  \
  --path='../base' \
  --matrixURL='http://localhost:8008' \
  --username='base_realm' \
  --password='password' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/' \
  \
  --path='../drafts-realm' \
  --matrixURL='http://localhost:8008' \
  --username='drafts_realm' \
  --password='password' \
  --fromUrl='http://localhost:4201/drafts/' \
  --toUrl='http://localhost:4201/drafts/' \
  \
  --path='../published-realm' \
  --matrixURL='http://localhost:8008' \
  --username='published_realm' \
  --password='password' \
  --fromUrl='http://localhost:4201/published/' \
  --toUrl='http://localhost:4201/published/'
