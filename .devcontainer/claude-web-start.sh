#!/usr/bin/env bash
# Per-session start for the Boxel stack in "Claude Code on the web". Run after
# .devcontainer/claude-web-setup.sh has provisioned the snapshot. Services do
# not persist in the cached snapshot, so this runs every session.
#
# What this handles that plain `mise run dev` does not, in this environment:
#   - dev-all, not dev: the VM is headless, so the host app must run in-process
#     (see the note in claude-web-setup.sh).
#   - Docker: the daemon isn't running at session start; bring it up so the
#     Synapse / Postgres / SMTP containers can launch.
#   - CA bundle: point Node at the combined proxy+mkcert bundle so the
#     realm-server can verify the host's mkcert leaf over loopback while still
#     trusting the agent proxy for outbound HTTPS (see claude-web-setup.sh).
#   - Matrix users: standard dev assumes the realm/bot users are already
#     registered (full-reset does it). On this fresh Synapse they are not, so
#     the realm-server's Matrix login 403s and it runs without broadcasting.
#     ensure-synapse only auto-registers in environment mode, so do it here —
#     BEFORE the stack boots, so the realm-server logs in cleanly. The
#     registration script is idempotent (skips users that already exist).
#   - Chromium sandbox: the prerender's headless Chrome can't sandbox as root,
#     so PUPPETEER_DISABLE_SANDBOX makes its standby probe pass.
#   - SKIP_CATALOG / SKIP_BOXEL_HOMEPAGE: fit the memory budget and skip the
#     realm whose content repo this VM can't clone.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export PATH="$HOME/.local/bin:$PATH"
eval "$(mise activate bash)"

# Docker daemon: start it if the socket isn't responding. Containers and their
# images are cached in the snapshot, but the daemon process is not.
if ! docker info >/dev/null 2>&1; then
  echo "[start] Starting Docker daemon…"
  (dockerd >/tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  docker info >/dev/null 2>&1 || { echo "[start] Docker failed to start; see /tmp/dockerd.log" >&2; exit 1; }
fi

# Trust both the agent proxy CA (outbound) and the mkcert leaf (loopback).
COMBINED="$HOME/.local/share/boxel/dev-certs/combined-ca.pem"
if [ -f "$COMBINED" ]; then
  export NODE_EXTRA_CA_CERTS="$COMBINED"
fi

# Register Matrix users on a fresh Synapse, once, before the stack boots, so
# the realm-server logs in cleanly instead of caching a failed session.
# register-all needs BOTH the Postgres container (it gates on `pg_isready`)
# and Synapse, so bring both up first; dev-all's own start:pg / start:matrix
# then see them already running and move on.
echo "[start] Ensuring Postgres + Synapse are up for Matrix user registration…"
mise run infra:ensure-pg
mise run infra:start-synapse
for _ in $(seq 1 60); do
  curl -sf -o /dev/null --max-time 5 http://localhost:8008/_matrix/client/versions && break
  sleep 2
done
echo "[start] Registering Matrix users (idempotent)…"
mise exec -- pnpm --dir=packages/matrix register-all || true

# Restore the realm index from the CI cache if one's available, so the stack
# comes up without re-rendering every card. On success, tell the realm-server
# to trust the imported index instead of doing a full index on startup.
FULL_INDEX_FLAG=""
if "$REPO_ROOT/.devcontainer/claude-web-import-index.sh"; then
  FULL_INDEX_FLAG="REALM_SERVER_FULL_INDEX_ON_STARTUP=false"
fi

echo "[start] Launching the stack (mise run dev-all)…"
exec env \
  SKIP_CATALOG=true \
  SKIP_BOXEL_HOMEPAGE=true \
  PUPPETEER_DISABLE_SANDBOX=true \
  ${FULL_INDEX_FLAG} \
  mise run dev-all
