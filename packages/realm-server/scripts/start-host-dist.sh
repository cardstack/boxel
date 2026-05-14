#!/bin/sh
# Start host dist server, skipping if already running.
# Mirrors the pattern in start-icons.sh.

HOST_URL="${HOST_URL:-https://localhost:4200}"

# Vite serves HTTPS in local dev when the mkcert leaf is present
# (vite.config.mjs reads REALM_SERVER_TLS_CERT_FILE / _KEY_FILE). curl
# trusts that cert via NODE_EXTRA_CA_CERTS / system trust; -k keeps the
# readiness probe simple if either trust path isn't wired up yet.
if curl -k --fail --silent --show-error "$HOST_URL" >/dev/null 2>&1; then
  echo "host already running on $HOST_URL, skipping startup"
  exit 0
fi

pnpm --dir=../host serve:dist
