#! /bin/sh
pnpm setup:base-in-deployment
pnpm setup:drafts-in-deployment
pnpm setup:published-in-deployment
NODE_NO_WARNINGS=1 LOG_LEVELS='*=info' ts-node \
  --transpileOnly main \
  --port=3000 \
  \
  --path='/persistent/base' \
  --username=${BASE_REALM_USERNAME} \
  --password=${BASE_REALM_PASSWORD} \
  --distURL='https://boxel-host.cardstack.com' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms.cardstack.com/base/' \
  \
  --path='/persistent/drafts' \
  --username=${DRAFTS_REALM_USERNAME} \
  --password=${DRAFTS_REALM_PASSWORD} \
  --fromUrl='https://realms.cardstack.com/drafts/' \
  --toUrl='https://realms.cardstack.com/drafts/' \
  \
  --path='/persistent/published' \
  --username=${PUBLISHED_REALM_USERNAME} \
  --password=${PUBLISHED_REALM_PASSWORD} \
  --fromUrl='https://realms.cardstack.com/published/' \
  --toUrl='https://realms.cardstack.com/published/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms.cardstack.com/base/' \
  --fromUrl='https://realms.cardstack.com/base/' \
  --toUrl='https://realms.cardstack.com/base/'
