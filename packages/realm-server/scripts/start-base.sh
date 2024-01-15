#! /bin/sh

pnpm run setup:base-assets

NODE_NO_WARNINGS=1 REALM_SECRET_SEED="shhh! it's a secret" REALM_USER_PERMISSIONS="{}" ts-node \
  --transpileOnly main \
  --port=4201 \
  \
  --path='../base' \
  --matrixURL='http://localhost:8008' \
  --username='base_realm' \
  --password='password' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='/base/'
