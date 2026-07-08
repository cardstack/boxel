#!/bin/bash
# Verifies that an index-cache dump actually contains a COPY block for every
# table it was supposed to include.
#
# pg_dump only *warns* (and still exits 0) when a -t pattern matches no table,
# so a table renamed or removed by a migration silently drops out of the cache
# while the dump job otherwise "succeeds". Running this as its own CI step —
# separate from the long, noisy index/dump step — turns that into a short,
# clearly labeled failure with a GitHub error annotation, instead of an
# `exit 1` buried tens of thousands of lines deep in the dump log.
#
# Usage: verify-index-cache.sh <dump.sql[.gz]> [tables-file]
#   tables-file defaults to <dump-dir>/boxel-index-cache.tables and lists one
#   expected table per line. mise-tasks/ci/cache-index writes it from the same
#   list it feeds to pg_dump, so the two never drift.

set -euo pipefail

DUMP="${1:?usage: verify-index-cache.sh <dump.sql[.gz]> [tables-file]}"
TABLES_FILE="${2:-$(dirname "$DUMP")/boxel-index-cache.tables}"

if [ ! -f "$DUMP" ]; then
  echo "::error title=Index cache missing::dump file not found: ${DUMP}"
  exit 1
fi
if [ ! -f "$TABLES_FILE" ]; then
  echo "::error title=Index cache verification::expected-tables file not found: ${TABLES_FILE}"
  exit 1
fi

# Read the dump's COPY-block headers once (transparently handle gzip or plain).
case "$DUMP" in
  *.gz) copy_headers=$(gunzip -c "$DUMP" | grep '^COPY public\.' || true) ;;
  *)    copy_headers=$(grep '^COPY public\.' "$DUMP" || true) ;;
esac

missing=()
present=()
while IFS= read -r table; do
  [ -z "$table" ] && continue
  # Fixed-string match (-F) so a table name is never interpreted as a regex.
  # The trailing space matches the column list that always follows the table
  # name ("COPY public.foo (col, ...) FROM stdin;"), so a table name that is a
  # prefix of another (prerendered_html vs prerendered_html_working) can't
  # match by accident. No ^ anchor is needed: every line in copy_headers
  # already begins with "COPY public.".
  if printf '%s\n' "$copy_headers" | grep -qF "COPY public.${table} "; then
    present+=("$table")
  else
    missing+=("$table")
  fi
done < "$TABLES_FILE"

if [ "${#missing[@]}" -gt 0 ]; then
  for table in "${missing[@]}"; do
    echo "::error title=Index cache incomplete::pg_dump produced no COPY block for table '${table}'. It was likely renamed or removed by a migration. Update CACHE_TABLES in mise-tasks/ci/cache-index and the TRUNCATE list in scripts/import-cached-index.sh."
  done
  echo "Index cache verification FAILED: ${#missing[@]} of $(( ${#present[@]} + ${#missing[@]} )) expected tables missing: ${missing[*]}"
  exit 1
fi

echo "Index cache verified: ${#present[@]} tables present (${present[*]})."
