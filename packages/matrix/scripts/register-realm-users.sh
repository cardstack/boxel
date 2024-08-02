#! /bin/sh

COUNT=0
MAX_ATTEMPTS=10

until $(curl --output /dev/null --silent --head --fail http://localhost:8008); do
  printf '.'
  sleep 5

  COUNT=$((COUNT+1))
  if [ "$COUNT" -eq "$MAX_ATTEMPTS" ]; then
    echo "Failed to reach Synapse after $MAX_ATTEMPTS attempts."
    exit 1
  fi
done

MATRIX_USERNAME=base_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
MATRIX_USERNAME=experiments_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
MATRIX_USERNAME=node-test_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
MATRIX_USERNAME=test_realm MATRIX_PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
