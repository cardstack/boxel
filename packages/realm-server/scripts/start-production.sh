#! /bin/sh
pnpm setup:base-in-deployment
pnpm setup:experiments-in-deployment
NODE_NO_WARNINGS=1 \
  LOG_LEVELS='*=info' \
  MATRIX_URL=https://matrix.boxel.ai \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ts-node \
  --transpileOnly main \
  --port=3000 \
  --matrixURL='https://matrix.boxel.ai' \
  \
  --path='/persistent/base' \
  --username='base_realm' \
  --password=${BASE_REALM_PASSWORD} \
  --distURL='https://boxel-host.boxel.ai' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://app.boxel.ai/base/' \
  \
  --path='/persistent/experiments' \
  --username='experiments_realm' \
  --password=${EXPERIMENTS_REALM_PASSWORD} \
  --fromUrl='https://app.boxel.ai/experiments/' \
  --toUrl='https://app.boxel.ai/experiments/'
