#!/bin/sh
# Creates a per-branch PostgreSQL database if it doesn't already exist.
# Usage: ensure-branch-db.sh [branch-slug]
# If no branch slug is given, derives it from BOXEL_BRANCH or the current git branch.

set -e

if [ -n "$1" ]; then
  SLUG="$1"
elif [ -n "$BOXEL_BRANCH" ]; then
  SLUG=$(echo "$BOXEL_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
else
  SLUG=$(git branch --show-current | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
fi

DB_NAME="boxel_${SLUG}"
PGPORT="${PGPORT:-5435}"

echo "Ensuring database '${DB_NAME}' exists on port ${PGPORT}..."

# Check if DB exists; create if not
if psql -p "$PGPORT" -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
  echo "Database '${DB_NAME}' already exists."
else
  createdb -p "$PGPORT" "$DB_NAME"
  echo "Created database '${DB_NAME}'."
fi
