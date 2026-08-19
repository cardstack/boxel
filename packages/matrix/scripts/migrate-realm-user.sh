#! /bin/sh

if [ -z "$REALM_SECRET_SEED" ]; then
  echo "The REALM_SECRET_SEED env var must be specified"
  exit -1
fi

if [ -z "$1" ]; then
  echo "realm user to migrate must be specified"
  exit -1
fi

node ./scripts/migrate-realm-user.ts $1
