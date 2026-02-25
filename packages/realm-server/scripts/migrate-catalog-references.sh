#!/bin/bash
#
# Migrates catalog realm references from full/path URLs to @cardstack/catalog/ prefix.
#
# Handles three forms of catalog references:
#   1. Full URL:  https://realms-staging.stack.cards/catalog/Theme/cardstack
#   2. Path-only: /catalog/Theme/cardstack (preceded by " or ' in source)
#
# Does NOT touch relative paths like ../catalog/... (within-realm references).
#
# Usage:
#   # Dry run (preview changes):
#   ./migrate-catalog-references.sh --dry-run <catalog-url> <directory> [<directory> ...]
#
#   # Apply changes:
#   ./migrate-catalog-references.sh <catalog-url> <directory> [<directory> ...]
#
# Examples:
#   # Staging
#   ./migrate-catalog-references.sh https://realms-staging.stack.cards/catalog/ /persistent/experiments /persistent/catalog
#
#   # Production
#   ./migrate-catalog-references.sh https://app.boxel.ai/catalog/ /persistent/experiments /persistent/catalog

set -euo pipefail

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
  shift
fi

if [ $# -lt 2 ]; then
  echo "Usage: $0 [--dry-run] <catalog-url> <directory> [<directory> ...]"
  echo ""
  echo "  <catalog-url>  The current catalog realm URL to replace,"
  echo "                 e.g. https://realms-staging.stack.cards/catalog/"
  echo "  <directory>    One or more realm directories to process"
  echo ""
  echo "  --dry-run      Preview changes without modifying files"
  exit 1
fi

CATALOG_URL="$1"
shift

# Ensure trailing slash
CATALOG_URL="${CATALOG_URL%/}/"

# Extract the path portion (e.g., /catalog/) for matching path-only references
CATALOG_PATH=$(echo "$CATALOG_URL" | sed -E 's|^https?://[^/]*||')

REPLACEMENT="@cardstack/catalog/"

total_files=0

for search_dir in "$@"; do
  if [ ! -d "$search_dir" ]; then
    echo "Warning: directory '$search_dir' does not exist, skipping."
    continue
  fi

  echo "Scanning $search_dir ..."

  # Find .json and .gts files containing either the full URL or path-only form.
  # For path-only, match only when preceded by " or ' to avoid ../catalog/ relative paths.
  matching_files=$(grep -rlE "${CATALOG_URL}|[\"']${CATALOG_PATH}" "$search_dir" --include='*.json' --include='*.gts' 2>/dev/null || true)

  if [ -z "$matching_files" ]; then
    echo "  No matching catalog references found"
    continue
  fi

  # Build sed args once: full URLs, then path-only preceded by " or '
  DQ='"'
  SED_ARGS=(-e "s|${CATALOG_URL}|${REPLACEMENT}|g"
            -e "s|${DQ}${CATALOG_PATH}|${DQ}${REPLACEMENT}|g"
            -e "s|'${CATALOG_PATH}|'${REPLACEMENT}|g")

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
