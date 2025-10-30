#! /bin/sh

set -eu

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPTS_DIR/../../.." && pwd)"

pnpm --dir="$REPO_ROOT/packages/matrix" assert-synapse-running
pnpm --dir="$REPO_ROOT/packages/matrix" register-realm-users

cd "$REPO_ROOT/packages/realm-server"
exec pnpm start:skip-experiments
