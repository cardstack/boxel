#! /bin/sh
pnpm setup:base-in-deployment
pnpm setup:drafts-in-deployment
pnpm setup:published-in-deployment
NODE_NO_WARNINGS=1 LOG_LEVELS='*=info' ts-node \
  --transpileOnly main \
  --port=3000 \
  \
  --path='/persistent/base' \
  --matrixURL='https://matrix.cardstack.com' \
  --username='base_realm' \
  --password=${BASE_REALM_PASSWORD} \
  --distURL='https://boxel-host.cardstack.com' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms.cardstack.com/base/' \
  \
  --path='/persistent/drafts' \
  --matrixURL='https://matrix.cardstack.com' \
  --username='drafts_realm' \
  --password=${DRAFTS_REALM_PASSWORD} \
  --fromUrl='https://realms.cardstack.com/drafts/' \
  --toUrl='https://realms.cardstack.com/drafts/' \
  \
  --path='/persistent/published' \
  --matrixURL='https://matrix.cardstack.com' \
  --username='published_realm' \
  --password=${PUBLISHED_REALM_PASSWORD} \
  --fromUrl='https://realms.cardstack.com/published/' \
  --toUrl='https://realms.cardstack.com/published/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms.cardstack.com/base/' \
  --fromUrl='https://realms.cardstack.com/base/' \
  --toUrl='https://realms.cardstack.com/base/'
