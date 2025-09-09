#! /bin/sh
pnpm setup:base-in-deployment
pnpm setup:experiments-in-deployment
pnpm setup:catalog-in-deployment
pnpm setup:skills-in-deployment
NODE_NO_WARNINGS=1 \
  MATRIX_URL=https://matrix.boxel.ai \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  VALID_PUBLISHED_REALM_DOMAINS='boxel.site,boxel.space' \
  ts-node \
  --transpileOnly main \
  --port=3000 \
  --matrixURL='https://matrix.boxel.ai' \
  --realmsRootPath='/persistent/realms' \
  --serverURL='https://app.boxel.ai' \
  \
  --path='/persistent/base' \
  --username='base_realm' \
  --distURL='https://boxel-host.boxel.ai' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://app.boxel.ai/base/' \
  \
  --path='/persistent/catalog' \
  --username='catalog_realm' \
  --fromUrl='https://app.boxel.ai/catalog/' \
  --toUrl='https://app.boxel.ai/catalog/' \
  \
  --path='/persistent/skills' \
  --username='skills_realm' \
  --fromUrl='https://app.boxel.ai/skills/' \
  --toUrl='https://app.boxel.ai/skills/' \
  \
  --path='/persistent/experiments' \
  --username='experiments_realm' \
  --fromUrl='https://app.boxel.ai/experiments/' \
  --toUrl='https://app.boxel.ai/experiments/'

