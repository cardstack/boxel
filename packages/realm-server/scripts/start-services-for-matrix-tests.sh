#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

pnpm --dir=../skills-realm skills:setup

# There is a race condition starting up the servers that setting up the
# submission realm triggers which triggers the start-development.sh script to
# SIGTERM. currently we don't need the submission realm for host tests to
# skipping that. but this issue needs to be fixed.
# ALSO i really think if we want a submission realm in our matrix tests then
# we probably need to add that via the isolated realm server--not here...

# Environment-mode configuration
if [ -n "$BOXEL_ENVIRONMENT" ]; then
  . "$SCRIPTS_DIR/ensure-traefik.sh"
  ensure_traefik

  ENV_SLUG=$(echo "$BOXEL_ENVIRONMENT" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  REALM_HOST="realm-server.${ENV_SLUG}.localhost"
  READINESS_URL="http-get://${REALM_HOST}/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"
  ICONS_URL="http://icons.${ENV_SLUG}.localhost"

  # Pre-setup: ensure Postgres, database, and migrations are ready before
  # starting the realm server (follows the same pattern as start-all.sh).
  REPO_ROOT="$(cd "$SCRIPTS_DIR/../../.." && pwd)"
  export PGPORT="${PGPORT:-5435}"
  export PGDATABASE="${PGDATABASE:-boxel_${ENV_SLUG}}"

  ./scripts/start-pg.sh
  echo "Waiting for Postgres to accept connections..."
  until docker exec boxel-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  "$REPO_ROOT/scripts/ensure-branch-db.sh" "$ENV_SLUG"
  echo "Running database migrations..."
  pnpm migrate
  ./scripts/start-matrix.sh

  # Start icons server in background (env-aware: dynamic port + Traefik registration).
  # In non-env mode, icons is expected to be started externally (e.g. CI does this).
  sh "$SCRIPTS_DIR/start-icons.sh" &
  ICONS_PID=$!
  cleanup_icons_server() {
    if [ -n "$ICONS_PID" ]; then
      kill "$ICONS_PID" >/dev/null 2>&1 || true
    fi
  }
  trap cleanup_icons_server EXIT INT TERM
else
  READINESS_URL="http-get://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"
  ICONS_URL="http://localhost:4206"
fi

WAIT_ON_TIMEOUT=600000 NODE_NO_WARNINGS=1 SKIP_SUBMISSION=true \
  start-server-and-test \
    'run-p -ln start:pg start:prerender-dev start:prerender-manager-dev start:worker-base start:base' \
    "${READINESS_URL}|${ICONS_URL}" \
    'wait'
