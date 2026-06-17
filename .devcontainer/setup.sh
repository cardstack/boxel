#!/bin/bash
# One-time setup after the container is created.
# Runs during Codespace build (or prebuild) — keep it idempotent.
# The host app is NOT built here; it's deployed via GitHub Actions
# (.github/workflows/codespaces-preview.yml) pointed back at this Codespace.
set -euo pipefail

cd /workspaces/boxel

# mise installs the exact Node + pnpm versions pinned in .mise.toml. `mise
# trust` is required because the repo's .mise.toml has not been trusted in a
# fresh container. Activate mise for this shell so the pinned tools are on PATH.
echo "==> Installing pinned toolchain via mise..."
~/.local/bin/mise trust
~/.local/bin/mise install
eval "$(~/.local/bin/mise activate bash)"

echo "==> Installing dependencies..."
mise exec -- pnpm install --frozen-lockfile

# Source-realm content lives in separate repos that are cloned on first setup.
# In a Codespace the GitHub token has access to these, so the https clone in
# each :setup script succeeds. These are also re-run (idempotently) when the
# realm server starts, but doing them here moves the clone cost into setup.
echo "==> Setting up skills realm..."
mise exec -- pnpm --dir=packages/skills-realm skills:setup

echo "==> Setting up catalog realm..."
mise exec -- pnpm --dir=packages/catalog catalog:setup
mise exec -- pnpm --dir=packages/catalog catalog:update

# Database schema is created on demand: infra:ensure-pg starts the boxel-pg
# container and creates the databases, and the realm server runs with
# --migrateDB to apply migrations. Both happen in start-services.sh.
echo "==> Setup complete. Backend services will start automatically."
