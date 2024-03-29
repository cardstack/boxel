#! /bin/sh

pnpm run setup:base-assets

NODE_ENV=development NODE_NO_WARNINGS=1 REALM_SECRET_SEED="shhh! it's a secret" ts-node \
  --transpileOnly main \
  --port=4201 \
  \
  --path='../base' \
  --matrixURL='http://localhost:8008' \
  --username='base_realm' \
  --password='password' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='/base/'
