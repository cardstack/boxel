#! /bin/sh
NODE_NO_WARNINGS=1 start-server-and-test \
  'run-p start:pg start:development start:base:root' \
  'http-get://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http-get://localhost:4203/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http-get://localhost:4201/drafts/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson' \
  'run-p start:test-realms start:test-container' \
  'http-get://localhost:4202/node-test/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http-get://127.0.0.1:4205' \
  'wait'
