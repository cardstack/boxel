#!/bin/sh
# Creates a per-environment PostgreSQL database if it doesn't already exist.
# Usage: ensure-branch-db.sh [environment-slug]
# If no environment slug is given, derives it from BOXEL_ENVIRONMENT or the current git branch.

set -e

if [ -n "$1" ]; then
  SLUG="$1"
elif [ -n "$BOXEL_ENVIRONMENT" ]; then
  SLUG=$(echo "$BOXEL_ENVIRONMENT" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
else
  SLUG=$(git branch --show-current | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
fi

DB_NAME="boxel_${SLUG}"

echo "Ensuring database '${DB_NAME}' exists..."

# Use docker exec to talk to the boxel-pg container directly
if docker exec boxel-pg psql -U postgres -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
  echo "Database '${DB_NAME}' already exists."
else
  docker exec boxel-pg createdb -U postgres "$DB_NAME"
  echo "Created database '${DB_NAME}'."
fi
