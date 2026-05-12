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

# Turbo mode: boost parallelism for local development.
# All turbo defaults can be overridden individually.
if [ "${BOXEL_TURBO:-}" = "true" ]; then
  : "${PRERENDER_COUNT:=3}"
  : "${PRERENDER_PAGE_POOL_MIN:=4}"
  : "${PRERENDER_PAGE_POOL_MAX:=4}"
  : "${WORKER_HIGH_PRIORITY_COUNT:=4}"
  : "${WORKER_ALL_PRIORITY_COUNT:=4}"
fi

# Prerender scaling
export PRERENDER_COUNT="${PRERENDER_COUNT:-1}"
export PRERENDER_PAGE_POOL_MIN="${PRERENDER_PAGE_POOL_MIN:-4}"
export PRERENDER_PAGE_POOL_MAX="${PRERENDER_PAGE_POOL_MAX:-4}"
export PRERENDER_MULTIPLEX="${PRERENDER_MULTIPLEX:-1}"

# Worker scaling
export WORKER_HIGH_PRIORITY_COUNT="${WORKER_HIGH_PRIORITY_COUNT:-0}"
export WORKER_ALL_PRIORITY_COUNT="${WORKER_ALL_PRIORITY_COUNT:-1}"

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
else
  # Capture previous ENV_MODE before resetting it, so we can detect transitions
  _PREV_ENV_MODE="${ENV_MODE:-}"
  export ENV_SLUG=""
  export ENV_MODE=""

  if [ "$_PREV_ENV_MODE" = true ]; then
    # Transitioning from env mode to standard mode in the same shell:
    # reset derived variables to standard defaults to avoid stale env-mode values.

    # Service URLs. Realm-server flips to HTTPS+HTTP/2 below when the
    # dev cert has been provisioned by `mise run infra:ensure-dev-cert`;
    # absent that cert the URLs stay http. See the repo-root README's
    # "Local HTTPS dev access" section.
    export REALM_BASE_URL="http://localhost:4201"
    export REALM_TEST_URL="http://localhost:4202"
    export MATRIX_URL_VAL="http://localhost:8008"
    export WORKER_MGR_URL="http://localhost:4210"
    export WORKER_TEST_MGR_URL="http://localhost:4211"
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
  else
    # Fresh standard mode or non-env-mode shell:
    # use :- so production/staging env vars are not clobbered.

    # Service URLs — use :- so production/staging env vars are not
    # clobbered. Realm-server flips to HTTPS+HTTP/2 below when the dev
    # cert has been provisioned (see `infra:ensure-dev-cert` and the
    # repo-root README "Local HTTPS dev access"). Without a cert the
    # realm-server listens on plain HTTP/1.1 and these URLs stay http
    # — that's the CI / hermetic-test path.
    export REALM_BASE_URL="${REALM_BASE_URL:-http://localhost:4201}"
    export REALM_TEST_URL="${REALM_TEST_URL:-http://localhost:4202}"
    export MATRIX_URL_VAL="${MATRIX_URL_VAL:-http://localhost:8008}"
    export WORKER_MGR_URL="${WORKER_MGR_URL:-http://localhost:4210}"
    export WORKER_TEST_MGR_URL="${WORKER_TEST_MGR_URL:-http://localhost:4211}"
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

  unset _PREV_ENV_MODE

  # Local HTTPS dev access: when the cert provisioned by
  # `mise run infra:ensure-dev-cert` is present, expose its paths to
  # the realm-server so it terminates HTTPS+HTTP/2 on the canonical
  # port, and point Node clients at mkcert's local CA via
  # NODE_EXTRA_CA_CERTS so they trust the cert without requiring
  # `mkcert -install` to have written it into the system trust store.
  # If the cert is missing, the realm-server falls back to plain HTTP
  # (tests/CI path). See the repo-root README "Local HTTPS dev access".
  _BOXEL_DEV_CERT_DIR="${BOXEL_DEV_CERT_DIR:-$HOME/.local/share/boxel/dev-certs}"
  _BOXEL_DEV_CERT_FILE="$_BOXEL_DEV_CERT_DIR/localhost.pem"
  _BOXEL_DEV_KEY_FILE="$_BOXEL_DEV_CERT_DIR/localhost-key.pem"
  if [ -f "$_BOXEL_DEV_CERT_FILE" ] && [ -f "$_BOXEL_DEV_KEY_FILE" ]; then
    export REALM_SERVER_TLS_CERT_FILE="$_BOXEL_DEV_CERT_FILE"
    export REALM_SERVER_TLS_KEY_FILE="$_BOXEL_DEV_KEY_FILE"
    # Cert is provisioned — realm-server will terminate HTTPS+HTTP/2 on
    # both ports, so flip the canonical URLs to match the wire.
    case "$REALM_BASE_URL" in
      http://localhost:4201) export REALM_BASE_URL="https://localhost:4201" ;;
    esac
    case "$REALM_TEST_URL" in
      http://localhost:4202) export REALM_TEST_URL="https://localhost:4202" ;;
    esac
    if command -v mkcert >/dev/null 2>&1; then
      _BOXEL_MKCERT_CAROOT="$(mkcert -CAROOT 2>/dev/null || true)"
      if [ -n "$_BOXEL_MKCERT_CAROOT" ] && [ -f "$_BOXEL_MKCERT_CAROOT/rootCA.pem" ]; then
        # Merge with any existing NODE_EXTRA_CA_CERTS the dev already set.
        if [ -n "${NODE_EXTRA_CA_CERTS:-}" ] && [ "$NODE_EXTRA_CA_CERTS" != "$_BOXEL_MKCERT_CAROOT/rootCA.pem" ]; then
          export NODE_EXTRA_CA_CERTS="$_BOXEL_MKCERT_CAROOT/rootCA.pem:$NODE_EXTRA_CA_CERTS"
        else
          export NODE_EXTRA_CA_CERTS="$_BOXEL_MKCERT_CAROOT/rootCA.pem"
        fi
      fi
      unset _BOXEL_MKCERT_CAROOT
    fi
  fi
  unset _BOXEL_DEV_CERT_DIR _BOXEL_DEV_CERT_FILE _BOXEL_DEV_KEY_FILE
fi
