#! /bin/sh
pnpm setup:base-in-deployment
pnpm setup:drafts-in-deployment
pnpm setup:published-in-deployment
NODE_NO_WARNINGS=1 \
  LOG_LEVELS='*=info' \
  ts-node \
  --transpileOnly main \
  --port=3000 \
  \
  --path='/persistent/base' \
  --matrixURL='https://matrix.boxel.ai' \
  --username='base_realm' \
  --password=${BASE_REALM_PASSWORD} \
  --distURL='https://boxel-host.boxel.ai' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms.boxel.ai/base/' \
  \
  --path='/persistent/drafts' \
  --matrixURL='https://matrix.boxel.ai' \
  --username='drafts_realm' \
  --password=${DRAFTS_REALM_PASSWORD} \
  --fromUrl='https://realms.boxel.ai/drafts/' \
  --toUrl='https://realms.boxel.ai/drafts/' \
  \
  --path='/persistent/published' \
  --matrixURL='https://matrix.boxel.ai' \
  --username='published_realm' \
  --password=${PUBLISHED_REALM_PASSWORD} \
  --fromUrl='https://realms.boxel.ai/published/' \
  --toUrl='https://realms.boxel.ai/published/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms.boxel.ai/base/' \
  --fromUrl='https://realms.boxel.ai/base/' \
  --toUrl='https://realms.boxel.ai/base/'
