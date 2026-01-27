#!/bin/sh
set -e

REALM_SERVER_URL="${REALM_SERVER_URL:-http://localhost:4201}"
if [ -z "${REALM_SERVER_JWT}" ]; then
  echo "REALM_SERVER_JWT is required" >&2
  exit 1
fi
USERNAME="${USERNAME:-@user:localhost}"

curl -sS -X POST "${REALM_SERVER_URL}/_bot-registration" \
  -H "Authorization: Bearer ${REALM_SERVER_JWT}" \
  -H "Accept: application/vnd.api+json" \
  -H "Content-Type: application/vnd.api+json" \
  -d "{\"data\":{\"type\":\"bot-registration\",\"attributes\":{\"username\":\"${USERNAME}\"}}}"
