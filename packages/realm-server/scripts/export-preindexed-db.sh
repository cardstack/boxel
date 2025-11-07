#! /bin/sh

set -eu

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
REALM_SERVER_DIR="$(dirname "$SCRIPTS_DIR")"
REPO_ROOT="$(cd "$REALM_SERVER_DIR/../.." && pwd)"
OUTPUT_DIR="$REPO_ROOT/preindexed-db"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

for DB in boxel boxel_base boxel_test; do
  echo "Dumping $DB"
  if docker exec boxel-pg pg_dump -Fc -U postgres "$DB" > "$OUTPUT_DIR/${DB}.dump"; then
    size=$(wc -c < "$OUTPUT_DIR/${DB}.dump")
    echo "  ✓ wrote $OUTPUT_DIR/${DB}.dump (${size} bytes)"
  else
    echo "  ⚠️ skipping $DB (pg_dump failed)" >&2
    rm -f "$OUTPUT_DIR/${DB}.dump"
  fi
done

ls -al "$OUTPUT_DIR"
