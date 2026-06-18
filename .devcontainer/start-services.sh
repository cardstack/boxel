#!/bin/bash
# Start backend services for PR review in Codespaces.
#
# The reviewer-facing host app is NOT built here — a GitHub Actions workflow
# (.github/workflows/codespaces-preview.yml) builds it and deploys it to S3
# with URLs pointing back at this Codespace's forwarded ports.
#
# Services run HTTPS locally (realm server :4201, vite host :4200) using the
# self-signed cert generated in setup.sh — the repo's prerender pipeline is
# HTTPS-only, so a plain-HTTP host yields ERR_SSL_PROTOCOL_ERROR. GitHub's
# port forwarding tunnels those https services out at the edge
# (https://<name>-<port>.app.github.dev). The realm server is launched by
# hand (not `mise run dev`) only so its realm toUrls can be the public
# Codespace URLs; it still picks up the HTTPS cert via env-vars.sh.
#
# A host app (vite) IS run locally because the realm server hard-requires a
# reachable host: main.ts fetches HOST_URL at startup and process.exit(-2)s
# if it can't (and the prerenderer renders cards against it). This local host
# is distinct from the reviewer-facing S3 build; it exists so the realm server
# boots and cards can prerender. The realm starts in mount-and-serve mode
# (REALM_SERVER_SKIP_BOOT_INDEX) so readiness doesn't block on a full
# from-scratch index; cards prerender on demand instead.
set -euo pipefail

cd /workspaces/boxel

# mise provides the pinned node/pnpm/ts-node toolchain.
eval "$(mise activate bash)"

CODESPACE_NAME="${CODESPACE_NAME:?CODESPACE_NAME must be set}"
FWD_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"

# Public Codespace URLs for the forwarded ports — TLS terminated at the
# GitHub edge. These become the realms' public identities (toUrl) and are
# passed to the host build so the S3-hosted preview can reach this backend.
export REALM_SERVER_URL="https://${CODESPACE_NAME}-4201.${FWD_DOMAIN}"
export MATRIX_PUBLIC_URL="https://${CODESPACE_NAME}-8008.${FWD_DOMAIN}"
export ICONS_PUBLIC_URL="https://${CODESPACE_NAME}-4206.${FWD_DOMAIN}"

# Internal wiring runs over HTTPS, matching the repo's standard dev stack.
# env-vars.sh (sourced by `mise activate` below and by every mise service)
# detects the self-signed cert generated in setup.sh and sets
# REALM_SERVER_TLS_CERT_FILE + HOST_URL=https + REALM_BASE_URL=https
# automatically — we deliberately do NOT override those to http, because the
# prerender pipeline is HTTPS-only and a mismatch yields ERR_SSL_PROTOCOL_ERROR.
# Matrix/icons stay http (Synapse/icons don't terminate TLS locally).
export MATRIX_URL="http://localhost:8008"
export ICONS_URL="http://localhost:4206"
export PGPORT=5435
export PGDATABASE=boxel

# Trust the self-signed cert in Node clients (the realm server's distURL fetch,
# the worker's realm reads). env-vars.sh only wires this via mkcert, which we
# don't use, so point it at the cert directly. Inherited by the mise services.
export NODE_EXTRA_CA_CERTS="$HOME/.local/share/boxel/dev-certs/localhost.pem"

# Mount-and-serve: skip the from-scratch boot index so readiness doesn't
# block on a full index of every bootstrap realm; cards prerender on demand.
export REALM_SERVER_SKIP_BOOT_INDEX=true

# Give the prerender's puppeteer standby probe headroom for vite's cold start.
export PRERENDER_STANDBY_TIMEOUT_MS="${PRERENDER_STANDBY_TIMEOUT_MS:-120000}"

# ── Make forwarded ports public so the S3 host can reach this backend ──
echo "==> Making forwarded ports public..."
gh codespace ports visibility 4201:public 4206:public 8008:public -c "$CODESPACE_NAME" 2>/dev/null || true

# ── Record this Codespace as the preview target (triggers the CI host build) ──
# Done up-front: the codespaces-preview workflow builds the host with THIS
# Codespace's URLs and deploys it to S3, and the realm server (distURL) + the
# prerenderer point at that S3 host. Pushing the target file rebuilds it for
# this Codespace; the already-deployed S3 host stays usable in the meantime.
echo "==> Recording Codespace target for the preview workflow..."
TARGET_FILE=".devcontainer/codespace-target.env"
cat > "$TARGET_FILE" <<EOF
# Written by .devcontainer/start-services.sh when a Codespace boots.
# The codespaces-preview workflow reads this to point the host build at this
# Codespace's forwarded backend services. Safe to delete; do not merge to main.
CODESPACE_NAME=${CODESPACE_NAME}
CODESPACE_FORWARDING_DOMAIN=${FWD_DOMAIN}
EOF

BRANCH_NAME="$(git rev-parse --abbrev-ref HEAD)"
git add "$TARGET_FILE"
if git diff --cached --quiet -- "$TARGET_FILE"; then
  echo "Codespace target unchanged; using the already-deployed S3 host."
else
  git \
    -c user.name="${GIT_AUTHOR_NAME:-Codespace Preview}" \
    -c user.email="${GIT_AUTHOR_EMAIL:-codespace@users.noreply.github.com}" \
    commit -m "ci: record Codespace preview target" >/dev/null
  git push origin "HEAD:${BRANCH_NAME}" \
    || echo "Warning: could not push Codespace target; the preview build was not retriggered."
fi

# The host the realm + prerenderer use is the CI/S3 build. The bucket prefix
# is the branch name sanitized exactly as the workflow does (PR_BRANCH_NAME).
PR_BRANCH_NAME="$(echo "$BRANCH_NAME" | tr _ - | tr '[:upper:]' '[:lower:]' | sed -e 's/-$//' | sed -e 's/[^a-z0-9\-]//g' | cut -c1-60)"
export BOXEL_HOST_URL="https://${PR_BRANCH_NAME}.boxel-host-preview.stack.cards"
echo "==> Host (for realm distURL + prerender): ${BOXEL_HOST_URL}"

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

# ── Icons ──
echo "==> Starting icons server..."
pnpm --dir=packages/realm-server run start:icons &

# Wait for the S3 host to be live before the prerender (its puppeteer /_standby
# probe loads it) and the realm server (its distURL smoke test fetches it).
# Usually already live from a prior build; the long timeout covers a
# first-ever build that has to wait for CI.
echo "==> Waiting for S3 host at ${BOXEL_HOST_URL}/_standby..."
timeout 900 bash -c 'until curl -sf "'"$BOXEL_HOST_URL"'/_standby" >/dev/null 2>&1; do sleep 5; done' \
  || echo "Warning: S3 host not reachable; realm smoke test and prerender will likely fail."

# ── Prerender (needs the host) then worker (depends on the prerender) ──
# Ordered deliberately: the worker manager only becomes ready after the
# prerender registers a worker, and the realm server's waitForWorkerManager
# is a hardcoded 30s — so the realm must start only once the worker manager
# is already up (see the wait below), and the prerender must precede the worker.
echo "==> Starting prerender services..."
pnpm --dir=packages/realm-server run start:prerender-manager-dev &
pnpm --dir=packages/realm-server run start:prerender-dev &

echo "==> Starting worker..."
pnpm --dir=packages/realm-server run start:worker-development &

# Gate on the worker manager's own readiness signal before launching the
# realm server, so its 30s internal wait succeeds immediately. The manager
# reports {"ready":true} once it has a registered worker (which transitively
# requires the prerender + host to be up).
echo "==> Waiting for worker manager at http://localhost:4210 to be ready..."
timeout 900 bash -c 'until curl -sf http://localhost:4210/ 2>/dev/null | grep -q "\"ready\":true"; do sleep 3; done' \
  || echo "Warning: worker manager not ready after 900s; realm server will likely fail to start"

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
# Launched by hand (not via mise) so we can point its toUrls at the public
# Codespace URLs (so the S3 host resolves realms back to this backend) and its
# distURL (HOST_URL) at the CI/S3 host, while everything else matches
# mise-tasks/services/realm-server. It inherits REALM_SERVER_TLS_CERT_FILE /
# NODE_EXTRA_CA_CERTS from the env-vars.sh that `mise activate` sourced, so it
# serves HTTPS on 4201. Realm layout: base, catalog, skills, openrouter
# (experiments / homepage / submission / software-factory skipped to stay lean).
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
GRAFANA_SECRET="shhh! it's a secret" \
LOW_CREDIT_THRESHOLD="${LOW_CREDIT_THRESHOLD:-2000}" \
HOST_URL="$BOXEL_HOST_URL" \
MATRIX_URL=http://localhost:8008 \
REALM_SERVER_MATRIX_USERNAME=realm_server \
ENABLE_FILE_WATCHER=true \
REALM_SERVER_SKIP_BOOT_INDEX=true \
  pnpm --dir=packages/realm-server exec ts-node \
    --transpileOnly main \
    --port=4201 \
    --serverURL="${REALM_SERVER_URL}" \
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
# The realm server now serves HTTPS on 4201 (self-signed cert), so probe with
# https + -k.
echo "==> Waiting for realm server to be ready..."
timeout 300 bash -c \
  'until curl -ksf "https://localhost:4201/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson" >/dev/null 2>&1; do sleep 2; done' \
  || echo "Warning: realm server readiness check timed out after 5 minutes"

echo ""
echo "============================================"
echo "  Backend services running!"
echo ""
echo "  Realm server:  ${REALM_SERVER_URL}"
echo "  Matrix:        ${MATRIX_PUBLIC_URL}"
echo "  Icons:         ${ICONS_PUBLIC_URL}"
echo "  Host preview:  ${BOXEL_HOST_URL}"
echo "============================================"

# This script is launched detached from postStartCommand so the Codespace
# lifecycle hook returns immediately — a blocking postStartCommand wedges the
# Codespaces agent. Blocking on the realm server here keeps this script alive
# as the parent of all the backgrounded services for the life of the
# Codespace. Output goes to /tmp/start-services.log.
wait "$REALM_PID"
