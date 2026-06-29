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
# This script only PROVISIONS (deps + dev cert + source realms). Start the
# stack PER SESSION (services don't persist in the cached snapshot) with:
#
#     SKIP_CATALOG=true mise run dev
#
# (or a lighter variant: `dev-without-matrix`, `dev-minimal`).
#
# Cloud environment settings to set in the claude.ai/code UI:
#   - Network access: "Full" (or a custom allowlist) — needed for OpenRouter,
#     GitHub, Docker Hub, and the icon CDN (boxel-icons.boxel.ai).
#   - RAM ceiling is ~16 GB, so the catalog realm (by far the heaviest to index,
#     ~1000+ files) is skipped via SKIP_CATALOG to stay within budget.
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

# Local-dev TLS cert: standard dev serves HTTPS on localhost and env-vars.sh
# treats the cert as mandatory. Provisioning it here also lets Node (via
# NODE_EXTRA_CA_CERTS, set by env-vars.sh) and the prerender's headless Chrome
# trust https://localhost — and because localhost IS an https-loopback,
# browser-manager.ts auto-adds --ignore-certificate-errors (no extra config).
mise run infra:ensure-dev-cert

# Source realms live in separate repos; clone over HTTPS (no SSH key in the VM).
# Catalog is intentionally NOT cloned here — it's skipped at runtime to fit the
# memory budget. Add `pnpm --dir=packages/catalog catalog:setup` if you need it.
git config --global url."https://github.com/".insteadOf "git@github.com:"
mise exec -- pnpm --dir=packages/skills-realm skills:setup

# Note: the first `mise run dev` pulls the Synapse/Postgres Docker images; the
# cloud snapshot caches them so later sessions start faster.

echo ""
echo "Provisioning complete. Start the stack (catalog skipped) with:"
echo "    SKIP_CATALOG=true mise run dev"
echo "Realm: https://localhost:4201   Host: https://localhost:4200"
