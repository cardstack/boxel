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

# The realm server, vite host and prerenderer all speak HTTPS in this repo
# (browsers only do HTTP/2 over TLS, which the prerender pipeline assumes).
# Generate a self-signed cert at the path env-vars.sh probes
# (~/.local/share/boxel/dev-certs) so it sets REALM_SERVER_TLS_CERT_FILE and
# HOST_URL=https for every mise service, and vite serves HTTPS too. The
# prerender's puppeteer ignores cert errors; Node trusts it via
# NODE_EXTRA_CA_CERTS (set in start-services.sh). mkcert isn't used — nothing
# here needs the cert in a browser/system trust store.
echo "==> Generating self-signed dev TLS cert..."
CERT_DIR="$HOME/.local/share/boxel/dev-certs"
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/localhost.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$CERT_DIR/localhost-key.pem" \
    -out "$CERT_DIR/localhost.pem" \
    -days 365 -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
fi

# Build the host app once into a static dist. The realm server requires a
# reachable host (it fetches distURL at startup) and the prerenderer renders
# cards against it. Serving a prebuilt dist (vite preview) avoids vite dev's
# multi-minute cold-start compile, whose slowness blew the prerender/worker/
# realm readiness timeouts. Built with the PUBLIC Codespace URLs so the
# served app and prerendered output reference hostnames the S3 reviewer host
# resolves. start-services.sh serves this dist on https://localhost:4200.
if [ -n "${CODESPACE_NAME:-}" ]; then
  FWD_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  REALM_SERVER_URL="https://${CODESPACE_NAME}-4201.${FWD_DOMAIN}"
  echo "==> Building host app (static dist) pointed at ${REALM_SERVER_URL}..."
  # boxel-ui addon must be built before the host build can resolve it
  # (the dev server does this inline; the build script does not).
  sh packages/boxel-ui/addon/bin/conditional-build.sh
  (
    cd packages/host
    REALM_SERVER_DOMAIN="${REALM_SERVER_URL}/" \
    RESOLVED_BASE_REALM_URL="${REALM_SERVER_URL}/base/" \
    RESOLVED_CATALOG_REALM_URL="${REALM_SERVER_URL}/catalog/" \
    RESOLVED_SKILLS_REALM_URL="${REALM_SERVER_URL}/skills/" \
    RESOLVED_OPENROUTER_REALM_URL="${REALM_SERVER_URL}/openrouter/" \
    MATRIX_URL="https://${CODESPACE_NAME}-8008.${FWD_DOMAIN}" \
    MATRIX_SERVER_NAME=localhost \
    ICONS_URL="https://${CODESPACE_NAME}-4206.${FWD_DOMAIN}" \
    pnpm build
  )
else
  echo "==> CODESPACE_NAME unset; skipping host build (not in a Codespace)."
fi

# Database schema is created on demand: infra:ensure-pg starts the boxel-pg
# container and creates the databases, and the realm server runs with
# --migrateDB to apply migrations. Both happen in start-services.sh.
echo "==> Setup complete. Backend services will start automatically."
