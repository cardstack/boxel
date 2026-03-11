#!/bin/sh
# Shared environment computation for mise tasks.
# Sourced via .mise.toml [env] _.source — every mise task gets these variables automatically.

compute_env_slug() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g'
}

export PGPORT="${PGPORT:-5435}"

if [ -n "${BOXEL_ENVIRONMENT:-}" ]; then
  ENV_SLUG=$(compute_env_slug "$BOXEL_ENVIRONMENT")
  export ENV_SLUG
  export ENV_MODE=true

  # Service URLs (Traefik hostnames)
  export REALM_BASE_URL="http://realm-server.${ENV_SLUG}.localhost"
  export REALM_TEST_URL="http://realm-test.${ENV_SLUG}.localhost"
  export MATRIX_URL_VAL="http://matrix.${ENV_SLUG}.localhost"
  export WORKER_MGR_URL="http://worker.${ENV_SLUG}.localhost"
  export WORKER_TEST_MGR_URL="http://worker-test.${ENV_SLUG}.localhost"
  export PRERENDER_URL="${PRERENDER_URL:-http://prerender.${ENV_SLUG}.localhost}"
  export PRERENDER_MGR_URL="${PRERENDER_MGR_URL:-http://prerender-mgr.${ENV_SLUG}.localhost}"
  export ICONS_URL="http://icons.${ENV_SLUG}.localhost"
  export HOST_URL="http://host.${ENV_SLUG}.localhost"

  # Database
  export PGDATABASE="${PGDATABASE:-boxel_${ENV_SLUG}}"
  export PGDATABASE_TEST="boxel_test_${ENV_SLUG}"

  # Ports (dynamic in env mode)
  export REALM_PORT=0
  export TEST_PORT=0
  export WORKER_PORT=0
  export WORKER_TEST_PORT=0
  export PRERENDER_PORT=0
  export PRERENDER_MGR_PORT=0
  export ICONS_PORT=0

  # Paths
  export REALMS_ROOT="./realms/${ENV_SLUG}"
  export REALMS_TEST_ROOT="./realms/${ENV_SLUG}_test"
else
  export ENV_SLUG=""
  export ENV_MODE=""

  # Service URLs — use :- so production/staging env vars are not clobbered
  export REALM_BASE_URL="${REALM_BASE_URL:-http://localhost:4201}"
  export REALM_TEST_URL="${REALM_TEST_URL:-http://localhost:4202}"
  export MATRIX_URL_VAL="${MATRIX_URL_VAL:-http://localhost:8008}"
  export WORKER_MGR_URL="${WORKER_MGR_URL:-http://localhost:4210}"
  export WORKER_TEST_MGR_URL="${WORKER_TEST_MGR_URL:-http://localhost:4211}"
  export PRERENDER_URL="${PRERENDER_URL:-http://localhost:4221}"
  export PRERENDER_MGR_URL="${PRERENDER_MGR_URL:-http://localhost:4222}"
  export ICONS_URL="${ICONS_URL:-http://localhost:4206}"
  export HOST_URL="${HOST_URL:-http://localhost:4200}"

  # Database
  export PGDATABASE="${PGDATABASE:-boxel}"
  export PGDATABASE_TEST="${PGDATABASE_TEST:-boxel_test}"

  # Ports (fixed in standard mode)
  export REALM_PORT="${REALM_PORT:-4201}"
  export TEST_PORT="${TEST_PORT:-4202}"
  export WORKER_PORT="${WORKER_PORT:-4210}"
  export WORKER_TEST_PORT="${WORKER_TEST_PORT:-4211}"
  export PRERENDER_PORT="${PRERENDER_PORT:-4221}"
  export PRERENDER_MGR_PORT="${PRERENDER_MGR_PORT:-4222}"
  export ICONS_PORT="${ICONS_PORT:-4206}"

  # Paths
  export REALMS_ROOT="${REALMS_ROOT:-./realms/localhost_4201}"
  export REALMS_TEST_ROOT="${REALMS_TEST_ROOT:-./realms/localhost_4202}"
fi
