#! /bin/sh

WAIT_ON_TIMEOUT=900000 SKIP_EXPERIMENTS=true SKIP_CATALOG=true SKIP_BOXEL_HOMEPAGE=true SKIP_SUBMISSION=true NODE_NO_WARNINGS=1 start-server-and-test \
  'run-p -ln start:pg start:prerender-dev start:prerender-manager-dev start:matrix start:smtp start:worker-development start:development' \
  'http-get://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http://localhost:8008|http://localhost:5001' \
  'run-p -ln start:worker-test start:test-realms' \
  'http-get://localhost:4202/node-test/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson' \
  'wait'
