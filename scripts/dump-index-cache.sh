#!/bin/bash
# Dumps one database's index tables into a gzipped, data-only snapshot that
# scripts/import-cached-index.sh replays, and writes the tables it holds to a
# sidecar next to it for scripts/verify-index-cache.sh.
#
# Usage: dump-index-cache.sh <database> <output.sql.gz> [realm...]
#   Each realm named (its mount path, such as `catalog`) must have indexed
#   rows. The sidecar is <output>.tables, with `.sql.gz` dropped.
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

echo "Dumping the index cache from database ${DB}..."

# An empty snapshot still imports and verifies cleanly while quietly returning
# every consumer to indexing from scratch, so a realm that didn't index fails
# here while the cause is still legible.
for realm in "$@"; do
  row_count=$(docker exec boxel-pg psql -U postgres -d "$DB" -tAc \
    "SELECT count(*) FROM boxel_index WHERE realm_url LIKE '%/${realm}/'")
  if [ "${row_count:-0}" -eq 0 ]; then
    echo "::error title=Index cache empty::No boxel_index rows for realm '/${realm}/' in ${DB}. Either the realm did not index in this job, or its realm_url no longer ends in '/${realm}/'."
    exit 1
  fi
  echo "  /${realm}/: ${row_count} boxel_index rows"
done

# A snapshot with no `scoped_css` rows replays as cleanly as a full one and
# returns every consumer to 404ing the hashed deps the other tables carry, with
# nothing going red to show it.
scoped_css_rows=$(docker exec boxel-pg psql -U postgres -d "$DB" -tAc \
  "SELECT count(*) FROM scoped_css")
if [ "${scoped_css_rows:-0}" -eq 0 ]; then
  echo "::error title=Index cache incomplete::No scoped_css rows in ${DB}. The dumped rows' hashed scoped-CSS deps would resolve to nothing, and every request under a realm's _scoped-css/ space would answer 404."
  exit 1
fi
echo "  scoped_css: ${scoped_css_rows} interned stylesheets"

DUMP_ARGS=()
for t in "${CACHE_TABLES[@]}"; do
  DUMP_ARGS+=(-t "$t")
done

docker exec boxel-pg pg_dump -U postgres --data-only "${DUMP_ARGS[@]}" "$DB" \
  | gzip > "$OUT"

printf '%s\n' "${CACHE_TABLES[@]}" > "$TABLES_FILE"

echo "Index cache created at ${OUT}"
ls -lh "$OUT"
