#!/bin/bash
# Start backend services for PR review in Codespaces.
#
# The reviewer-facing host app is NOT built here — a GitHub Actions workflow
# (.github/workflows/codespaces-preview.yml) builds it and deploys it to S3
# with URLs pointing back at this Codespace's forwarded ports.
#
# The services run plain HTTP locally; GitHub's port forwarding terminates
# TLS at the edge (https://<name>-<port>.app.github.dev). This deliberately
# bypasses the repo's standard local-dev HTTPS path (mkcert + the mandatory
# `infra:ensure-dev-cert`), which is why the realm server is launched by hand
# below rather than via `mise run dev` / `start:development`.
#
# Known limitation: card *prerendering* needs a host app for the prerenderer
# to render against, which is not run in the Codespace. The realm server is
# therefore started in mount-and-serve mode (REALM_SERVER_SKIP_BOOT_INDEX),
# so it comes up immediately and serves modules/source; prerendered card
# rendering and search are degraded until a host is wired up for the
# prerenderer (follow-up).
set -euo pipefail

cd /workspaces/boxel

# mise provides the pinned node/pnpm/ts-node toolchain.
eval "$(~/.local/bin/mise activate bash)"

CODESPACE_NAME="${CODESPACE_NAME:?CODESPACE_NAME must be set}"
FWD_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"

# Public Codespace URLs for the forwarded ports — TLS terminated at the
# GitHub edge. These become the realms' public identities (toUrl) and are
# passed to the host build so the S3-hosted preview can reach this backend.
export REALM_SERVER_URL="https://${CODESPACE_NAME}-4201.${FWD_DOMAIN}"
export MATRIX_PUBLIC_URL="https://${CODESPACE_NAME}-8008.${FWD_DOMAIN}"
export ICONS_PUBLIC_URL="https://${CODESPACE_NAME}-4206.${FWD_DOMAIN}"

# Internal service-to-service wiring is plain HTTP on the standard ports.
# Exported so the repo's mise service tasks (which source
# mise-tasks/lib/env-vars.sh) target HTTP localhost rather than the default
# https://localhost:4201 — there is no dev cert here, so HTTPS would fail.
export REALM_BASE_URL="http://localhost:4201"
export MATRIX_URL="http://localhost:8008"
export MATRIX_URL_VAL="http://localhost:8008"
export ICONS_URL="http://localhost:4206"
export PGPORT=5435
export PGDATABASE=boxel

# Mount-and-serve: skip the from-scratch boot index (see "Known limitation"
# above). Without this, a brand-new realm's readiness check blocks on a full
# index that needs the prerenderer + a host, which the Codespace lacks.
export REALM_SERVER_SKIP_BOOT_INDEX=true

# ── Make forwarded ports public so the S3 preview can reach them ──
echo "==> Making forwarded ports public..."
gh codespace ports visibility 4201:public 4206:public 8008:public -c "$CODESPACE_NAME" 2>/dev/null || true

# ── Postgres (boxel-pg container) + databases ──
echo "==> Ensuring Postgres is running..."
mise run infra:ensure-pg

# ── Matrix/Synapse ──
echo "==> Starting Matrix/Synapse..."
(cd packages/matrix && MATRIX_URL=http://localhost:8008 pnpm assert-synapse-running) &
SYNAPSE_PID=$!

# ── SMTP (MailHog) ──
echo "==> Starting SMTP server..."
(cd packages/matrix && pnpm assert-smtp-running) &

# ── Icons / prerender / worker (best-effort; see "Known limitation") ──
echo "==> Starting icons server..."
pnpm --dir=packages/realm-server run start:icons &

echo "==> Starting prerender services..."
pnpm --dir=packages/realm-server run start:prerender-manager-dev &
pnpm --dir=packages/realm-server run start:prerender-dev &

echo "==> Starting worker..."
pnpm --dir=packages/realm-server run start:worker-development &

# Wait for Synapse before starting the realm server (it registers the
# realm_server Matrix user during boot).
wait $SYNAPSE_PID || true

# Synapse's registration shared secret is needed to register the
# realm_server Matrix user. Read it from the running Synapse config, the
# same way mise-tasks/services/realm-server does.
if [ -z "${MATRIX_REGISTRATION_SHARED_SECRET:-}" ]; then
  MATRIX_REGISTRATION_SHARED_SECRET=$(pnpm --dir=packages/realm-server exec ts-node --transpileOnly scripts/matrix-registration-secret.ts)
  export MATRIX_REGISTRATION_SHARED_SECRET
fi

# ── Realm server ──
# Launched by hand (not via mise) to run plain HTTP and skip the dev-cert
# requirement. toUrls are the public Codespace URLs so the S3 host resolves
# realms back to this backend. Realm layout matches mise-tasks/services/
# realm-server: base, catalog, skills, openrouter (experiments / homepage /
# submission / software-factory are skipped to keep the preview lean).
echo "==> Starting realm server..."
SKIP_EXPERIMENTS=true \
SKIP_BOXEL_HOMEPAGE=true \
SKIP_SUBMISSION=true \
SKIP_SOFTWARE_FACTORY=true \
NODE_ENV=development \
NODE_NO_WARNINGS=1 \
PGPORT=5435 \
PGDATABASE=boxel \
LOG_LEVELS='*=info' \
REALM_SERVER_SECRET_SEED="mum's the word" \
REALM_SECRET_SEED="shhh! it's a secret" \
MATRIX_URL=http://localhost:8008 \
REALM_SERVER_MATRIX_USERNAME=realm_server \
ENABLE_FILE_WATCHER=true \
REALM_SERVER_SKIP_BOOT_INDEX=true \
  pnpm --dir=packages/realm-server exec ts-node \
    --transpileOnly main \
    --port=4201 \
    --matrixURL=http://localhost:8008 \
    --realmsRootPath=./realms/codespaces \
    --prerendererUrl=http://localhost:4222 \
    --migrateDB \
    --workerManagerPort=4210 \
    \
    --path='../base' \
    --username='base_realm' \
    --fromUrl='https://cardstack.com/base/' \
    --toUrl="${REALM_SERVER_URL}/base/" \
    \
    --path='../catalog/contents' \
    --username='catalog_realm' \
    --fromUrl='@cardstack/catalog/' \
    --toUrl="${REALM_SERVER_URL}/catalog/" \
    \
    --path='../skills-realm/contents' \
    --username='skills_realm' \
    --fromUrl='@cardstack/skills/' \
    --toUrl="${REALM_SERVER_URL}/skills/" \
    \
    --path='../openrouter-realm' \
    --username='openrouter_realm' \
    --fromUrl='@cardstack/openrouter/' \
    --toUrl="${REALM_SERVER_URL}/openrouter/" &
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
  -f matrix_url="$MATRIX_PUBLIC_URL" \
  -f icons_url="$ICONS_PUBLIC_URL" \
  || echo "Warning: could not trigger preview build. Run manually with: gh workflow run codespaces-preview.yml"

echo ""
echo "============================================"
echo "  Backend services running!"
echo ""
echo "  Realm server:  ${REALM_SERVER_URL}"
echo "  Matrix:        ${MATRIX_PUBLIC_URL}"
echo "  Icons:         ${ICONS_PUBLIC_URL}"
echo ""
echo "  Host preview build triggered — check the"
echo "  PR for a preview link once it completes."
echo "============================================"

# Keep the realm server (and this script) in the foreground.
wait "$REALM_PID"
