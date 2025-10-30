#! /bin/sh

set -eu

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
REALM_SERVER_DIR="$(dirname "$SCRIPTS_DIR")"
REPO_ROOT="$(cd "$REALM_SERVER_DIR/../.." && pwd)"
OUTPUT_DIR="$REPO_ROOT/preindexed-db"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

for DB in boxel boxel_base boxel_test; do
  if docker exec boxel-pg psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB}'" | grep -q 1; then
    echo "Dumping $DB"
    docker exec boxel-pg pg_dump -Fc -U postgres "$DB" > "$OUTPUT_DIR/${DB}.dump"
  else
    echo "Skipping $DB (database does not exist)"
  fi
done

ls "$OUTPUT_DIR"
