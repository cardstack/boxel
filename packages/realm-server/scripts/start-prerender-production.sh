#! /bin/sh

# Start the prerender server in production
# Expects REALM_SECRET_SEED to be set in the environment

# Run from the realm-server package directory so node resolves the package's
# node_modules. Previously the CMD wrapped pnpm --filter, which set CWD for us;
# now PID 1 execs into this script directly so we set it ourselves. The PATH
# prepend gives us the package's local node_modules/.bin that `pnpm --filter` used to put
# on PATH automatically.
cd "$(cd "$(dirname "$0")" && pwd)/.."
PATH="./node_modules/.bin:$PATH"
export PATH

echo "[start-prerender-production] pid=$$ ppid=$PPID about to exec node at $(date -Iseconds)" >&2

NODE_ENV=production \
  NODE_NO_WARNINGS=1 \
  BOXEL_HOST_URL=https://app.boxel.ai \
  exec node prerender/prerender-server.ts \
  --port=${PRERENDER_PORT:-4221}
