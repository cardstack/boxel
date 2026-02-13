#! /bin/sh
pnpm --dir=../skills-realm skills:setup
WAIT_ON_TIMEOUT=600000 NODE_NO_WARNINGS=1 start-server-and-test \
  'run-p -ln start:pg start:prerender-dev start:prerender-manager-dev start:worker-base start:base' \
  'http-get://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson' \
  'wait'
