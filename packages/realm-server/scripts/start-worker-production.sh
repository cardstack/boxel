#! /bin/sh

# Run from the realm-server package directory so node resolves the package's
# node_modules. Previously the CMD wrapped pnpm --filter, which set CWD for us;
# now PID 1 execs into this script directly so we set it ourselves. The PATH
# prepend gives us the package's local node_modules/.bin that `pnpm --filter` used to put
# on PATH automatically.
cd "$(cd "$(dirname "$0")" && pwd)/.."
PATH="./node_modules/.bin:$PATH"
export PATH

DEFAULT_CATALOG_REALM_URL='https://app.boxel.ai/catalog/'
CATALOG_REALM_URL="${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}"
DEFAULT_SOFTWARE_FACTORY_REALM_URL='https://app.boxel.ai/software-factory/'
SOFTWARE_FACTORY_REALM_URL="${RESOLVED_SOFTWARE_FACTORY_REALM_URL:-$DEFAULT_SOFTWARE_FACTORY_REALM_URL}"

echo "[start-worker-production] pid=$$ ppid=$PPID about to exec node at $(date -Iseconds)" >&2

NODE_NO_WARNINGS=1 \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  LOW_CREDIT_THRESHOLD=2000 \
  OPENROUTER_REALM_URL='https://app.boxel.ai/openrouter/' \
  exec node worker-manager.ts \
  --allPriorityCount="${WORKER_ALL_PRIORITY_COUNT:-1}" \
  --highPriorityCount="${WORKER_HIGH_PRIORITY_COUNT:-0}" \
  --prerendererUrl='http://boxel-prerender-manager.boxel-production-internal:4222' \
  --matrixURL='https://matrix.boxel.ai' \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://app.boxel.ai/base/' \
  \
  --fromUrl='https://app.boxel.ai/experiments/' \
  --toUrl='https://app.boxel.ai/experiments/' \
  \
  --fromUrl='@cardstack/catalog/' \
  --toUrl="${CATALOG_REALM_URL}" \
  \
  --fromUrl='@cardstack/skills/' \
  --toUrl='https://app.boxel.ai/skills/' \
  \
  --fromUrl='@cardstack/openrouter/' \
  --toUrl='https://app.boxel.ai/openrouter/' \
  \
  --fromUrl="${SOFTWARE_FACTORY_REALM_URL}" \
  --toUrl="${SOFTWARE_FACTORY_REALM_URL}"
  
