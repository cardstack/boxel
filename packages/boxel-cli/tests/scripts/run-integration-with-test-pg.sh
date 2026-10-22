#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REALM_SERVER_SCRIPTS="$(cd "$SCRIPT_DIR/../../../realm-server/tests/scripts" && pwd)"

# The realm servers the suite starts can serve a secure origin, which is
# served from the secure origin's build, so the build comes first.
pnpm --dir="${SCRIPT_DIR}/../../../secure-origin" build

"${REALM_SERVER_SCRIPTS}/prepare-test-pg.sh"
trap '"${REALM_SERVER_SCRIPTS}/stop-test-pg.sh" >/dev/null 2>&1 || true' EXIT INT TERM

NODE_NO_WARNINGS=1 \
PGPORT=55436 \
  vitest run --pool=forks --poolOptions.forks.singleFork tests/integration/**
