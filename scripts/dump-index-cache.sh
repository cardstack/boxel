#!/bin/bash
# Dumps one database's index tables into a gzipped, data-only snapshot that
# scripts/import-cached-index.sh replays, and writes the tables it holds to a
# sidecar next to it for scripts/verify-index-cache.sh.
#
# Usage: dump-index-cache.sh <database> <output.sql.gz> [realm...]
#   Each realm named (its mount path, such as `catalog`) must have indexed rows
#   and interned stylesheets. The sidecar is <output>.tables, with `.sql.gz`
#   dropped. PG_CONTAINER and PG_USER name the Postgres container and role.
#
# Called by mise-tasks/ci/cache-index for boxel's snapshots, and by
# boxel-catalog's live-test workflow for the catalog's.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/index-cache-tables.sh"

USAGE="usage: dump-index-cache.sh <database> <output.sql.gz> [realm...]"
DB="${1:?$USAGE}"
OUT="${2:?$USAGE}"
shift 2
case "$OUT" in
  *.sql.gz) ;;
  *) echo "$USAGE" >&2; exit 1 ;;
esac
TABLES_FILE="${OUT%.sql.gz}.tables"
PG_CONTAINER="${PG_CONTAINER:-boxel-pg}"
PG_USER="${PG_USER:-postgres}"

for realm in "$@"; do
  case "$realm" in
    '' | *[!A-Za-z0-9-]*)
      echo "::error title=Index cache::Realm '${realm}' is not a mount path (letters, digits and hyphens)."
      exit 1
      ;;
  esac
done

psql_query() {
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$DB" -tAc "$1"
}

echo "Dumping the index cache from database ${DB}..."

# An empty snapshot still imports and verifies cleanly while quietly returning
# every consumer to indexing from scratch, and one without a realm's
# `scoped_css` rows replays with every hashed scoped-CSS dep under that realm
# answering 404. Either fails here while the cause is still legible.
REALM_COUNTS=$(psql_query "
  SELECT r.realm_url, coalesce(i.n, 0), coalesce(s.n, 0)
    FROM (SELECT realm_url FROM boxel_index UNION SELECT realm_url FROM scoped_css) r
    LEFT JOIN (SELECT realm_url, count(*) n FROM boxel_index GROUP BY realm_url) i USING (realm_url)
    LEFT JOIN (SELECT realm_url, count(*) n FROM scoped_css GROUP BY realm_url) s USING (realm_url)")

realm_totals() {
  local suffix="$1" index_rows=0 css_rows=0 url n m
  while IFS='|' read -r url n m; do
    [ -z "$url" ] && continue
    case "$url" in
      *"$suffix") index_rows=$((index_rows + n)); css_rows=$((css_rows + m)) ;;
    esac
  done <<EOF
${REALM_COUNTS}
EOF
  echo "$index_rows $css_rows"
}

if [ "$#" -eq 0 ]; then
  read -r index_rows css_rows < <(realm_totals /)
  if [ "$css_rows" -eq 0 ]; then
    echo "::error title=Index cache incomplete::No scoped_css rows in ${DB}. The dumped rows' hashed scoped-CSS deps would resolve to nothing, and every request under a realm's _scoped-css/ space would answer 404."
    exit 1
  fi
fi
for realm in "$@"; do
  read -r index_rows css_rows < <(realm_totals "/${realm}/")
  if [ "$index_rows" -eq 0 ]; then
    echo "::error title=Index cache empty::No boxel_index rows for realm '/${realm}/' in ${DB}. Either the realm did not index in this job, or its realm_url no longer ends in '/${realm}/' — compare the realm names passed with the mount paths the caller serves them at."
    exit 1
  fi
  if [ "$css_rows" -eq 0 ]; then
    echo "::error title=Index cache incomplete::No scoped_css rows for realm '/${realm}/' in ${DB}. Its dumped rows' hashed scoped-CSS deps would resolve to nothing, and every request under its _scoped-css/ space would answer 404."
    exit 1
  fi
  echo "  /${realm}/: ${index_rows} boxel_index rows, ${css_rows} interned stylesheets"
done

DUMP_ARGS=()
for t in "${CACHE_TABLES[@]}"; do
  DUMP_ARGS+=(-t "$t")
done

# Written beside the real path and moved there last, so a failed dump never
# leaves a partial snapshot next to a sidecar from an earlier run.
rm -f "$TABLES_FILE"
trap 'rm -f "$OUT.tmp"' EXIT
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" --data-only "${DUMP_ARGS[@]}" "$DB" \
  | gzip > "$OUT.tmp"
printf '%s\n' "${CACHE_TABLES[@]}" > "$TABLES_FILE"
mv "$OUT.tmp" "$OUT"

echo "Index cache created at ${OUT}"
ls -lh "$OUT"
