#! /bin/sh

NODE_NO_WARNINGS=1 \
  ts-node \
  --transpileOnly worker-manager \
  --port=4210 \
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
  --fromUrl='https://app.boxel.ai/seed/' \
  --toUrl='https://app.boxel.ai/seed/' \
  \
  --fromUrl='https://app.boxel.ai/catalog/' \
  --toUrl='https://app.boxel.ai/catalog/'
