#!/bin/sh
set -e

REALM_SERVER_URL="${REALM_SERVER_URL:-https://localhost:4201}"
if [ -z "${REALM_SERVER_JWT}" ]; then
  echo "REALM_SERVER_JWT is required" >&2
  exit 1
fi
USERNAME="${USERNAME:-@user:localhost}"

# `-k` skips cert verification — the local realm-server's HTTPS cert is
# mkcert-signed (see infra:ensure-dev-cert) and curl doesn't pick up the
# trust the way Node does via NODE_EXTRA_CA_CERTS.
curl -sSk -X POST "${REALM_SERVER_URL}/_bot-registration" \
  -H "Authorization: Bearer ${REALM_SERVER_JWT}" \
  -H "Accept: application/vnd.api+json" \
  -H "Content-Type: application/vnd.api+json" \
  -d "{\"data\":{\"type\":\"bot-registration\",\"attributes\":{\"username\":\"${USERNAME}\"}}}"
