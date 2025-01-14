#! /bin/sh

NODE_NO_WARNINGS=1 \
  ts-node \
  --transpileOnly worker-manager \
  --count="${WORKER_COUNT:-1}" \
  --matrixURL='https://matrix-staging.stack.cards' \
  --distURL='https://boxel-host-staging.stack.cards' \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms-staging.stack.cards/base/' \
  \
  --fromUrl='https://realms-staging.stack.cards/experiments/' \
  --toUrl='https://realms-staging.stack.cards/experiments/' \
  \
  --fromUrl='https://realms-staging.stack.cards/seed/' \
  --toUrl='https://realms-staging.stack.cards/seed/' \
  \
  --fromUrl='https://realms-staging.stack.cards/catalog/' \
  --toUrl='https://realms-staging.stack.cards/catalog/'
