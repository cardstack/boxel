#!/bin/bash
#
# Migrates realm references from full/path URLs to a @cardstack/ prefix.
#
# Handles two forms of references:
#   1. Full URL:  https://realms-staging.stack.cards/catalog/Theme/cardstack
#   2. Path-only: /catalog/Theme/cardstack (preceded by " or ' in source)
#
# Does NOT touch relative paths like ../catalog/... (within-realm references).
#
# Usage:
#   ./migrate-realm-references.sh [--dry-run] <realm-url> <prefix> <directory> [<directory> ...]
#
# Examples:
#   # Staging - catalog
#   ./migrate-realm-references.sh --dry-run https://realms-staging.stack.cards/catalog/ @cardstack/catalog/ /persistent/catalog /persistent/experiments
#
#   # Staging - base
#   ./migrate-realm-references.sh --dry-run https://realms-staging.stack.cards/base/ @cardstack/base/ /persistent/base /persistent/catalog /persistent/experiments
#
#   # Production - catalog
#   ./migrate-realm-references.sh https://app.boxel.ai/catalog/ @cardstack/catalog/ /persistent/catalog /persistent/experiments
#
#   # Production - base
#   ./migrate-realm-references.sh https://app.boxel.ai/base/ @cardstack/base/ /persistent/base /persistent/catalog /persistent/experiments

set -euo pipefail

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
  shift
fi

if [ $# -lt 3 ]; then
  echo "Usage: $0 [--dry-run] <realm-url> <prefix> <directory> [<directory> ...]"
  echo ""
  echo "  <realm-url>    The current realm URL to replace,"
  echo "                 e.g. https://realms-staging.stack.cards/catalog/"
  echo "  <prefix>       The @cardstack/ prefix to replace with,"
  echo "                 e.g. @cardstack/catalog/"
  echo "  <directory>    One or more realm directories to process"
  echo ""
  echo "  --dry-run      Preview changes without modifying files"
  exit 1
fi

REALM_URL="$1"
shift
REPLACEMENT="$1"
shift

# Ensure trailing slashes
REALM_URL="${REALM_URL%/}/"
REPLACEMENT="${REPLACEMENT%/}/"

# Extract the path portion (e.g., /catalog/) for matching path-only references
REALM_PATH=$(echo "$REALM_URL" | sed -E 's|^https?://[^/]*||')

total_files=0

for search_dir in "$@"; do
  if [ ! -d "$search_dir" ]; then
    echo "Warning: directory '$search_dir' does not exist, skipping."
    continue
  fi

  echo "Scanning $search_dir ..."

  # Find .json and .gts files containing either the full URL or path-only form.
  # For path-only, match only when preceded by " or ' to avoid relative paths.
  matching_files=$(grep -rlE "${REALM_URL}|[\"']${REALM_PATH}" "$search_dir" --include='*.json' --include='*.gts' 2>/dev/null || true)

  if [ -z "$matching_files" ]; then
    echo "  No matching references found"
    continue
  fi

  # Build sed args once: full URLs, then path-only preceded by " or '
  DQ='"'
  SED_ARGS=(-e "s|${REALM_URL}|${REPLACEMENT}|g"
            -e "s|${DQ}${REALM_PATH}|${DQ}${REPLACEMENT}|g"
            -e "s|'${REALM_PATH}|'${REPLACEMENT}|g")

  for file in $matching_files; do
    sed "${SED_ARGS[@]}" "$file" > "$file.tmp"

    if [ "$DRY_RUN" = true ]; then
      echo ""
      echo "  Would update: $file"
      { diff --unified=0 "$file" "$file.tmp" || true; } | tail -n +3 | grep '^[+-]' | while IFS= read -r line; do
        echo "    $line"
      done
      rm "$file.tmp"
    else
      mv "$file.tmp" "$file"
      echo "  Updated: $file"
    fi
    total_files=$((total_files + 1))
  done
done

echo ""
if [ "$DRY_RUN" = true ]; then
  echo "Dry run complete. $total_files file(s) would be updated."
else
  echo "Done. $total_files file(s) updated."
fi
