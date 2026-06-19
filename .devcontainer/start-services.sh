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
# The realm server hard-requires a reachable host app: main.ts fetches
# HOST_URL at startup and process.exit(-2)s if it can't, and the prerenderer
# renders cards against it. Rather than build a second host here, HOST_URL
# points at the CI/S3 preview bundle (see below). The bootstrap realms (base,
# catalog, skills, openrouter) full-index on boot so their card instances are
# queryable — the AI system card, skills and catalog browsing all read from
# that index, so readiness waits for the index to finish.
set -euo pipefail

cd /workspaces/boxel

# mise provides the pinned node/pnpm/ts-node toolchain.
eval "$(mise activate bash)"

# Tear down any prior service instances before (re)starting. On a fresh
# Codespace this is a no-op, but on a re-run (after a code pull, or a manual
# restart) a still-running realm holds port 4201, so the new realm would hit
# EADDRINUSE, exit, and leave the *old* (pre-change) realm serving — silently
# masking the very change being tested. Kill the node service chain first;
# Postgres/Synapse run in Docker and are re-asserted idempotently below.
echo "==> Stopping any previously running services..."
# Match the actual ts-node entry-point processes (e.g. the realm is
# `ts-node … --transpileOnly main`, the prerender manager is `ts-node …
# prerender/manager-server`), not just the npm-script wrappers. Killing only
# the wrappers (or a wrong pattern like `prerender-manager`, which matches
# nothing — the process is `manager-server`) leaves the real service holding
# its port, so the new one EADDRINUSEs and dies, silently masking the change
# under test. `transpileOnly worker` matches both the worker and the
# worker-manager. Postgres/Synapse run in Docker and are re-asserted below.
for _pat in \
  'transpileOnly main' \
  'transpileOnly worker' \
  'manager-server' \
  'prerender-server' \
  'services:prerender' \
  'services:worker' \
  'start:prerender' \
  'start:worker' \
  'start:icons' \
  'start-icons'; do
  pkill -9 -f "$_pat" 2>/dev/null || true
done
sleep 2

CODESPACE_NAME="${CODESPACE_NAME:?CODESPACE_NAME must be set}"
FWD_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"

# Public Codespace URLs for the forwarded ports — TLS terminated at the
# GitHub edge. These become the realms' public identities (toUrl) and are
# passed to the host build so the S3-hosted preview can reach this backend.
export REALM_SERVER_URL="https://${CODESPACE_NAME}-4201.${FWD_DOMAIN}"
export MATRIX_PUBLIC_URL="https://${CODESPACE_NAME}-8008.${FWD_DOMAIN}"
export ICONS_PUBLIC_URL="https://${CODESPACE_NAME}-4206.${FWD_DOMAIN}"

# Internal wiring runs over plain HTTP on the standard ports. No dev cert is
# generated (see setup.sh): the realm server serves plain HTTP and GitHub's
# port forwarding terminates TLS at its edge. Override the env-vars.sh
# defaults (which assume https://localhost) so the realm and every mise
# service agree on http — otherwise the worker/prerender would dial
# https://localhost:4201 against a plain-HTTP realm. The browser-facing
# public URLs (REALM_SERVER_URL etc., all https) are injected by the realm
# at serve time and passed to the host build separately.
export REALM_BASE_URL="http://localhost:4201"
export MATRIX_URL="http://localhost:8008"
export MATRIX_URL_VAL="http://localhost:8008"
export ICONS_URL="http://localhost:4206"
export PGPORT=5435
export PGDATABASE=boxel

# ── Forwarded ports must be public so the reviewer's browser can reach the
#    realm (4201), the icons server (4206) and Matrix/Synapse (8008) ──
# These start cross-origin to each other, and a *private* forwarded port
# auth-gates cross-origin XHR at the GitHub edge (302 on navigation, 401 on
# fetch) — that's what 401s the browser's Matrix login. They must be public.
#
# This can't be automated from inside the Codespace: the ambient GITHUB_TOKEN
# lacks the `codespace` scope, so `gh codespace ports visibility` fails here
# (exit 4). Port visibility can only be set from OUTSIDE — either the VS Code
# "Ports" panel (right-click → Port Visibility → Public) or `gh codespace
# ports visibility 4201:public 4206:public 8008:public -c <name>` from a
# machine whose gh has the codespace scope. Visibility persists per-codespace
# once set, so it's a one-time step. We still attempt it (harmless, and it
# works in setups where a scoped token is present) and warn clearly if not.
echo "==> Attempting to make forwarded ports public..."
PORTS_PUBLIC_OK=1
for p in 4201 4206 8008; do
  gh codespace ports visibility "${p}:public" -c "$CODESPACE_NAME" >/dev/null 2>&1 || PORTS_PUBLIC_OK=0
done
if [ "$PORTS_PUBLIC_OK" = 1 ]; then
  echo "==> Forwarded ports set public."
else
  echo "Warning: could not set forwarded ports public from inside the Codespace."
  echo "         Set ports 4201, 4206 and 8008 to Public in the VS Code Ports"
  echo "         panel (or via gh from outside), or reviewer login will 401."
fi

# ── Host bundle (generic CI/S3 build; config injected at serve time) ──
# No per-Codespace rebuild or target-file push: the codespaces-preview
# workflow builds the host generically and deploys it to S3, and the realm
# server rewrites the Ember config (Matrix / realm-server / resolved-realm
# URLs) into it at serve time for THIS Codespace (serve-index.ts). The realm
# fetches this bundle as its distURL and serves it; the prerenderer renders
# against it. Bucket prefix = the branch name sanitized as the workflow does.
BRANCH_NAME="$(git rev-parse --abbrev-ref HEAD)"
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

# Register the realm server's own Matrix users (realm_server plus the
# per-realm users: base_realm, catalog_realm, skills_realm, openrouter_realm,
# …). The realm server authenticates to Synapse as `realm_server` to mint
# `/_server-session` tokens, logging in with a password derived from
# REALM_SECRET_SEED (passwordFromSeed). If that user doesn't exist Synapse
# returns 403 and every login 500s at /_server-session. register-realm-users
# registers them with the matching seed-derived password, so the seed here
# MUST equal the one the realm server runs with (REALM_SECRET_SEED below).
echo "==> Registering realm Matrix users (realm_server, base/catalog/skills/openrouter)..."
(cd packages/matrix && REALM_SECRET_SEED="shhh! it's a secret" MATRIX_URL=http://localhost:8008 pnpm register-realm-users) \
  || echo "Warning: realm Matrix user registration failed; login will 500 at /_server-session."

# Seed a reviewer login (user / password) on this Codespace's own Synapse so
# the preview is loginnable. This is the same dev user local development uses;
# it's only as exposed as the forwarded Matrix port (see the abuse note in the
# PR / README — gate port visibility if that matters for a given preview).
echo "==> Seeding reviewer Matrix user (user/password)..."
(cd packages/matrix && MATRIX_URL=http://localhost:8008 pnpm register-test-user) \
  || echo "Note: reviewer user seeding skipped (it may already exist)."

# ── Realm server ──
# Launched by hand (not via mise) so we can point its toUrls + serverURL at
# the public Codespace URLs (so the served host + redirects use the public
# address, and the S3 host resolves realms back here) and its distURL
# (HOST_URL) at the CI/S3 host. Serves plain HTTP on 4201; GitHub's edge does
# TLS. Realm layout: base, catalog, skills, openrouter (experiments /
# homepage / submission / software-factory skipped to stay lean).
#
# ASSETS_URL_OVERRIDE points the host app's asset URLs at the realm server's
# OWN origin instead of the S3 host. The reviewer's browser loads the app from
# the realm origin (4201), so loading ES-module scripts from the S3 host would
# be cross-origin and fail CORS (the preview bucket sends no
# Access-Control-Allow-Origin). With the override, asset URLs are same-origin
# and the realm proxies /assets, /@embroider and the favicons through to the
# S3 bundle (HOST_URL) — see proxyAssetPaths in packages/realm-server.
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
ASSETS_URL_OVERRIDE="${REALM_SERVER_URL}" \
REALM_SERVER_ASSUME_HTTPS=true \
REALM_SERVER_PERMISSIONS_BASE_URL="${REALM_SERVER_URL}" \
REALM_SERVER_SECRET_SEED="mum's the word" \
REALM_SECRET_SEED="shhh! it's a secret" \
GRAFANA_SECRET="shhh! it's a secret" \
LOW_CREDIT_THRESHOLD="${LOW_CREDIT_THRESHOLD:-2000}" \
HOST_URL="$BOXEL_HOST_URL" \
MATRIX_URL=http://localhost:8008 \
MATRIX_SERVER_NAME=localhost \
REALM_SERVER_MATRIX_USERNAME=realm_server \
ENABLE_FILE_WATCHER=true \
REALM_SERVER_PROXY_MATRIX_ICONS=true \
ICONS_BACKEND_URL=http://localhost:4206 \
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
# _readiness-check is a per-realm endpoint that reports ready once the realm
# has finished indexing, so probe the base realm specifically (not the server
# root, which 404s). The realm serves plain HTTP on 4201 and REALM_SERVER_ASSUME_HTTPS
# rewrites this localhost probe's host to the public realm URL so it resolves
# to the mounted realm. The long timeout covers the bootstrap from-scratch
# index (base is large); the realm still serves modules while it indexes.
echo "==> Waiting for realm server (and bootstrap index) to be ready..."
timeout 900 bash -c \
  'until curl -sf "http://localhost:4201/base/_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson" >/dev/null 2>&1; do sleep 3; done' \
  || echo "Warning: realm server readiness check timed out"

echo ""
echo "============================================"
echo "  Backend services running!"
echo ""
echo "  Open the preview at the REALM SERVER URL — it serves the host app"
echo "  with this Codespace's endpoints injected (see serve-index.ts):"
echo ""
echo "    ${REALM_SERVER_URL}"
echo ""
echo "  Log in with:  user / password"
echo ""
if [ "${PORTS_PUBLIC_OK:-0}" != 1 ]; then
  echo "  IF LOGIN 401s: ports 4201, 4206 and 8008 must be Public. Set them"
  echo "  in the VS Code Ports panel (right-click → Port Visibility → Public)."
  echo ""
fi
echo "  (Assets are proxied through the realm origin; Matrix is at"
echo "   ${MATRIX_PUBLIC_URL}; host bundle ${BOXEL_HOST_URL})"
echo "============================================"

# This script is launched detached from postStartCommand so the Codespace
# lifecycle hook returns immediately — a blocking postStartCommand wedges the
# Codespaces agent. Blocking on the realm server here keeps this script alive
# as the parent of all the backgrounded services for the life of the
# Codespace. Output goes to /tmp/start-services.log.
wait "$REALM_PID"
