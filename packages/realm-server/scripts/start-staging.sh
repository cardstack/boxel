#! /bin/sh
pnpm setup:base-in-deployment
pnpm setup:drafts-in-deployment
pnpm setup:published-in-deployment
NODE_NO_WARNINGS=1 \
  LOG_LEVELS='perf=debug' \
  ts-node \
  --transpileOnly main \
  --port=3000 \
  \
  --path='/persistent/base' \
  --matrixURL='https://matrix-staging.boxel.ai' \
  --username='base_realm' \
  --password=${BASE_REALM_PASSWORD} \
  --distURL='https://boxel-host-staging.boxel.ai' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms-staging.boxel.ai/base/' \
  \
  --path='/persistent/drafts' \
  --matrixURL='https://matrix-staging.boxel.ai' \
  --username='drafts_realm' \
  --password=${DRAFTS_REALM_PASSWORD} \
  --fromUrl='https://realms-staging.boxel.ai/drafts/' \
  --toUrl='https://realms-staging.boxel.ai/drafts/' \
  \
  --path='/persistent/published' \
  --matrixURL='https://matrix-staging.boxel.ai' \
  --username='published_realm' \
  --password=${PUBLISHED_REALM_PASSWORD} \
  --fromUrl='https://realms-staging.boxel.ai/published/' \
  --toUrl='https://realms-staging.boxel.ai/published/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms-staging.boxel.ai/base/' \
  --fromUrl='https://realms-staging.stack.card/base/' \
  --toUrl='https://realms-staging.boxel.ai/base/'
