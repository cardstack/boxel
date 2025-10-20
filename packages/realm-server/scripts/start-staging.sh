#! /bin/sh
pnpm setup:base-in-deployment
pnpm setup:experiments-in-deployment
pnpm setup:catalog-in-deployment
pnpm setup:skills-in-deployment

DEFAULT_CATALOG_REALM_URL='https://realms-staging.stack.cards/catalog/'
CATALOG_REALM_URL="${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}"

NODE_NO_WARNINGS=1 \
  MATRIX_URL=https://matrix-staging.stack.cards \
  BOXEL_HOST_URL=https://realms-staging.stack.cards \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  PUBLISHED_REALM_BOXEL_SPACE_DOMAIN='staging.boxel.dev' \
  PUBLISHED_REALM_BOXEL_SITE_DOMAIN='staging.boxel.build' \
  ts-node \
  --transpileOnly main \
  --port=3000 \
  --matrixURL='https://matrix-staging.stack.cards' \
  --realmsRootPath='/persistent/realms' \
  --serverURL='https://realms-staging.stack.cards' \
  \
  --path='/persistent/base' \
  --username='base_realm' \
  --distURL='https://boxel-host-staging.stack.cards' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms-staging.stack.cards/base/' \
  \
  --path='/persistent/catalog' \
  --username='catalog_realm' \
  --fromUrl="${CATALOG_REALM_URL}" \
  --toUrl="${CATALOG_REALM_URL}" \
  \
  --path='/persistent/skills' \
  --username='skills_realm' \
  --fromUrl='https://realms-staging.stack.cards/skills/' \
  --toUrl='https://realms-staging.stack.cards/skills/' \
  \
  --path='/persistent/experiments' \
  --username='experiments_realm' \
  --fromUrl='https://realms-staging.stack.cards/experiments/' \
  --toUrl='https://realms-staging.stack.cards/experiments/'
