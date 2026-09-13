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
# Built every time rather than only when missing: `ember test --path dist`
# reads whatever is in that directory, so a dist left over from another branch
# or from before an edit reports a pass or failure for code that is not the
# code under test. Two minutes is cheap next to that.
#
# BOXEL_SKIP_HOST_BUILD=1 skips it, for a restart where nothing under
# packages/host has changed since the last build.
if [ "${BOXEL_SKIP_HOST_BUILD:-}" = "1" ] && [ -f packages/host/dist/tests/index.html ]; then
  echo "[stack] Reusing the existing host dist (BOXEL_SKIP_HOST_BUILD=1)."
else
  echo "[stack] Building the host dist (~2 minutes)…"
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
# host tests fetch Skill/boxel-environment, so they 404 until this is ready —
# a 404 that reads as a test failure rather than as a stack that is not
# finished. So when it does not come up, say so in the terms a reader needs
# and exit non-zero: the rest of the stack is usable, but "up" would be a lie.
skills_ready=1
ready "https://localhost:4201/skills/_readiness-check" "skills realm" 1200 || skills_ready=0

echo
echo "[stack] Run host tests with (rebuild first — the suite runs from dist):"
echo "  . /tmp/boxel-env.sh && cd packages/host && \\"
echo "    pnpm build && CI=true ./node_modules/.bin/ember test --path dist \\"
echo "      --filter 'Integration | search resource'"
echo

if [ "$skills_ready" = "0" ]; then
  cat >&2 <<EOF
[stack] INCOMPLETE: every realm is up except skills, which did not finish
[stack] indexing in time (see $LOG_DIR/realm-server.log).

[stack] Tests that read from the skills realm — anything fetching
[stack] Skill/boxel-environment, which is most of the AI-assistant suite —
[stack] will 404 and fail for that reason, not because of the code under test.
[stack] Re-run the readiness probe before trusting such a failure:
[stack]   curl -sk -o /dev/null -w '%{http_code}\\n' -H 'Accept: application/vnd.api+json' \\
[stack]     https://localhost:4201/skills/_readiness-check
EOF
  exit 2
fi

if [ "$REALMS" = "dev" ]; then
  echo "[stack] up — base and skills realms ready."
else
  echo "[stack] up — base, skills, test and node-test realms ready."
fi
