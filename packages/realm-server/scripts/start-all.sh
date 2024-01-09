#! /bin/sh

NODE_NO_WARNINGS=1 start-server-and-test \
  'run-p start:development start:base:root' \
  'http-get://localhost:4201/base/fields/boolean-field?acceptHeader=application%2Fvnd.card%2Bjson|http-get://localhost:4203/fields/boolean-field?acceptHeader=application%2Fvnd.card%2Bjson|http-get://localhost:4201/drafts/index?acceptHeader=application%2Fvnd.card%2Bjson' \
  'run-p start:test-realms start:test-container start:matrix start:smtp' \
  'http-get://localhost:4202/node-test/person-1?acceptHeader=application%2Fvnd.card%2Bjson|http-get://127.0.0.1:4205|http://localhost:8008|http://localhost:5001' \
  'wait'
