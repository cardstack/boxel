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
mise trust
mise install
eval "$(mise activate bash)"

echo "==> Installing dependencies..."
mise exec -- pnpm install --frozen-lockfile

# Source-realm content lives in separate repos that are cloned on first setup.
# The catalog/skills :setup scripts try an SSH clone (git@github.com:) first,
# which blocks on an interactive host-key prompt in this non-interactive
# context. A Codespace has an HTTPS token credential helper but no SSH key,
# so rewrite SSH GitHub URLs to HTTPS — the clones then authenticate with the
# token (the repos are granted in devcontainer.json customizations.codespaces).
# These are also re-run idempotently when the realm server starts; doing them
# here moves the clone cost into setup.
git config --global url."https://github.com/".insteadOf "git@github.com:"

echo "==> Setting up skills realm..."
mise exec -- pnpm --dir=packages/skills-realm skills:setup

echo "==> Setting up catalog realm..."
mise exec -- pnpm --dir=packages/catalog catalog:setup
mise exec -- pnpm --dir=packages/catalog catalog:update

# No local TLS cert: the realm server serves plain HTTP, and GitHub's port
# forwarding terminates TLS at its edge (it forwards plain HTTP to the
# backend). If the realm served HTTPS it would 308-redirect the edge's
# plain-HTTP request to https://localhost:4201 — bouncing the browser to
# localhost. The prerender uses the public S3 host (already HTTPS), so
# nothing here needs a local cert.

# The host app is NOT built here. The realm server requires a reachable host
# (it fetches distURL at startup) and the prerenderer renders cards against
# it, but rather than build a second copy in the Codespace, start-services.sh
# points both at the host the codespaces-preview workflow already builds and
# deploys to S3 (a production, CloudFront-served bundle that loads far faster
# than a local dev build).

# Database schema is created on demand: infra:ensure-pg starts the boxel-pg
# container and creates the databases, and the realm server runs with
# --migrateDB to apply migrations. Both happen in start-services.sh.
echo "==> Setup complete. Backend services will start automatically."
