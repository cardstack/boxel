#! /bin/sh

NODE_NO_WARNINGS=1 start-server-and-test \
  'run-p start:matrix start:smtp start:development start:base:root' \
  'http-get://localhost:4201/base/fields/boolean-field?acceptHeader=application%2Fvnd.card%2Bjson|http-get://localhost:4203/fields/boolean-field?acceptHeader=application%2Fvnd.card%2Bjson|http://localhost:8008|http://localhost:5001' \
  'run-p start:test-realms start:test-container' \
  'http-get://localhost:4202/node-test/person-1?acceptHeader=application%2Fvnd.card%2Bjson|http-get://127.0.0.1:4205' \
  'wait'
