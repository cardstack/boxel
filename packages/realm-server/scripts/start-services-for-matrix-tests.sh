#! /bin/sh
pnpm --dir=../skills-realm skills:setup
USE_HEADLESS_CHROME_INDEXING=true WAIT_ON_TIMEOUT=600000 NODE_NO_WARNINGS=1 start-server-and-test \
  'run-p start:pg start:prerender-dev start:worker-base start:base' \
  'http-get://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson' \
  'wait'
