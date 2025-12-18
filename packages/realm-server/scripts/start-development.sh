#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPTS_DIR/wait-for-pg.sh"

wait_for_postgres

pnpm --dir=../skills-realm skills:setup

if [ -z "$MATRIX_REGISTRATION_SHARED_SECRET" ]; then
  MATRIX_REGISTRATION_SHARED_SECRET=$(ts-node --transpileOnly "$SCRIPTS_DIR/matrix-registration-secret.ts")
  export MATRIX_REGISTRATION_SHARED_SECRET
fi

START_EXPERIMENTS=$(if [ -z "$SKIP_EXPERIMENTS" ]; then echo "true"; else echo ""; fi)
START_CATALOG=$(if [ -z "$SKIP_CATALOG" ]; then echo "true"; else echo ""; fi)

DEFAULT_CATALOG_REALM_URL='http://localhost:4201/catalog/'
CATALOG_REALM_URL="${RESOLVED_CATALOG_REALM_URL:-$DEFAULT_CATALOG_REALM_URL}"

PRERENDER_URL="${PRERENDER_URL:-http://localhost:4221}"

CATALOG_REALM_PATH='../catalog-realm'
CATALOG_TEMP_PATH=''

if [ -n "${START_CATALOG}" ] && [ -n "${CATALOG_KEEP_DIRS}${CATALOG_INDEX_SOURCE}" ]; then
  CATALOG_SRC_PATH="$(cd "$SCRIPTS_DIR/../../catalog-realm" && pwd)"
  CATALOG_TEMP_PATH="$(mktemp -d "${TMPDIR:-/tmp}/catalog-realm.XXXXXX")"

  echo "Using reduced catalog realm for faster startup: $CATALOG_TEMP_PATH"

  for f in ".realm.json" "package.json" "tsconfig.json" ".gitignore"; do
    if [ -e "$CATALOG_SRC_PATH/$f" ]; then
      cp -a "$CATALOG_SRC_PATH/$f" "$CATALOG_TEMP_PATH/"
    fi
  done

  KEEP_DIRS="$(printf '%s' "$CATALOG_KEEP_DIRS" | tr ',' ' ')"
  if [ -n "$KEEP_DIRS" ]; then
    for d in $KEEP_DIRS; do
      if [ -d "$CATALOG_SRC_PATH/$d" ]; then
        cp -a "$CATALOG_SRC_PATH/$d" "$CATALOG_TEMP_PATH/"
      else
        echo "ERROR: CATALOG_KEEP_DIRS directory not found: $d" >&2
        exit 1
      fi
    done
  fi

  if [ -n "$CATALOG_INDEX_SOURCE" ]; then
    if [ ! -f "$CATALOG_SRC_PATH/$CATALOG_INDEX_SOURCE" ]; then
      echo "ERROR: CATALOG_INDEX_SOURCE file not found: $CATALOG_INDEX_SOURCE" >&2
      exit 1
    fi
    cp -a "$CATALOG_SRC_PATH/$CATALOG_INDEX_SOURCE" "$CATALOG_TEMP_PATH/index.json"
  else
    cp -a "$CATALOG_SRC_PATH/index.json" "$CATALOG_TEMP_PATH/index.json"
  fi

  CATALOG_REALM_PATH="$CATALOG_TEMP_PATH"
  trap 'rm -rf "$CATALOG_TEMP_PATH"' EXIT INT TERM
fi


NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  PGPORT=5435 \
  PGDATABASE=boxel \
  LOG_LEVELS='*=info' \
  REALM_SERVER_SECRET_SEED="mum's the word" \
  REALM_SECRET_SEED="shhh! it's a secret" \
  GRAFANA_SECRET="shhh! it's a secret" \
  MATRIX_URL=http://localhost:8008 \
  REALM_SERVER_MATRIX_USERNAME=realm_server \
  ENABLE_FILE_WATCHER=true \
  ts-node \
  --transpileOnly main \
  --port=4201 \
  --matrixURL='http://localhost:8008' \
  --realmsRootPath='./realms/localhost_4201' \
  --prerendererUrl="${PRERENDER_URL}" \
  --migrateDB \
  $1 \
  \
  --path='../base' \
  --username='base_realm' \
  --fromUrl='https://cardstack.com/base/' \
  --toUrl='http://localhost:4201/base/' \
  \
  ${START_CATALOG:+--path="${CATALOG_REALM_PATH}"} \
  ${START_CATALOG:+--username='catalog_realm'} \
  ${START_CATALOG:+--fromUrl="${CATALOG_REALM_URL}"} \
  ${START_CATALOG:+--toUrl="${CATALOG_REALM_URL}"} \
  \
  --path='../skills-realm/contents' \
  --username='skills_realm' \
  --fromUrl='http://localhost:4201/skills/' \
  --toUrl='http://localhost:4201/skills/' \
  \
  ${START_EXPERIMENTS:+--path='../experiments-realm'} \
  ${START_EXPERIMENTS:+--username='experiments_realm'} \
  ${START_EXPERIMENTS:+--fromUrl='http://localhost:4201/experiments/'} \
  ${START_EXPERIMENTS:+--toUrl='http://localhost:4201/experiments/'}
