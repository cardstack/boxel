#! /bin/sh

# Start the prerender server in staging
# Expects REALM_SECRET_SEED to be set in the environment

# Run from the realm-server package directory so ts-node finds the package's
# tsconfig. Previously the CMD wrapped pnpm --filter, which set CWD for us;
# now PID 1 execs into this script directly so we set it ourselves. The PATH
# prepend gives us the local ts-node binary that `pnpm --filter` used to put
# on PATH automatically.
cd "$(cd "$(dirname "$0")" && pwd)/.."
PATH="./node_modules/.bin:$PATH"
export PATH

echo "[start-prerender-staging] pid=$$ ppid=$PPID about to exec ts-node at $(date -Iseconds)" >&2

NODE_ENV=production \
  NODE_NO_WARNINGS=1 \
  BOXEL_HOST_URL=https://realms-staging.stack.cards \
  exec ts-node \
  --transpileOnly prerender/prerender-server \
  --port=${PRERENDER_PORT:-4221}
