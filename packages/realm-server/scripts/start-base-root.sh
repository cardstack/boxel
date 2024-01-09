#! /bin/sh

NODE_NO_WARNINGS=1 ts-node \
  --transpileOnly main \
  --port=4203 \
  \
  --path='../base' \
  --username='base_realm' \
  --password='password' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='/'
