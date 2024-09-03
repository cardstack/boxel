#! /bin/sh
pnpm setup:base-in-deployment
pnpm setup:experiments-in-deployment
NODE_NO_WARNINGS=1 \
  LOG_LEVELS='perf=debug' \
  MATRIX_URL=https://matrix-staging.stack.cards \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ts-node \
  --transpileOnly main \
  --port=3000 \
  \
  --path='/persistent/base' \
  --matrixURL='https://matrix-staging.stack.cards' \
  --username='base_realm' \
  --password=${BASE_REALM_PASSWORD} \
  --distURL='https://boxel-host-staging.stack.cards' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms-staging.stack.cards/base/' \
  \
  --path='/persistent/experiments' \
  --matrixURL='https://matrix-staging.stack.cards' \
  --username='experiments_realm' \
  --password=${EXPERIMENTS_REALM_PASSWORD} \
  --fromUrl='https://realms-staging.stack.cards/experiments/' \
  --toUrl='https://realms-staging.stack.cards/experiments/' \
