#! /bin/sh
pnpm --dir=../skills-realm skills:setup
# There is a race condition starting up the servers that setting up the
# submission realm triggers which triggers the start-development.sh script to
# SIGTERM. currently we don't need the submission realm for host tests to
# skipping that. but this issue needs to be fixed. 
# ALSO i really think if we want a submission realm in our matrix tests then
# we probably need to add that via the isolated realm server--not here...
WAIT_ON_TIMEOUT=600000 NODE_NO_WARNINGS=1 SKIP_SUBMISSION=true \
  start-server-and-test \
    'run-p -ln start:pg start:prerender-dev start:prerender-manager-dev start:worker-base start:base' \
    'http-get://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson' \
    'wait'
