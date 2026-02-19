#! /bin/sh

if curl --fail --silent --show-error http://localhost:4206 >/dev/null 2>&1; then
  echo "icons server already running on http://localhost:4206, skipping startup"
  exit 0
fi

pnpm --dir=../boxel-icons serve
