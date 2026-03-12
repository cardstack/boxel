#! /bin/sh

# Determine the Synapse health check URL (environment-aware)
if [ -n "$BOXEL_ENVIRONMENT" ]; then
  SLUG=$(echo "$BOXEL_ENVIRONMENT" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  CONTAINER_NAME="boxel-synapse-${SLUG}"
  # Read the dynamic host port from the running container
  SYNAPSE_HOST_PORT=$(docker port "$CONTAINER_NAME" 8008/tcp 2>/dev/null | head -1 | awk -F: '{print $NF}')
  if [ -z "$SYNAPSE_HOST_PORT" ]; then
    echo "Could not determine Synapse host port for container $CONTAINER_NAME"
    exit 1
  fi
  SYNAPSE_HEALTH_URL="http://localhost:${SYNAPSE_HOST_PORT}"
else
  SYNAPSE_HEALTH_URL="http://localhost:8008"
fi

COUNT=0
MAX_ATTEMPTS=24

until $(curl --output /dev/null --silent --head --fail "$SYNAPSE_HEALTH_URL"); do
  printf '.'
  sleep 5

  COUNT=$((COUNT + 1))
  if [ "$COUNT" -eq "$MAX_ATTEMPTS" ]; then
    echo "Failed to reach Synapse after $MAX_ATTEMPTS attempts."
    exit 1
  fi
done

: ${REALM_SECRET_SEED:="shhh! it's a secret"}
export REALM_SECRET_SEED

ts-node --transpileOnly ./scripts/register-realm-user.ts realm_server
ts-node --transpileOnly ./scripts/register-realm-user.ts node-test_realm-server
ts-node --transpileOnly ./scripts/register-realm-user.ts base_realm
ts-node --transpileOnly ./scripts/register-realm-user.ts experiments_realm
ts-node --transpileOnly ./scripts/register-realm-user.ts catalog_realm
ts-node --transpileOnly ./scripts/register-realm-user.ts boxel_homepage_realm
ts-node --transpileOnly ./scripts/register-realm-user.ts submission_realm
ts-node --transpileOnly ./scripts/register-realm-user.ts node-test_realm
ts-node --transpileOnly ./scripts/register-realm-user.ts skills_realm
ts-node --transpileOnly ./scripts/register-realm-user.ts catalog_new_realm
ts-node --transpileOnly ./scripts/register-realm-user.ts test_realm
ts-node --transpileOnly ./scripts/register-realm-user.ts openrouter_realm
