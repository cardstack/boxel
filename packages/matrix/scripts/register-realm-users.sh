#! /bin/sh

COUNT=0
MAX_ATTEMPTS=10

until $(curl --output /dev/null --silent --head --fail http://localhost:8008); do
  printf '.'
  sleep 5

  COUNT=$((COUNT + 1))
  if [ "$COUNT" -eq "$MAX_ATTEMPTS" ]; then
    echo "Failed to reach Synapse after $MAX_ATTEMPTS attempts."
    exit 1
  fi
done

: ${REALM_SECRET_SEED:="shhh! it's a secret"}

MATRIX_USERNAME=admin \
  MATRIX_PASSWORD=password \
  MATRIX_IS_ADMIN=TRUE ts-node \
  --transpileOnly ./scripts/register-test-user.ts

ts-node --transpileOnly ./scripts/register-realm-user.ts base_realm
ts-node --transpileOnly ./scripts/register-realm-user.ts experiments_realm
ts-node --transpileOnly ./scripts/register-realm-user.ts published_realm
ts-node --transpileOnly ./scripts/register-realm-user.ts node-test_realm
ts-node --transpileOnly ./scripts/register-realm-user.ts test_realm
