#! /bin/sh
pnpm setup:base-in-deployment
pnpm setup:experiments-in-deployment
pnpm setup:catalog-in-deployment
pnpm setup:skills-in-deployment
pnpm setup:boxel-homepage-in-deployment

DEFAULT_CATALOG_REALM_URL='https://app.boxel.ai/catalog/'
CATALOG_REALM_URL="${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}"
DEFAULT_BOXEL_HOMEPAGE_REALM_URL='https://app.boxel.ai/boxel-homepage/'
BOXEL_HOMEPAGE_REALM_URL="${RESOLVED_BOXEL_HOMEPAGE_REALM_URL:-$DEFAULT_BOXEL_HOMEPAGE_REALM_URL}"

NODE_NO_WARNINGS=1 \
  LOW_CREDIT_THRESHOLD=2000 \
  MATRIX_URL=https://matrix.boxel.ai \
  BOXEL_HOST_URL=https://app.boxel.ai \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  PUBLISHED_REALM_BOXEL_SPACE_DOMAIN='boxel.space' \
  PUBLISHED_REALM_BOXEL_SITE_DOMAIN='boxel.site' \
  ts-node \
  --transpileOnly main \
  --port=3000 \
  --matrixURL='https://matrix.boxel.ai' \
  --realmsRootPath='/persistent/realms' \
  --serverURL='https://app.boxel.ai' \
  --prerendererUrl='http://boxel-prerender-manager.boxel-production-internal:4222' \
  \
  --path='/persistent/base' \
  --username='base_realm' \
  --distURL='https://boxel-host.boxel.ai' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://app.boxel.ai/base/' \
  \
  --path='/persistent/catalog' \
  --username='catalog_realm' \
  --fromUrl="${CATALOG_REALM_URL}" \
  --toUrl="${CATALOG_REALM_URL}" \
  \
  --path='/persistent/skills' \
  --username='skills_realm' \
  --fromUrl='https://app.boxel.ai/skills/' \
  --toUrl='https://app.boxel.ai/skills/' \
  \
  --path='/persistent/boxel-homepage' \
  --username='boxel_homepage_realm' \
  --fromUrl="${BOXEL_HOMEPAGE_REALM_URL}" \
  --toUrl="${BOXEL_HOMEPAGE_REALM_URL}" \
  \
  --path='/persistent/experiments' \
  --username='experiments_realm' \
  --fromUrl='https://app.boxel.ai/experiments/' \
  --toUrl='https://app.boxel.ai/experiments/'
