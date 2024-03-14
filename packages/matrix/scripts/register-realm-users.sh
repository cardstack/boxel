#! /bin/sh

until $(curl --output /dev/null --silent --head --fail http://localhost:8008); do
  printf '.'
  sleep 5
done
MATRIX_USERNAME=base_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
MATRIX_USERNAME=drafts_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
MATRIX_USERNAME=published_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
MATRIX_USERNAME=node-test_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
MATRIX_USERNAME=test_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
