#! /bin/sh
pnpm setup:base-in-deployment
pnpm setup:experiments-in-deployment
pnpm setup:seed-in-deployment
pnpm setup:catalog-in-deployment
NODE_NO_WARNINGS=1 \
  LOG_LEVELS='*=info' \
  MATRIX_URL=https://matrix.boxel.ai \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ts-node \
  --transpileOnly main \
  --port=3000 \
  --matrixURL='https://matrix.boxel.ai' \
  --realmsRootPath='/persistent/realms' \
  --serverURL='https://app.boxel.ai' \
  --seedPath='/persistent/seed' \
  \
  --path='/persistent/base' \
  --username='base_realm' \
  --distURL='https://boxel-host.boxel.ai' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://app.boxel.ai/base/' \
  \
  --path='/persistent/experiments' \
  --username='experiments_realm' \
  --fromUrl='https://app.boxel.ai/experiments/' \
  --toUrl='https://app.boxel.ai/experiments/' \
  \
  --path='/persistent/seed' \
  --username='seed_realm' \
  --fromUrl='https://app.boxel.ai/seed/' \
  --toUrl='https://app.boxel.ai/seed/' \
  \
  --path='/persistent/catalog' \
  --username='catalog_realm' \
  --fromUrl='https://app.boxel.ai/catalog/' \
  --toUrl='https://app.boxel.ai/catalog/'
