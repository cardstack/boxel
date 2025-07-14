#! /bin/sh

NODE_NO_WARNINGS=1 start-server-and-test \
  'pnpm run wait' \
  'http-get://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http-get://localhost:4202/test/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson|http://localhost:8008|http://localhost:5001' \
  'ember-test-pre-built'
