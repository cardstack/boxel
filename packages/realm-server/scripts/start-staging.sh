#! /bin/sh
pnpm setup:base-in-deployment
pnpm setup:drafts-in-deployment
pnpm setup:published-in-deployment
NODE_NO_WARNINGS=1 LOG_LEVELS='*=info' REALM_USER_PERMISSIONS="{}" ts-node \
  --transpileOnly main \
  --port=3000 \
  \
  --path='/persistent/base' \
  --matrixURL=${MATRIX_URL} \
  --username='base_realm' \
  --password=${BASE_REALM_PASSWORD} \
  --distURL='https://boxel-host-staging.stack.cards' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms-staging.stack.cards/base/' \
  \
  --path='/persistent/drafts' \
  --matrixURL=${MATRIX_URL} \
  --username='drafts_realm' \
  --password=${DRAFTS_REALM_PASSWORD} \
  --fromUrl='https://realms-staging.stack.cards/drafts/' \
  --toUrl='https://realms-staging.stack.cards/drafts/' \
  \
  --path='/persistent/published' \
  --matrixURL=${MATRIX_URL} \
  --username='published_realm' \
  --password=${PUBLISHED_REALM_PASSWORD} \
  --fromUrl='https://realms-staging.stack.cards/published/' \
  --toUrl='https://realms-staging.stack.cards/published/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms-staging.stack.cards/base/' \
  --fromUrl='https://realms-staging.stack.card/base/' \
  --toUrl='https://realms-staging.stack.cards/base/'
