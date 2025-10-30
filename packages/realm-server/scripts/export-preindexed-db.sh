#! /bin/sh

set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
REALM_SERVER_DIR="$(dirname "$SCRIPTS_DIR")"
REPO_ROOT="$(dirname "$REALM_SERVER_DIR")"
OUTPUT_DIR="$REPO_ROOT/preindexed-db"

echo "Registering realm users..."
pnpm --dir="$REPO_ROOT/packages/matrix" register-realm-users

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

for db in boxel boxel_base boxel_test; do
  echo "Dumping $db"
  docker exec boxel-pg pg_dump -Fc -U postgres "$db" > "$OUTPUT_DIR/${db}.dump"
done

echo "Database dumps written to $OUTPUT_DIR"
