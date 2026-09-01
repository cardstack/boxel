#! /bin/sh
# Start the boxel-pg container. The container spec and the start/repair logic
# live in scripts/pg-container.sh, shared with mise-tasks/infra/ensure-pg.
#
# `$0` may be the packages/realm-server/scripts symlink to this file; both paths
# sit three levels below the repo root, so the same relative walk works either
# way.
. "$(cd "$(dirname "$0")/../../.." && pwd)/scripts/pg-container.sh"

boxel_pg_ensure_running
