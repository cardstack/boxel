#! /bin/sh

NODE_NO_WARNINGS=1 \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ts-node \
  --transpileOnly worker-manager \
  --allPriorityCount="${WORKER_ALL_PRIORITY_COUNT:-1}" \
  --highPriorityCount="${WORKER_HIGH_PRIORITY_COUNT:-0}" \
  --matrixURL='https://matrix.boxel.ai' \
  --distURL='https://boxel-host.boxel.ai' \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://app.boxel.ai/base/' \
  \
  --fromUrl='https://app.boxel.ai/experiments/' \
  --toUrl='https://app.boxel.ai/experiments/' \
  \
  --fromUrl='https://app.boxel.ai/catalog/' \
  --toUrl='https://app.boxel.ai/catalog/' \
  \
  --fromUrl='https://app.boxel.ai/skills/' \
  --toUrl='https://app.boxel.ai/skills/'
