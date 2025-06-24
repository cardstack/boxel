#! /bin/sh
NODE_NO_WARNINGS=1 start-server-and-test \
  'run-p start:pg start:worker-base-and-skills start:base-and-skills' \
  'http-get://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http-get://localhost:4201/skills/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson' \
  'run-p start:worker-test start:test-realms' \
  'http-get://localhost:4202/test/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http-get://localhost:4202/node-test/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson' \
  'wait'
