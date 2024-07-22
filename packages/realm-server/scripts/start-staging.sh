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
  --toUrl='https://app.boxel.ai/base/' \
  \
  --path='/persistent/drafts' \
  --matrixURL='https://matrix-staging.boxel.ai' \
  --username='drafts_realm' \
  --password=${DRAFTS_REALM_PASSWORD} \
  --fromUrl='https://app.boxel.ai/drafts/' \
  --toUrl='https://app.boxel.ai/drafts/' \
  \
  --path='/persistent/published' \
  --matrixURL='https://matrix-staging.boxel.ai' \
  --username='published_realm' \
  --password=${PUBLISHED_REALM_PASSWORD} \
  --fromUrl='https://app.boxel.ai/published/' \
  --toUrl='https://app.boxel.ai/published/' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://app.boxel.ai/base/' \
  --fromUrl='https://app.stack.card/base/' \
  --toUrl='https://app.boxel.ai/base/'
