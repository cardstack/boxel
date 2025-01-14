#! /bin/sh

NODE_NO_WARNINGS=1 \
  ts-node \
  --transpileOnly worker-manager \
  --count="${WORKER_COUNT:-1}" \
  --matrixURL='https://matrix.boxel.ai' \
  --distURL='https://boxel-host.boxel.ai' \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://app.boxel.ai/base/' \
  \
  --fromUrl='https://app.boxel.ai/experiments/' \
  --toUrl='https://app.boxel.ai/experiments/' \
  \
  --fromUrl='https://app.boxel.ai/seed/' \
  --toUrl='https://app.boxel.ai/seed/' \
  \
  --fromUrl='https://app.boxel.ai/catalog/' \
  --toUrl='https://app.boxel.ai/catalog/'
