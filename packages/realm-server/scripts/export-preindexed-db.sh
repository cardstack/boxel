#! /bin/sh

set -eu

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
REALM_SERVER_DIR="$(dirname "$SCRIPTS_DIR")"
REPO_ROOT="$(cd "$REALM_SERVER_DIR/../.." && pwd)"
OUTPUT_DIR="$REPO_ROOT/preindexed-db"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

DB=boxel
echo "Dumping $DB"
docker exec boxel-pg pg_dump -Fc -U postgres "$DB" > "$OUTPUT_DIR/${DB}.dump"

echo "Database dump written to $OUTPUT_DIR/${DB}.dump"
