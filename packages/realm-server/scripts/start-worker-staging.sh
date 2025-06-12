#! /bin/sh

NODE_NO_WARNINGS=1 \
  ts-node \
  --transpileOnly worker-manager \
  --allPriorityCount="${WORKER_ALL_PRIORITY_COUNT:-1}" \
  --highPriorityCount="${WORKER_HIGH_PRIORITY_COUNT:-0}" \
  --matrixURL='https://matrix-staging.stack.cards' \
  --distURL='https://boxel-host-staging.stack.cards' \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms-staging.stack.cards/base/' \
  \
  --fromUrl='https://realms-staging.stack.cards/experiments/' \
  --toUrl='https://realms-staging.stack.cards/experiments/' \
  \
  --fromUrl='https://realms-staging.stack.cards/catalog/' \
  --toUrl='https://realms-staging.stack.cards/catalog/'
