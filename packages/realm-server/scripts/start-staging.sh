#! /bin/sh
pnpm setup:base-in-deployment
pnpm setup:experiments-in-deployment
pnpm setup:seed-in-deployment
pnpm setup:catalog-in-deployment
NODE_NO_WARNINGS=1 \
  LOG_LEVELS='perf=debug' \
  MATRIX_URL=https://matrix-staging.stack.cards \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  EXCLUDED_PUBLIC_REALMS='https://realms-staging.stack.cards/experiments/,https://realms-staging.stack.cards/seed/,https://cardstack.com/base/' \
  ts-node \
  --transpileOnly main \
  --port=3000 \
  --matrixURL='https://matrix-staging.stack.cards' \
  --realmsRootPath='/persistent/realms' \
  --serverURL='https://realms-staging.stack.cards' \
  --seedPath='/persistent/seed' \
  \
  --path='/persistent/base' \
  --username='base_realm' \
  --distURL='https://boxel-host-staging.stack.cards' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms-staging.stack.cards/base/' \
  \
  --path='/persistent/experiments' \
  --username='experiments_realm' \
  --fromUrl='https://realms-staging.stack.cards/experiments/' \
  --toUrl='https://realms-staging.stack.cards/experiments/' \
  \
  --path='/persistent/seed' \
  --username='seed_realm' \
  --fromUrl='https://realms-staging.stack.cards/seed/' \
  --toUrl='https://realms-staging.stack.cards/seed/' \
  \
  --path='/persistent/catalog' \
  --username='catalog_realm' \
  --fromUrl='https://realms-staging.stack.cards/catalog/' \
  --toUrl='https://realms-staging.stack.cards/catalog/'
