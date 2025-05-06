#! /bin/sh

# FIXME this had start:matrix… how to adapt?

NODE_NO_WARNINGS=1 start-server-and-test \
  'run-p start:pg start:smtp start:worker-development start:development' \
  'http-get://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http-get://localhost:4201/experiments/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http://localhost:8008|http://localhost:5001' \
  'run-p start:worker-test start:test-realms' \
  'http-get://localhost:4202/node-test/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson' \
  'wait'
