#! /bin/sh

# Run from the realm-server package directory so node resolves the package's
# node_modules. Previously the CMD wrapped pnpm --filter, which set CWD for us;
# now PID 1 execs into this script directly so we set it ourselves. The PATH
# prepend gives us the package's local node_modules/.bin that `pnpm --filter` used to put
# on PATH automatically.
cd "$(cd "$(dirname "$0")" && pwd)/.."
PATH="./node_modules/.bin:$PATH"
export PATH

DEFAULT_CATALOG_REALM_URL='https://realms-staging.stack.cards/catalog/'
CATALOG_REALM_URL="${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}"
DEFAULT_SOFTWARE_FACTORY_REALM_URL='https://realms-staging.stack.cards/software-factory/'
SOFTWARE_FACTORY_REALM_URL="${RESOLVED_SOFTWARE_FACTORY_REALM_URL:-$DEFAULT_SOFTWARE_FACTORY_REALM_URL}"

echo "[start-worker-staging] pid=$$ ppid=$PPID about to exec node at $(date -Iseconds)" >&2

# ECS sets the memory limit on the task, where the container's own cgroup
# can't see it, so read it from the task metadata endpoint. The worker manager
# sizes each worker's heap from it.
TASK_MEMORY_MB=$(node -e '
  const uri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (uri) {
    fetch(uri + "/task", { signal: AbortSignal.timeout(2000) })
      .then((r) => r.json())
      .then((t) => console.log(t.Limits?.Memory ?? ""))
      .catch(() => {});
  }
' 2>/dev/null)

NODE_NO_WARNINGS=1 \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  MATRIX_SERVER_NAME=stack.cards \
  LOW_CREDIT_THRESHOLD=2000 \
  OPENROUTER_REALM_URL='https://realms-staging.stack.cards/openrouter/' \
  exec node worker-manager.ts \
  --allPriorityCount="${WORKER_ALL_PRIORITY_COUNT:-1}" \
  --highPriorityCount="${WORKER_HIGH_PRIORITY_COUNT:-0}" \
  ${TASK_MEMORY_MB:+--taskMemoryMb="$TASK_MEMORY_MB"} \
  --prerendererUrl='http://boxel-prerender-manager.boxel-staging-internal:4222' \
  --matrixURL='https://matrix-staging.stack.cards' \
  \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms-staging.stack.cards/base/' \
  \
  --fromUrl='https://realms-staging.stack.cards/experiments/' \
  --toUrl='https://realms-staging.stack.cards/experiments/' \
  \
  --fromUrl='@cardstack/catalog/' \
  --toUrl="${CATALOG_REALM_URL}" \
  \
  --fromUrl='@cardstack/skills/' \
  --toUrl='https://realms-staging.stack.cards/skills/' \
  \
  --fromUrl='@cardstack/pretui/' \
  --toUrl='https://realms-staging.stack.cards/pretui/' \
  \
  --fromUrl='@cardstack/openrouter/' \
  --toUrl='https://realms-staging.stack.cards/openrouter/' \
  \
  --fromUrl='https://realms-staging.stack.cards/choreo-gallery/' \
  --toUrl='https://realms-staging.stack.cards/choreo-gallery/' \
  \
  --fromUrl="${SOFTWARE_FACTORY_REALM_URL}" \
  --toUrl="${SOFTWARE_FACTORY_REALM_URL}"
  

