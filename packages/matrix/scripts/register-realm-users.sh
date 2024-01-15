#! /bin/sh

until $(curl --output /dev/null --silent --head --fail http://localhost:8008); do
  printf '.'
  sleep 5
done
USERNAME=base_realm PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
USERNAME=drafts_realm PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
USERNAME=published_realm PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
USERNAME=node-test_realm PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
USERNAME=test_realm PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
