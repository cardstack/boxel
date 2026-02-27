#! /bin/sh

# Branch-mode: when BOXEL_BRANCH is set, use Traefik hostnames for readiness checks
if [ -n "$BOXEL_BRANCH" ]; then
  BRANCH_SLUG=$(echo "$BOXEL_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  REALM_HOST="realm-server.${BRANCH_SLUG}.localhost"
  ICONS_HOST="icons.${BRANCH_SLUG}.localhost"

  BASE_REALM="http-get://${REALM_HOST}/base/"
  CATALOG_REALM="http-get://${REALM_HOST}/catalog/"
  SKILLS_REALM="http-get://${REALM_HOST}/skills/"
  BOXEL_HOMEPAGE_REALM="http-get://${REALM_HOST}/boxel-homepage/"
  EXPERIMENTS_REALM="http-get://${REALM_HOST}/experiments/"
  REALM_TEST_HOST="realm-test.${BRANCH_SLUG}.localhost"
  NODE_TEST_REALM="http-get://${REALM_TEST_HOST}/node-test/"
  ICONS_URL="http://${ICONS_HOST}"
else
  BASE_REALM="http-get://localhost:4201/base/"
  CATALOG_REALM="http-get://localhost:4201/catalog/"
  SKILLS_REALM="http-get://localhost:4201/skills/"
  BOXEL_HOMEPAGE_REALM="http-get://localhost:4201/boxel-homepage/"
  EXPERIMENTS_REALM="http-get://localhost:4201/experiments/"
  NODE_TEST_REALM="http-get://localhost:4202/node-test/"
  ICONS_URL="http://localhost:4206"
fi

READY_PATH="_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson"

BASE_REALM_READY="$BASE_REALM$READY_PATH"
CATALOG_REALM_READY="$CATALOG_REALM$READY_PATH"
SKILLS_REALM_READY="$SKILLS_REALM$READY_PATH"
BOXEL_HOMEPAGE_REALM_READY="$BOXEL_HOMEPAGE_REALM$READY_PATH"
EXPERIMENTS_REALM_READY="$EXPERIMENTS_REALM$READY_PATH"
NODE_TEST_REALM_READY="$NODE_TEST_REALM$READY_PATH"

SYNAPSE_URL="http://localhost:8008"
SMTP_4_DEV_URL="http://localhost:5001"

WAIT_ON_TIMEOUT=2000000 NODE_NO_WARNINGS=1 start-server-and-test \
  'run-p -ln start:pg start:matrix start:smtp start:prerender-dev start:prerender-manager-dev start:worker-development start:development' \
  "$BASE_REALM_READY|$CATALOG_REALM_READY|$SKILLS_REALM_READY|$BOXEL_HOMEPAGE_REALM_READY|$EXPERIMENTS_REALM_READY|$SYNAPSE_URL|$SMTP_4_DEV_URL|$ICONS_URL" \
  'run-p -ln start:worker-test start:test-realms' \
  "$NODE_TEST_REALM_READY" \
  'wait'
