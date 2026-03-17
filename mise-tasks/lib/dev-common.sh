#!/bin/sh
# Shared setup for dev and dev-all mise tasks.
# Sourced (not executed) — sets variables and bootstraps infra.
# Expects to run with MISE dir=packages/realm-server.

READY_PATH="_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"

# Phase 1 readiness URLs
BASE_REALM_READY="http-get://${REALM_BASE_URL#http://}/base/${READY_PATH}"
SKILLS_READY="http-get://${REALM_BASE_URL#http://}/skills/${READY_PATH}"
PHASE1_URLS="${BASE_REALM_READY}|${SKILLS_READY}"

if [ -z "${SKIP_CATALOG:-}" ]; then
  PHASE1_URLS="${PHASE1_URLS}|http-get://${REALM_BASE_URL#http://}/catalog/${READY_PATH}"
fi
if [ -z "${SKIP_BOXEL_HOMEPAGE:-}" ]; then
  PHASE1_URLS="${PHASE1_URLS}|http-get://${REALM_BASE_URL#http://}/boxel-homepage/${READY_PATH}"
fi
if [ -z "${SKIP_EXPERIMENTS:-}" ]; then
  PHASE1_URLS="${PHASE1_URLS}|http-get://${REALM_BASE_URL#http://}/experiments/${READY_PATH}"
fi
PHASE1_URLS="${PHASE1_URLS}|http-get://${REALM_BASE_URL#http://}/software-factory/${READY_PATH}"

PHASE1_URLS="${PHASE1_URLS}|${MATRIX_URL_VAL}|http://localhost:5001|${ICONS_URL}"

# Phase 2 readiness URL
NODE_TEST_REALM_READY="http-get://${REALM_TEST_URL#http://}/node-test/${READY_PATH}"

# In environment mode, bootstrap infra before starting services
if [ -n "$BOXEL_ENVIRONMENT" ]; then
  ./scripts/start-pg.sh
  echo "Waiting for Postgres to accept connections..."
  until docker exec boxel-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  REPO_ROOT="$(cd "../.." && pwd)"
  "$REPO_ROOT/scripts/ensure-branch-db.sh"
  echo "Running database migrations..."
  pnpm migrate
  ./scripts/start-matrix.sh
fi
