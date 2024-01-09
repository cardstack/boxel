#! /bin/sh

NODE_NO_WARNINGS=1 ts-node \
  --transpileOnly main \
  --port=4202 \
  \
  --path='./tests/cards' \
  --username='node-test_realm' \
  --password='password' \
  --fromUrl='/node-test/' \
  --toUrl='/node-test/' \
  \
  --path='../host/tests/cards' \
  --username='test_realm' \
  --password='password' \
  --fromUrl='/test/' \
  --toUrl='/test/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/' \
  \
  --useTestingDomain
