#!/bin/bash
#
# Migrates RRI references from `$thisRealm` to `$REALM` in userland realm files
# (e.g. the staging and production realm filesystems).
#
# Usage:
#   ./migrate-thisRealm-to-REALM.sh [--dry-run] <directory> [<directory> ...]
#
# Examples:
#   ./migrate-thisRealm-to-REALM.sh --dry-run /persistent/catalog
#   ./migrate-thisRealm-to-REALM.sh /persistent/catalog /persistent/experiments

set -uo pipefail

FIND_STR='$thisRealm'
REPLACEMENT='$REALM'
DRY_RUN=false

if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
  shift
fi

if [ $# -lt 1 ]; then
  echo "Usage: $0 [--dry-run] <directory> [<directory> ...]"
  exit 1
fi

total_files=0

for search_dir in "$@"; do
  if [ ! -d "$search_dir" ]; then
    echo "Warning: directory '$search_dir' does not exist, skipping."
    continue
  fi

  echo "Scanning $search_dir ..."

  matching_files=()
  while IFS= read -r file; do
    [ -n "$file" ] && matching_files+=("$file")
  done < <(
    grep -rlF "$FIND_STR" "$search_dir" --include='*.json' --include='*.gts' 2>/dev/null || true
  )

  if [ ${#matching_files[@]} -eq 0 ]; then
    echo "  No matching references found"
    continue
  fi

  for file in "${matching_files[@]}"; do
    if [ "$DRY_RUN" = true ]; then
      echo ""
      echo "  Would update: $file"
      grep -nF "$FIND_STR" "$file" | while IFS= read -r line; do
        echo "    $line"
      done
    else
      if ! sed -i.bak "s|\\${FIND_STR}|\\${REPLACEMENT}|g" "$file"; then
        echo "  Error updating $file" >&2
        rm -f "$file.bak"
        exit 1
      fi
      rm -f "$file.bak"
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
