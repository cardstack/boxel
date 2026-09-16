#!/usr/bin/env bash
# Provision a Claude-web session that cannot pull container images or install
# mise, so the boxel stack can still be started and its browser test suites
# run. See SKILL.md for what each step replaces and why.
#
# This is NOT a way to run the stack on a development machine. There, the
# normal path (`mise run dev` / `mise run test-services:host`, with Docker) is
# simpler, better tested, and gives you Matrix. This script exists only for a
# session where that path cannot work, and it refuses to run anywhere else —
# see the preconditions below.
#
# Idempotent: re-running it re-checks each piece and skips what is in place.
#
#   .claude/skills/claude-web-no-docker-stack/claude-web-no-docker-bootstrap.sh
#
# Writes an env file the companion start script (and any later shell) sources:
#   /tmp/boxel-env.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# --- Preconditions -----------------------------------------------------------
# Every substitution below (a shimmed `mise` on the system path, a postgres
# cluster in /var/lib, a CA in the system trust store, symlinks in /usr/bin)
# is appropriate in a disposable session container and wrong on a machine
# someone works on. Refuse unless this is one of those containers.
#
# Override with BOXEL_NO_DOCKER_BOOTSTRAP=1 if you are certain — e.g. a CI
# sandbox that matches the same shape.
if [ "${BOXEL_NO_DOCKER_BOOTSTRAP:-}" != "1" ]; then
  reason=""
  if [ "$(id -u)" != "0" ]; then
    reason="it needs to be root (it writes to /usr/local/bin, /usr/bin and /var/lib)"
  elif [ ! -d /root/.ccr ]; then
    # The agent-proxy config directory: present in a Claude Code session
    # container, absent on a workstation.
    reason="this does not look like a Claude Code session container (no /root/.ccr)"
  elif docker info >/dev/null 2>&1 && docker pull hello-world >/dev/null 2>&1; then
    reason="Docker can pull images here, so the normal stack works"
  fi
  if [ -n "$reason" ]; then
    cat >&2 <<EOF
[bootstrap] Refusing to run: $reason.

This script is only for a Claude Code web session whose egress policy blocks
the container-registry blob CDNs. On any machine where Docker can pull, use
the normal path instead:

  mise run dev              # the dev stack
  mise run test-services:host   # the stack the host test suite runs against

Set BOXEL_NO_DOCKER_BOOTSTRAP=1 to override.
EOF
    exit 1
  fi
fi

NODE_VERSION="$(sed -n 's/^node = "\(.*\)"$/\1/p' .mise.toml | head -1)"
PNPM_VERSION="$(sed -n 's/^"npm:pnpm" = "\(.*\)"$/\1/p' .mise.toml | head -1)"
NODE_PREFIX="/opt/node${NODE_VERSION%%.*}"
PG_BIN=/usr/lib/postgresql/16/bin
PGDATA_DIR=/var/lib/boxel-pgdata
CERT_DIR="$HOME/.local/share/boxel/dev-certs"
SHIM_BIN="$HOME/.local/share/boxel/no-docker-bin"

echo "[bootstrap] node=$NODE_VERSION pnpm=$PNPM_VERSION"

# 1. Toolchain. mise.run is denied by the egress policy, but nodejs.org and
#    registry.npmjs.org are reachable, so install the pinned node directly and
#    let its npm install the pinned pnpm.
if [ ! -x "$NODE_PREFIX/bin/node" ] || [ "$("$NODE_PREFIX/bin/node" --version 2>/dev/null)" != "v$NODE_VERSION" ]; then
  echo "[bootstrap] Installing node $NODE_VERSION from nodejs.org…"
  curl -sSL -o /tmp/node.tar.xz \
    "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
  mkdir -p "$NODE_PREFIX"
  tar -xJf /tmp/node.tar.xz -C "$NODE_PREFIX" --strip-components=1
  rm -f /tmp/node.tar.xz
fi
export PATH="$NODE_PREFIX/bin:$PATH"
if [ "$(pnpm --version 2>/dev/null)" != "$PNPM_VERSION" ]; then
  echo "[bootstrap] Installing pnpm $PNPM_VERSION…"
  npm i -g "pnpm@$PNPM_VERSION" >/dev/null
fi

# 2. The mise shim, so the repo's own mise-tasks/ scripts run as written. It is
#    deliberately NOT installed system-wide: it goes in its own directory, and
#    only the env file written in step 6 puts that directory on PATH. Nothing
#    outside a shell that sourced that file — including a real mise, if this
#    session has one — is shadowed.
#
#    Within those shells the shim does take precedence over a real mise, and
#    has to: `MISE_SHIM_SKIP` is the only way to no-op `infra:ensure-pg`, and a
#    real mise would run that dependency and try to start the container that
#    cannot be pulled here.
echo "[bootstrap] Installing the mise shim in $SHIM_BIN…"
mkdir -p "$SHIM_BIN"
cp "$SKILL_DIR/claude-web-no-docker-mise-shim.sh" "$SHIM_BIN/mise"
chmod +x "$SHIM_BIN/mise"

# 3. Chrome. The image ships Playwright's chromium but no `google-chrome`, and
#    both env-vars.sh (PUPPETEER_EXECUTABLE_PATH, for the prerender) and testem
#    (its Chrome launcher) look for one on the standard paths.
CHROME="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | tail -1 || true)"
if [ -n "$CHROME" ] && [ ! -e /usr/bin/google-chrome ]; then
  echo "[bootstrap] Linking $CHROME as /usr/bin/google-chrome…"
  ln -sf "$CHROME" /usr/bin/google-chrome
fi

# 4. mkcert + the dev TLS cert. The realm-server and vite speak HTTPS+HTTP/2 in
#    every mode — there is no plain-HTTP fallback — so this is mandatory.
if ! command -v mkcert >/dev/null 2>&1; then
  echo "[bootstrap] Installing mkcert + libnss3-tools…"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mkcert libnss3-tools >/dev/null
fi
mkcert -install >/dev/null 2>&1 || true
# Chromium reads NSS, not the system store, and mkcert only populates the NSS
# DB when one already exists. `infra:ensure-dev-cert` refuses to run until both
# are trusted.
if [ ! -d "$HOME/.pki/nssdb" ]; then
  mkdir -p "$HOME/.pki/nssdb"
  certutil -N -d "sql:$HOME/.pki/nssdb" --empty-password
fi
if ! certutil -d "sql:$HOME/.pki/nssdb" -L 2>/dev/null | grep -q mkcert; then
  certutil -A -d "sql:$HOME/.pki/nssdb" -t "C,," -n "mkcert development CA" \
    -i "$(mkcert -CAROOT)/rootCA.pem"
fi
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/localhost.pem" ]; then
  echo "[bootstrap] Generating the dev leaf cert…"
  # Same SAN set as mise-tasks/infra/ensure-dev-cert builds for standard mode.
  mkcert -cert-file "$CERT_DIR/localhost.pem" -key-file "$CERT_DIR/localhost-key.pem" \
    localhost user.localhost 127.0.0.1 ::1 '*.boxel-dev.localhost' published.realm
fi
# Node has to trust the proxy CA (outbound) and the mkcert leaf (loopback) at
# once, and NODE_EXTRA_CA_CERTS takes a single file.
if [ -n "${NODE_EXTRA_CA_CERTS:-}" ] && [ -f "${NODE_EXTRA_CA_CERTS}" ] &&
  [ "${NODE_EXTRA_CA_CERTS}" != "$CERT_DIR/combined-ca.pem" ]; then
  cat "${NODE_EXTRA_CA_CERTS}" "$(mkcert -CAROOT)/rootCA.pem" > "$CERT_DIR/combined-ca.pem"
elif [ ! -f "$CERT_DIR/combined-ca.pem" ]; then
  cp "$(mkcert -CAROOT)/rootCA.pem" "$CERT_DIR/combined-ca.pem"
fi

# 5. Native postgres in place of the boxel-pg container, on the port
#    env-vars.sh hands every service (PGPORT=5435), with the container's
#    max_connections so a full stack's pools fit.
if [ ! -d "$PGDATA_DIR" ]; then
  echo "[bootstrap] Initializing a native postgres cluster at $PGDATA_DIR…"
  mkdir -p "$PGDATA_DIR" /var/run/postgresql
  chown postgres:postgres "$PGDATA_DIR" /var/run/postgresql
  su postgres -s /bin/bash -c "$PG_BIN/initdb -D $PGDATA_DIR -U postgres --auth=trust" >/dev/null
  cat >> "$PGDATA_DIR/postgresql.conf" <<'EOF'
listen_addresses = '127.0.0.1'
port = 5435
max_connections = 400
EOF
fi
if ! "$PG_BIN/pg_isready" -h 127.0.0.1 -p 5435 >/dev/null 2>&1; then
  echo "[bootstrap] Starting postgres…"
  su postgres -s /bin/bash -c "$PG_BIN/pg_ctl -D $PGDATA_DIR -l /tmp/pg.log start" >/dev/null
  for _ in $(seq 1 30); do
    "$PG_BIN/pg_isready" -h 127.0.0.1 -p 5435 >/dev/null 2>&1 && break
    sleep 1
  done
fi
for db in boxel boxel_test; do
  if ! psql -h 127.0.0.1 -p 5435 -U postgres -lqt | cut -d '|' -f1 | grep -qw "$db"; then
    psql -h 127.0.0.1 -p 5435 -U postgres -q -c "CREATE DATABASE $db"
    echo "[bootstrap] Created database $db"
  fi
done

# 6. The env every later shell needs. Sourced rather than exported so a fresh
#    Bash tool call can pick it up.
cat > /tmp/boxel-env.sh <<EOF
export PATH="$SHIM_BIN:$NODE_PREFIX/bin:\$PATH"
cd "$REPO_ROOT"
. "$REPO_ROOT/mise-tasks/lib/env-vars.sh"
export NODE_EXTRA_CA_CERTS="$CERT_DIR/combined-ca.pem"
export NODE_NO_WARNINGS=1
export PUPPETEER_DISABLE_SANDBOX=true
export SKIP_CATALOG=true
export SKIP_BOXEL_HOMEPAGE=true
export SKIP_EXPERIMENTS=true
export SKIP_SUBMISSION=true
export SKIP_SOFTWARE_FACTORY=true
# Postgres is native here, so the task that starts (and health-checks) the
# boxel-pg container has nothing to do.
export MISE_SHIM_SKIP="infra:ensure-pg"
# No Synapse to read the registration secret from; the realm-server only
# requires the variable to be non-empty at boot.
export MATRIX_REGISTRATION_SHARED_SECRET="\${MATRIX_REGISTRATION_SHARED_SECRET:-xxxx}"
export NODE_OPTIONS="--require $REPO_ROOT/.devcontainer/claude-web-h2-preload.cjs --max-old-space-size=8192"
EOF
# shellcheck disable=SC1091
. /tmp/boxel-env.sh

# 7. Dependencies and the builds the stack serves. Puppeteer's own Chrome
#    download is a blocked-CDN fetch, so point it at the browser from step 3.
export PUPPETEER_SKIP_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
if [ ! -d node_modules ]; then
  echo "[bootstrap] pnpm install…"
  pnpm install --frozen-lockfile
fi
if [ ! -d packages/boxel-ui/dist ] || [ ! -d packages/boxel-icons/dist ]; then
  echo "[bootstrap] Building boxel-icons + boxel-ui…"
  mise run build:ui
fi
if [ ! -d packages/skills-realm/contents/Skill ]; then
  echo "[bootstrap] Cloning the skills realm content…"
  pnpm --dir packages/skills-realm skills:setup
fi

# 8. Schema for both databases. The services migrate on their own way up, but
#    doing it here fails loudly and early if postgres is wrong.
echo "[bootstrap] Migrating boxel + boxel_test…"
pnpm --dir=packages/realm-server migrate >/dev/null
PGDATABASE=boxel_test pnpm --dir=packages/realm-server migrate >/dev/null

echo
echo "[bootstrap] Done. Start the stack with:"
echo "  .claude/skills/claude-web-no-docker-stack/claude-web-no-docker-start-stack.sh"
