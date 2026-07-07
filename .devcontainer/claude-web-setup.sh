#!/usr/bin/env bash
# Provisioning for running the Boxel stack in "Claude Code on the web"
# (claude.ai/code). Point the cloud environment's *Setup Script* at this file.
#
# The cloud VM runs the whole stack on localhost, so this just uses the repo's
# STANDARD dev tooling (`mise run dev`): the realm is at https://localhost:4201,
# the migration-seeded permissions already match that localhost default, and
# the worker/prerender reach it directly. No reverse proxy, TLS shim, or URL
# rewriting is needed — it's normal local dev, provisioned for a headless
# root cloud VM (see the synapse root/no-IPv6 handling in
# packages/matrix/support/synapse/index.ts).
#
# This script only PROVISIONS (deps + mkcert + dev cert + CA bundle + source
# realms). Start the stack PER SESSION (services don't persist in the cached
# snapshot) with the companion start script, which sets the env vars this
# environment needs and registers Matrix users on a fresh Synapse:
#
#     .devcontainer/claude-web-start.sh
#
# It runs `mise run dev-all` (NOT `mise run dev`): the cloud VM is headless, so
# the host app must run in-process here. `dev` starts only the backend and
# leaves the host to a second terminal that this environment doesn't have —
# the prerender then waits forever for https://localhost:4200 and the whole
# stack fails. `dev-all` brings up the host first, then the same backend.
#
# Cloud environment settings to set in the claude.ai/code UI:
#   - Network access: "Full" (or a custom allowlist) — needed for OpenRouter,
#     GitHub, Docker Hub, and the icon CDN (boxel-icons.boxel.ai).
#   - RAM ceiling is ~16 GB, so the catalog realm (by far the heaviest to index,
#     ~1000+ files) is skipped via SKIP_CATALOG to stay within budget. The
#     boxel-homepage realm lives in a private repo this VM can't clone, so it's
#     skipped too (SKIP_BOXEL_HOMEPAGE) — both are set by the start script.
set -euo pipefail

# Toolchain — mise pins the exact node/pnpm/ts-node from .mise.toml.
if ! command -v mise >/dev/null 2>&1; then
  curl https://mise.run | MISE_INSTALL_PATH="$HOME/.local/bin/mise" sh
  export PATH="$HOME/.local/bin:$PATH"
fi
eval "$(mise activate bash)"
mise trust
mise install

# Dependencies.
mise exec -- pnpm install --frozen-lockfile

# Build the boxel-icons + boxel-ui addons (in dependency order). The host app's
# vite build imports per-icon modules from @cardstack/boxel-icons/dist, which
# `pnpm install` does not produce — without this the host fails to build with
# "Cannot find module '@cardstack/boxel-icons/...'" and never serves.
mise run build:ui

# mkcert provisions the local-dev CA + leaf cert; infra:ensure-dev-cert fails
# hard if it's missing. The base cloud image doesn't ship it, so install it
# (and libnss3-tools, which mkcert -install needs to write the NSS trust DB).
# --allow-releaseinfo-change: the base image carries third-party PPAs whose
# release metadata drifts (a Label change makes plain `apt-get update` exit
# non-zero for the whole run, killing this script under `set -e`), and mkcert
# comes from the stock ubuntu archive anyway.
if ! command -v mkcert >/dev/null 2>&1; then
  SUDO=""
  [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
  $SUDO apt-get update -y --allow-releaseinfo-change
  $SUDO apt-get install -y mkcert libnss3-tools
fi

# Local-dev TLS cert: standard dev serves HTTPS on localhost and env-vars.sh
# treats the cert as mandatory. Provisioning it here also lets Node (via
# NODE_EXTRA_CA_CERTS, set by env-vars.sh) and the prerender's headless Chrome
# trust https://localhost — and because localhost IS an https-loopback,
# browser-manager.ts auto-adds --ignore-certificate-errors (no extra config).
mise run infra:ensure-dev-cert

# Combined CA bundle. This cloud environment routes outbound HTTPS through an
# agent proxy and pre-sets NODE_EXTRA_CA_CERTS to the proxy's CA bundle. Node
# reads NODE_EXTRA_CA_CERTS as a SINGLE file (not a list), and env-vars.sh
# only points it at mkcert's rootCA when it's unset — so the proxy value wins
# and Node never trusts the mkcert leaf. The realm-server's startup fetch of
# the host (https://localhost:4200) then fails with
# UNABLE_TO_VERIFY_LEAF_SIGNATURE and it crash-loops. Concatenate the proxy
# bundle and mkcert's rootCA into one file so Node trusts BOTH the proxy
# (outbound) and the local leaf (loopback); the start script exports
# NODE_EXTRA_CA_CERTS at it. No-op when the env doesn't pre-set a proxy CA.
if [ -n "${NODE_EXTRA_CA_CERTS:-}" ] && [ -f "${NODE_EXTRA_CA_CERTS}" ]; then
  CAROOT="$(mkcert -CAROOT)"
  COMBINED="$HOME/.local/share/boxel/dev-certs/combined-ca.pem"
  cat "${NODE_EXTRA_CA_CERTS}" "${CAROOT}/rootCA.pem" > "$COMBINED"
  echo "Wrote combined CA bundle (proxy + mkcert) to $COMBINED"
fi

# Warm vite's dependency-optimizer cache (packages/host/node_modules/.vite)
# so it rides into the snapshot. The host's dep graph takes the optimizer
# ~3 minutes to bundle on a cold boot, during which the prerender's
# wait-for-host-standby probe burns through repeated 30s navigation timeouts —
# so pay that cost once here instead of in every fresh environment's first
# session. `vite optimize` cannot do this (the embroider plugin pipeline hangs
# under the bare CLI command), so boot the real dev server and wait for the
# optimizer to commit its cache; the result is hash-identical to what a stack
# boot produces, so sessions reuse it as-is. Best-effort: on timeout the first
# stack start just optimizes live, as it would have anyway.
VITE_METADATA="packages/host/node_modules/.vite/deps/_metadata.json"
if [ ! -f "$VITE_METADATA" ]; then
  echo "Warming vite dep-optimizer cache (boots the host once; ~3 minutes)…"
  setsid mise exec -- pnpm --dir=packages/host start > /tmp/vite-warm.log 2>&1 &
  for _ in $(seq 1 60); do
    [ -f "$VITE_METADATA" ] && break
    sleep 10
  done
  if [ -f "$VITE_METADATA" ]; then
    # The optimizer can run a second discovery pass shortly after its first
    # commit; wait for the metadata to go quiet before shutting down.
    for _ in $(seq 1 10); do
      BEFORE=$(stat -c %Y "$VITE_METADATA")
      sleep 20
      [ "$BEFORE" = "$(stat -c %Y "$VITE_METADATA")" ] && break
    done
    echo "vite dep cache warmed."
  else
    echo "vite dep cache did not appear within 10 minutes; first stack start will optimize live (see /tmp/vite-warm.log)." >&2
  fi
  # setsid ran the server in its own process group (setsid itself may fork
  # and exit, so $! is not reliable); kill the whole group via the group id
  # of the vite launcher.
  WARM_PID=$(pgrep -f 'scripts/vite-serve.js' | head -1) || true
  if [ -n "${WARM_PID:-}" ]; then
    PGID=$(ps -o pgid= -p "$WARM_PID" | tr -d ' ') || true
    if [ -n "${PGID:-}" ]; then
      kill -- "-$PGID" 2>/dev/null || true
    fi
  fi
fi

# Source realms live in separate repos; clone over HTTPS (no SSH key in the VM).
# Catalog is intentionally NOT cloned here — it's skipped at runtime to fit the
# memory budget. Add `pnpm --dir=packages/catalog catalog:setup` if you need it.
git config --global url."https://github.com/".insteadOf "git@github.com:"
mise exec -- pnpm --dir=packages/skills-realm skills:setup

# Pre-pull the stack's third-party Docker images so the snapshot caches them
# and the first session's stack start doesn't spend time pulling. The daemon
# isn't running during provisioning, so bring it up first (the start script
# does the same per session). Image refs must track their sources:
#   postgres            — mise-tasks/infra/ensure-pg
#   matrixdotorg/synapse — packages/matrix/support/synapse/index.ts
#   rnwood/smtp4dev     — packages/matrix/docker/smtp4dev.ts
# Best-effort: on failure the images are simply pulled at first stack start,
# as before.
if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker daemon to pre-pull images…"
  (dockerd >/tmp/dockerd-setup.log 2>&1 &)
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi
if docker info >/dev/null 2>&1; then
  for image in postgres:16.3 matrixdotorg/synapse:v1.126.0 rnwood/smtp4dev:v3.1; do
    docker pull "$image" || echo "Pre-pull of $image failed; it will be pulled at first stack start." >&2
  done
else
  echo "Docker daemon unavailable; images will be pulled at first stack start (see /tmp/dockerd-setup.log)." >&2
fi

echo ""
echo "Provisioning complete. Start the stack with:"
echo "    .devcontainer/claude-web-start.sh"
echo "Realm: https://localhost:4201   Host: https://localhost:4200"
