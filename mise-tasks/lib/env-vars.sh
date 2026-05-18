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

  # Service URLs (Traefik hostnames). Traefik terminates TLS on :443
  # with the mkcert leaf (`infra:ensure-dev-cert` provisioned;
  # traefik/dynamic/tls.yml references). Plain :80 routes 308-redirect
  # to https — see packages/host/scripts/traefik-helpers.js and
  # packages/realm-server/lib/dev-service-registry.ts. Everything is
  # https so the host app's same-origin / mixed-content rules don't
  # block fetches from the https host page to the realm services.
  export REALM_BASE_URL="https://realm-server.${ENV_SLUG}.localhost"
  export REALM_TEST_URL="https://realm-test.${ENV_SLUG}.localhost"
  export MATRIX_URL_VAL="https://matrix.${ENV_SLUG}.localhost"
  export WORKER_MGR_URL="https://worker.${ENV_SLUG}.localhost"
  export WORKER_TEST_MGR_URL="https://worker-test.${ENV_SLUG}.localhost"
  export PRERENDER_MGR_URL="https://prerender-mgr.${ENV_SLUG}.localhost"
  export ICONS_URL="https://icons.${ENV_SLUG}.localhost"
  export HOST_URL="https://host.${ENV_SLUG}.localhost"

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

    # Service URLs. Realm-server speaks HTTPS+HTTP/2 in local dev — the
    # dev cert is mandatory (see `infra:ensure-dev-cert` and the
    # repo-root README "Local HTTPS dev access" section).
    export REALM_BASE_URL="https://localhost:4201"
    export REALM_TEST_URL="https://localhost:4202"
    export MATRIX_URL_VAL="http://localhost:8008"
    export WORKER_MGR_URL="http://localhost:4210"
    export WORKER_TEST_MGR_URL="http://localhost:4211"
    export PRERENDER_MGR_URL="http://localhost:4222"
    export ICONS_URL="http://localhost:4206"
    export HOST_URL="https://localhost:4200"

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
    # clobbered. Realm-server speaks HTTPS+HTTP/2 in local dev; the dev
    # cert is mandatory (see `infra:ensure-dev-cert` and the repo-root
    # README "Local HTTPS dev access").
    export REALM_BASE_URL="${REALM_BASE_URL:-https://localhost:4201}"
    export REALM_TEST_URL="${REALM_TEST_URL:-https://localhost:4202}"
    export MATRIX_URL_VAL="${MATRIX_URL_VAL:-http://localhost:8008}"
    export WORKER_MGR_URL="${WORKER_MGR_URL:-http://localhost:4210}"
    export WORKER_TEST_MGR_URL="${WORKER_TEST_MGR_URL:-http://localhost:4211}"
    export PRERENDER_MGR_URL="${PRERENDER_MGR_URL:-http://localhost:4222}"
    export ICONS_URL="${ICONS_URL:-http://localhost:4206}"
    export HOST_URL="${HOST_URL:-https://localhost:4200}"

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
    # Vite's dev server terminates TLS using the same cert (see
    # packages/host/vite.config.mjs). Flip HOST_URL to https so every
    # consumer (browser, realm-server distURL rewriter, prerender
    # standby probe) hits the same scheme — mixing http + https
    # between vite and realm-server triggers CORS preflight failures
    # ("Redirect is not allowed for a preflight request").
    export HOST_URL="https://localhost:4200"
    if command -v mkcert >/dev/null 2>&1; then
      _BOXEL_MKCERT_CAROOT="$(mkcert -CAROOT 2>/dev/null || true)"
      if [ -n "$_BOXEL_MKCERT_CAROOT" ] && [ -f "$_BOXEL_MKCERT_CAROOT/rootCA.pem" ]; then
        # Node's NODE_EXTRA_CA_CERTS accepts a single PEM file path (not
        # a colon-separated list). If the dev has already pointed it at
        # something, leave their value in place — they presumably have
        # mkcert's CA in there already, or know what they're doing.
        # Otherwise point at mkcert's rootCA so realm-server fetches
        # validate against the local cert without `mkcert -install`.
        if [ -z "${NODE_EXTRA_CA_CERTS:-}" ]; then
          export NODE_EXTRA_CA_CERTS="$_BOXEL_MKCERT_CAROOT/rootCA.pem"
        fi
      fi
      unset _BOXEL_MKCERT_CAROOT
    fi
  fi
  unset _BOXEL_DEV_CERT_DIR _BOXEL_DEV_CERT_FILE _BOXEL_DEV_KEY_FILE

  # Puppeteer 24.35 (and the lockfile's tree) bundles Chrome 143, which
  # has a known h2 stream-window bug that hangs the dev prerender forever
  # on the first cold-start fetch of vite's large pre-optimized
  # `indexeddb-crypto-store` chunk (matrix-js-sdk). Newer Chrome (148+)
  # doesn't hit the bug. Both prerender's BrowserManager and the
  # standby-warmup probe (`scripts/wait-for-host-standby.ts`) already
  # honor `PUPPETEER_EXECUTABLE_PATH`, so just point them at the system
  # chrome when one's installed. Devs without google-chrome installed
  # keep the bundled puppeteer chromium — they'll see the hang stall
  # longer until vite's optimizer cache warms up.
  if [ -z "${PUPPETEER_EXECUTABLE_PATH:-}" ]; then
    # Explicit checks (not a for-loop) so the macOS path's embedded space
    # doesn't get word-split by /bin/sh — env-vars.sh runs under whatever
    # shell mise invokes, and POSIX sh handles backslash-escapes in for-
    # loop word lists inconsistently across implementations.
    if [ -x /usr/bin/google-chrome ]; then
      export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
    elif [ -x /usr/bin/google-chrome-stable ]; then
      export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
    elif [ -x /usr/bin/chromium ]; then
      export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
    elif [ -x /usr/bin/chromium-browser ]; then
      export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
    elif [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
      export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    elif [ -x "/Applications/Chromium.app/Contents/MacOS/Chromium" ]; then
      export PUPPETEER_EXECUTABLE_PATH="/Applications/Chromium.app/Contents/MacOS/Chromium"
    fi
  fi
fi
