#! /bin/sh
pnpm setup:base-assets
NODE_NO_WARNINGS=1 LOG_LEVELS='*=info' ts-node \
  --transpileOnly main \
  --port=4201 \
  \
  --path='../base' \
  --username='base_realm' \
  --password='password' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/' \
  \
  --path='../drafts-realm' \
  --username='drafts_realm' \
  --password='password' \
  --fromUrl='http://localhost:4201/drafts/' \
  --toUrl='http://localhost:4201/drafts/' \
  \
  --path='../published-realm' \
  --username='published_realm' \
  --password='password' \
  --fromUrl='http://localhost:4201/published/' \
  --toUrl='http://localhost:4201/published/'
