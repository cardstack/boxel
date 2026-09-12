#!/usr/bin/env bash
# Start the boxel test stack without Docker: the services `mise run
# test-services:host` would start, minus the two that are containers
# (Synapse, smtp4dev) and minus start:pg (postgres is native — see
# claude-web-no-docker-bootstrap.sh). Run claude-web-no-docker-bootstrap.sh first.
#
#   .claude/skills/claude-web-no-docker-stack/claude-web-no-docker-start-stack.sh            # dev + test realms
#   BOXEL_STACK_REALMS=dev .claude/skills/claude-web-no-docker-stack/claude-web-no-docker-start-stack.sh
#
# Per-service logs land in ${BOXEL_STACK_LOG_DIR:-/tmp/boxel-stack-logs}.
set -euo pipefail

if [ ! -f /tmp/boxel-env.sh ]; then
  cat >&2 <<'EOF'
[stack] /tmp/boxel-env.sh is missing — run claude-web-no-docker-bootstrap.sh first.

If you are on a machine where Docker works, you do not want either script:
use `mise run dev` or `mise run test-services:host` instead.
EOF
  exit 1
fi
# shellcheck disable=SC1091
. /tmp/boxel-env.sh
REPO_ROOT="$PWD"
LOG_DIR="${BOXEL_STACK_LOG_DIR:-/tmp/boxel-stack-logs}"
REALMS="${BOXEL_STACK_REALMS:-all}"
mkdir -p "$LOG_DIR"
export LOG_LEVELS="${LOG_LEVELS:-*=info,realm:requests=warn}"

start() { # start <name> <mise-task> [args…]
  local name="$1"; shift
  echo "[stack] starting $name…"
  nohup mise run "$@" > "$LOG_DIR/$name.log" 2>&1 &
}

ready() { # ready <url> <label> <timeout-seconds>
  local url="$1" label="$2" budget="${3:-900}" waited=0
  echo -n "[stack] waiting for $label"
  while [ "$waited" -lt "$budget" ]; do
    if [ "$(curl -sk -o /dev/null -w '%{http_code}' -H 'Accept: application/vnd.api+json' "$url")" = "200" ]; then
      echo " ✓ (${waited}s)"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
    echo -n .
  done
  echo " ✗ timed out after ${budget}s — see $LOG_DIR"
  return 1
}

# The host bundle the prerender renders against and the test suite runs from.
# `ember test --path dist` reads the same build, so it has to exist before
# either can start.
if [ ! -f packages/host/dist/tests/index.html ]; then
  echo "[stack] Building the host dist (a few minutes)…"
  pnpm --dir packages/host build
fi

cd packages/realm-server
nohup sh ./scripts/start-icons.sh > "$LOG_DIR/icons.log" 2>&1 &
nohup ./scripts/start-host-dist.sh > "$LOG_DIR/host-dist.log" 2>&1 &
cd "$REPO_ROOT"

# The prerender's standby pages navigate to the host dist, so let it bind
# first; the manager must be up before any worker or realm-server, which gate
# their own startup on it having a registered worker.
for _ in $(seq 1 60); do
  curl -sk -o /dev/null "https://localhost:4200/" && break
  sleep 2
done
start prerender-mgr services:prerender-mgr
sleep 5
start prerender services:prerender

start worker services:worker
start realm-server services:realm-server -- --workerManagerPort=4210
ready "https://localhost:4201/base/_readiness-check" "base realm" 1200

if [ "$REALMS" != "dev" ]; then
  start worker-test services:worker-test
  start test-realms services:test-realms -- --workerManagerPort=4211
  ready "https://localhost:4202/node-test/_readiness-check" "node-test realm" 900
  ready "https://localhost:4202/test/_readiness-check" "test realm" 900
fi

# skills indexes after base in the same realm-server process. The AI-assistant
# host tests fetch Skill/boxel-environment, so they 404 until this is ready.
ready "https://localhost:4201/skills/_readiness-check" "skills realm" 1200 || true

echo
echo "[stack] up. Run host tests with:"
echo "  . /tmp/boxel-env.sh && cd packages/host && \\"
echo "    CI=true ./node_modules/.bin/ember test --path dist --filter 'Integration | search resource'"
