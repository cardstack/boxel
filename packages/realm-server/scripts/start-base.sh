#! /bin/sh

pnpm run setup:base-assets

NODE_NO_WARNINGS=1 ts-node \
  --transpileOnly main \
  --port=4201 \
  \
  --path='../base' \
  --username='base_realm' \
  --password='password' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='/base/'
