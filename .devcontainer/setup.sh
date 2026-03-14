#!/bin/bash
# One-time setup after the container is created.
# Runs during Codespace build (or prebuild) — keep it idempotent.
# The host app is NOT built here; it's deployed via GitHub Actions.
set -euo pipefail

echo "==> Installing dependencies..."
pnpm install --frozen-lockfile

echo "==> Running database migrations..."
cd packages/postgres
PGHOST="${PGHOST:-postgres}" PGPORT="${PGPORT:-5432}" pnpm migrate up
cd /workspaces/boxel

echo "==> Setting up skills realm..."
pnpm --dir=packages/skills-realm skills:setup

echo "==> Setup complete. Backend services will start automatically."
