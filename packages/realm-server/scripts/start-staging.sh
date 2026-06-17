#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
# Run from the realm-server package directory so `pnpm setup:*` resolves the
# package's npm scripts (the relative `../base/` paths inside those scripts
# depend on this CWD) and ts-node can find the package's tsconfig. Previously
# the CMD wrapped pnpm --filter, which set CWD for us; now PID 1 execs into
# this script directly so we set it ourselves. The PATH prepend gives us the
# local ts-node binary that `pnpm --filter` used to put on PATH automatically.
cd "$SCRIPTS_DIR/.."
PATH="./node_modules/.bin:$PATH"
export PATH
pnpm setup:base-in-deployment
pnpm setup:experiments-in-deployment
pnpm setup:catalog-in-deployment
pnpm setup:skills-in-deployment
pnpm setup:software-factory-in-deployment
pnpm setup:boxel-homepage-in-deployment
pnpm setup:openrouter-in-deployment

SUBMISSION_REALM_PATH='/persistent/submissions'
SUBMISSION_REALM_URL="${RESOLVED_SUBMISSION_REALM_URL:-https://realms-staging.stack.cards/submissions/}"
sh "$SCRIPTS_DIR/setup-submission-realm.sh" "$SUBMISSION_REALM_PATH"

DEFAULT_CATALOG_REALM_URL='https://realms-staging.stack.cards/catalog/'
CATALOG_REALM_URL="${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}"
DEFAULT_SOFTWARE_FACTORY_REALM_URL='https://realms-staging.stack.cards/software-factory/'
SOFTWARE_FACTORY_REALM_URL="${RESOLVED_SOFTWARE_FACTORY_REALM_URL:-$DEFAULT_SOFTWARE_FACTORY_REALM_URL}"
DEFAULT_BOXEL_HOMEPAGE_REALM_URL='https://realms-staging.stack.cards/boxel-homepage/'
BOXEL_HOMEPAGE_REALM_URL="${RESOLVED_BOXEL_HOMEPAGE_REALM_URL:-$DEFAULT_BOXEL_HOMEPAGE_REALM_URL}"

echo "[start-staging] pid=$$ ppid=$PPID about to exec ts-node at $(date -Iseconds)" >&2

NODE_NO_WARNINGS=1 \
  LOW_CREDIT_THRESHOLD=2000 \
  MATRIX_URL=https://matrix-staging.stack.cards \
  MATRIX_SERVER_NAME=stack.cards \
  BOXEL_HOST_URL=https://realms-staging.stack.cards \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  PUBLISHED_REALM_BOXEL_SPACE_DOMAIN='staging.boxel.dev' \
  PUBLISHED_REALM_BOXEL_SITE_DOMAIN='staging.boxel.build' \
  exec node main.ts \
  --port=3000 \
  --matrixURL='https://matrix-staging.stack.cards' \
  --realmsRootPath='/persistent/realms' \
  --serverURL='https://realms-staging.stack.cards' \
  --prerendererUrl='http://boxel-prerender-manager.boxel-staging-internal:4222' \
  \
  --path='/persistent/base' \
  --username='base_realm' \
  --distURL='https://boxel-host-staging.stack.cards' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='https://realms-staging.stack.cards/base/' \
  \
  --path='/persistent/catalog' \
  --username='catalog_realm' \
  --fromUrl='@cardstack/catalog/' \
  --toUrl="${CATALOG_REALM_URL}" \
  \
  --path="${SUBMISSION_REALM_PATH}" \
  --username='submission_realm' \
  --fromUrl="${SUBMISSION_REALM_URL}" \
  --toUrl="${SUBMISSION_REALM_URL}" \
  \
  --path='/persistent/skills' \
  --username='skills_realm' \
  --fromUrl='@cardstack/skills/' \
  --toUrl='https://realms-staging.stack.cards/skills/' \
  \
  --path='/persistent/boxel-homepage' \
  --username='boxel_homepage_realm' \
  --fromUrl="${BOXEL_HOMEPAGE_REALM_URL}" \
  --toUrl="${BOXEL_HOMEPAGE_REALM_URL}" \
  \
  --path='/persistent/experiments' \
  --username='experiments_realm' \
  --fromUrl='https://realms-staging.stack.cards/experiments/' \
  --toUrl='https://realms-staging.stack.cards/experiments/' \
  \
  --path='/persistent/openrouter' \
  --username='openrouter_realm' \
  --fromUrl='@cardstack/openrouter/' \
  --toUrl='https://realms-staging.stack.cards/openrouter/' \
  \
  --path='/persistent/software-factory' \
  --username='software_factory_realm' \
  --fromUrl="${SOFTWARE_FACTORY_REALM_URL}" \
  --toUrl="${SOFTWARE_FACTORY_REALM_URL}"
