#!/bin/sh
# Shared environment computation for mise tasks.
# Sourced via .mise.toml [env] _.source — every mise task gets these variables automatically.
#
# `mise run` re-evaluates _.source with the current environment, so env-mode
# variables are correctly set when BOXEL_ENVIRONMENT is present. The standard-mode
# branch uses ${VAR:-default} to avoid clobbering production/staging env vars in CI.

# Resolve repo root from this file's location (works whether sourced or executed).
# When sourced via mise's _.source, $0 may be the parent shell, so we also
# try BASH_SOURCE and fall back to the path relative to .mise.toml (repo root).
if [ -n "${BASH_SOURCE:-}" ]; then
  _ENV_VARS_DIR="$(cd "$(dirname "$BASH_SOURCE")" && pwd)"
  _REPO_ROOT="$(cd "$_ENV_VARS_DIR/../.." && pwd)"
elif [ -f "./scripts/env-slug.sh" ]; then
  _REPO_ROOT="$(pwd)"
else
  _REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi
. "$_REPO_ROOT/scripts/env-slug.sh"
unset _ENV_VARS_DIR _REPO_ROOT

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
  export PRERENDER_URL="http://prerender.${ENV_SLUG}.localhost"
  export PRERENDER_MGR_URL="http://prerender-mgr.${ENV_SLUG}.localhost"
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

  # Matrix test services (isolated realm server + worker for Playwright tests)
  export MATRIX_TEST_REALM_URL="http://realm-matrix-test.${ENV_SLUG}.localhost"
  export MATRIX_TEST_REALM_PORT=0
  export MATRIX_TEST_WORKER_PORT=0
  export MATRIX_TEST_PUBLISHED_DOMAIN="realm-matrix-test.${ENV_SLUG}.localhost"
  export SMTP_URL="http://smtp.${ENV_SLUG}.localhost"
  export SMTP_PORT=0
else
  # Capture previous ENV_MODE before resetting it, so we can detect transitions
  _PREV_ENV_MODE="${ENV_MODE:-}"
  export ENV_SLUG=""
  export ENV_MODE=""

  if [ "$_PREV_ENV_MODE" = true ]; then
    # Transitioning from env mode to standard mode in the same shell:
    # reset derived variables to standard defaults to avoid stale env-mode values.

    # Service URLs
    export REALM_BASE_URL="http://localhost:4201"
    export REALM_TEST_URL="http://localhost:4202"
    export MATRIX_URL_VAL="http://localhost:8008"
    export WORKER_MGR_URL="http://localhost:4210"
    export WORKER_TEST_MGR_URL="http://localhost:4211"
    export PRERENDER_URL="http://localhost:4221"
    export PRERENDER_MGR_URL="http://localhost:4222"
    export ICONS_URL="http://localhost:4206"
    export HOST_URL="http://localhost:4200"

    # Database
    export PGDATABASE="boxel"
    export PGDATABASE_TEST="boxel_test"

    # Ports (fixed in standard mode)
    export REALM_PORT=4201
    export TEST_PORT=4202
    export WORKER_PORT=4210
    export WORKER_TEST_PORT=4211
    export PRERENDER_PORT=4221
    export PRERENDER_MGR_PORT=4222
    export ICONS_PORT=4206

    # Paths
    export REALMS_ROOT="./realms/localhost_4201"
    export REALMS_TEST_ROOT="./realms/localhost_4202"

    # Matrix test services
    export MATRIX_TEST_REALM_URL="http://localhost:4205"
    export MATRIX_TEST_REALM_PORT=4205
    export MATRIX_TEST_WORKER_PORT=4232
    export MATRIX_TEST_PUBLISHED_DOMAIN="localhost:4205"
    export SMTP_URL="http://localhost:5001"
    export SMTP_PORT=5001
  else
    # Fresh standard mode or non-env-mode shell:
    # use :- so production/staging env vars are not clobbered.

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

    # Matrix test services
    export MATRIX_TEST_REALM_URL="${MATRIX_TEST_REALM_URL:-http://localhost:4205}"
    export MATRIX_TEST_REALM_PORT="${MATRIX_TEST_REALM_PORT:-4205}"
    export MATRIX_TEST_WORKER_PORT="${MATRIX_TEST_WORKER_PORT:-4232}"
    export MATRIX_TEST_PUBLISHED_DOMAIN="${MATRIX_TEST_PUBLISHED_DOMAIN:-localhost:4205}"
    export SMTP_URL="${SMTP_URL:-http://localhost:5001}"
    export SMTP_PORT="${SMTP_PORT:-5001}"
  fi

  unset _PREV_ENV_MODE
fi
