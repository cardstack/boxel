#! /bin/sh

NODE_NO_WARNINGS=1 start-server-and-test \
  'run-p start:pg start:matrix start:smtp start:development start:base:root' \
  'http-get://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http-get://localhost:4203/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http-get://localhost:4201/experiments/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http://localhost:8008|http://localhost:5001' \
  'run-p start:test-realms' \
  'http-get://localhost:4202/node-test/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson' \
  'wait'
