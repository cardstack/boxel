#!/bin/sh
# Start host dist server, skipping if already running.
# Mirrors the pattern in start-icons.sh.

HOST_URL="${HOST_URL:-http://localhost:4200}"

if curl --fail --silent --show-error "$HOST_URL" >/dev/null 2>&1; then
  echo "host already running on $HOST_URL, skipping startup"
  exit 0
fi

pnpm --dir=../host serve:dist
