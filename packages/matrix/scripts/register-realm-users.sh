#! /bin/sh
set -x

echo "starting register realm users"

until $(curl --output /dev/null --silent --head --fail http://localhost:8008); do
  printf '.'
  curl_output=$(curl --head --fail http://localhost:8008)
  sleep 5
done
echo "matrix server is up"
MATRIX_USERNAME=base_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
MATRIX_USERNAME=drafts_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
MATRIX_USERNAME=published_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
MATRIX_USERNAME=node-test_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
MATRIX_USERNAME=test_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
