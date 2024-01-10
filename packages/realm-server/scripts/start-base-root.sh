#! /bin/sh

NODE_NO_WARNINGS=1 ts-node \
  --transpileOnly main \
  --port=4203 \
  \
  --path='../base' \
  --matrixURL='http://localhost:8008' \
  --username='base_realm' \
  --password='password' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='/'
