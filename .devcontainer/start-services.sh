#!/bin/bash
# Start backend services for PR review in Codespaces.
# The host app is NOT built here — a GitHub Actions workflow builds and
# deploys it to S3 with URLs pointing back at this Codespace.
set -euo pipefail

cd /workspaces/boxel

CODESPACE_NAME="${CODESPACE_NAME:?CODESPACE_NAME must be set}"
GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"

# Derived Codespace URLs for forwarded ports
export REALM_SERVER_URL="https://${CODESPACE_NAME}-4201.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
export MATRIX_URL="https://${CODESPACE_NAME}-8008.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
export ICONS_URL="https://${CODESPACE_NAME}-4206.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"

# Common env vars for realm-server processes
export NODE_ENV=development
export NODE_NO_WARNINGS=1
export PGHOST="${PGHOST:-postgres}"
export PGPORT="${PGPORT:-5432}"
export PGDATABASE="${PGDATABASE:-boxel}"
export LOG_LEVELS='*=info'
export REALM_SERVER_SECRET_SEED="mum's the word"
export REALM_SECRET_SEED="shhh! it's a secret"
export REALM_SERVER_MATRIX_USERNAME=realm_server
export ENABLE_FILE_WATCHER=true

# ── Postgres is already running via docker-compose ──

# ── Make forwarded ports public so the S3 preview can reach them ──
echo "==> Making forwarded ports public..."
gh codespace ports visibility 4201:public 4206:public 8008:public -c "$CODESPACE_NAME" 2>/dev/null || true

# ── Matrix/Synapse ──
echo "==> Starting Matrix/Synapse..."
(cd packages/matrix && MATRIX_URL=http://localhost:8008 pnpm assert-synapse-running) &
SYNAPSE_PID=$!

# ── SMTP (MailHog) ──
echo "==> Starting SMTP server..."
(cd packages/matrix && pnpm assert-smtp-running) &

# ── Icons server ──
echo "==> Starting icons server..."
pnpm --dir=packages/realm-server run start:icons &

# ── Prerender service ──
echo "==> Starting prerender services..."
pnpm --dir=packages/realm-server run start:prerender-dev &
pnpm --dir=packages/realm-server run start:prerender-manager-dev &

# ── Worker ──
echo "==> Starting worker..."
pnpm --dir=packages/realm-server run start:worker-development &

# Wait for Synapse before starting the realm server
wait $SYNAPSE_PID || true

# ── Realm server ──
echo "==> Starting realm server..."
SKIP_EXPERIMENTS=true \
SKIP_BOXEL_HOMEPAGE=true \
SKIP_SUBMISSION=true \
MATRIX_URL=http://localhost:8008 \
  pnpm --dir=packages/realm-server ts-node \
    --transpileOnly main \
    --port=4201 \
    --matrixURL=http://localhost:8008 \
    --realmsRootPath=./realms/codespaces \
    --prerendererUrl=http://localhost:4221 \
    --migrateDB \
    --workerManagerPort=4213 \
    \
    --path='../base' \
    --username='base_realm' \
    --fromUrl='https://cardstack.com/base/' \
    --toUrl="${REALM_SERVER_URL}/base/" \
    \
    --path='../catalog-realm' \
    --username='catalog_realm' \
    --fromUrl='@cardstack/catalog/' \
    --toUrl="${REALM_SERVER_URL}/catalog/" \
    \
    --path='../skills-realm/contents' \
    --username='skills_realm' \
    --fromUrl="${REALM_SERVER_URL}/skills/" \
    --toUrl="${REALM_SERVER_URL}/skills/" \
    \
    --path='../catalog-new/contents' \
    --username='catalog_new_realm' \
    --fromUrl="${REALM_SERVER_URL}/catalog-new/" \
    --toUrl="${REALM_SERVER_URL}/catalog-new/" &
REALM_PID=$!

# ── Wait for realm server readiness ──
echo "==> Waiting for realm server to be ready..."
timeout 300 bash -c \
  'until curl -sf "http://localhost:4201/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson" >/dev/null 2>&1; do sleep 2; done' \
  || echo "Warning: realm server readiness check timed out after 5 minutes"

# ── Trigger host preview build via GitHub Actions ──
echo "==> Triggering host preview build pointed at this Codespace..."
BRANCH_NAME="$(git rev-parse --abbrev-ref HEAD)"
gh workflow run codespaces-preview.yml \
  --ref "$BRANCH_NAME" \
  -f codespace_name="$CODESPACE_NAME" \
  -f realm_server_url="$REALM_SERVER_URL" \
  -f matrix_url="$MATRIX_URL" \
  -f icons_url="$ICONS_URL" \
  || echo "Warning: could not trigger preview build. Run manually with: gh workflow run codespaces-preview.yml"

echo ""
echo "============================================"
echo "  Backend services running!"
echo ""
echo "  Realm server:  ${REALM_SERVER_URL}"
echo "  Matrix:        ${MATRIX_URL}"
echo "  Icons:         ${ICONS_URL}"
echo ""
echo "  Host preview build triggered — check the"
echo "  PR for a preview link once it completes."
echo "============================================"

# Keep the script alive
wait
