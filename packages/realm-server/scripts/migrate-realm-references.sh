#!/bin/bash
#
# Migrates realm references by replacing one string with another.
#
# When <find> is a URL, also handles path-only references:
#   1. Full URL:  https://realms-staging.stack.cards/catalog/Theme/cardstack
#   2. Path-only: /catalog/Theme/cardstack (preceded by " or ' in source)
#   Does NOT touch relative paths like ../catalog/... (within-realm references).
#
# When <find> is not a URL (e.g. @cardstack/base/), only does literal replacement.
#
# A unified diff of all changes is saved to <name>.patch
# so changes can be rolled back with: patch -R -p0 < <name>.patch
#
# Usage:
#   ./migrate-realm-references.sh [--dry-run] <find> <replace> <directory> [<directory> ...]
#   ./migrate-realm-references.sh [--dry-run] -e <environment> -r <realm> <directory> [<directory> ...]
#
# Shortcut flags:
#   -e, --environment   development | staging | production
#   -r, --realm         catalog | base | skills
#
#   Environment URL mappings (catalog, skills):
#     development  -> http://localhost:4201/<realm>/
#     staging      -> https://realms-staging.stack.cards/<realm>/
#     production   -> https://app.boxel.ai/<realm>/
#
#   Base realm always uses https://cardstack.com/base/ (same across all environments).
#
#   The replacement is auto-derived as @cardstack/<realm>/
#
# Examples:
#   # Shortcut form
#   ./migrate-realm-references.sh --dry-run -e staging -r catalog /persistent/catalog /persistent/experiments
#
#   # Equivalent explicit form
#   ./migrate-realm-references.sh --dry-run https://realms-staging.stack.cards/catalog/ @cardstack/catalog/ /persistent/catalog /persistent/experiments
#
#   # Base realm (always https://cardstack.com/base/ regardless of environment)
#   ./migrate-realm-references.sh -r base /persistent/base /persistent/catalog /persistent/experiments
#
#   # Other shortcut examples
#   ./migrate-realm-references.sh -e production -r skills /persistent/skills
#
#   # Reverse (prefix -> URL, explicit form only)
#   ./migrate-realm-references.sh @cardstack/base/ https://cardstack.com/base/ ./realms/
#
# To roll back:
#   patch -R -p0 < <name>.patch

set -uo pipefail

# --- Parse flags ---

DRY_RUN=false
ENV=""
REALM=""
ERRORS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -e|--environment)
      ENV="$2"
      shift 2
      ;;
    -r|--realm)
      REALM="$2"
      shift 2
      ;;
    *)
      break
      ;;
  esac
done

# --- Resolve environment/realm shortcuts ---

if [ -n "$ENV" ] || [ -n "$REALM" ]; then
  if [ -z "$REALM" ]; then
    echo "Error: -r/--realm is required when using shortcut flags" >&2
    exit 1
  fi

  case "$REALM" in
    catalog|base|skills) ;;
    *)
      echo "Error: unknown realm '$REALM' (expected: catalog, base, skills)"
      exit 1
      ;;
  esac

  # Base realm uses https://cardstack.com/base/ across all environments
  if [ "$REALM" = "base" ]; then
    if [ -n "$ENV" ]; then
      echo "Note: -e/--environment is ignored for base realm (always https://cardstack.com/base/)"
    fi
    FIND_STR="https://cardstack.com/base/"
  else
    if [ -z "$ENV" ]; then
      echo "Error: -e/--environment is required for realm '$REALM'" >&2
      exit 1
    fi
    case "$ENV" in
      development) BASE_URL="http://localhost:4201/" ;;
      staging)     BASE_URL="https://realms-staging.stack.cards/" ;;
      production)  BASE_URL="https://app.boxel.ai/" ;;
      *)
        echo "Error: unknown environment '$ENV' (expected: development, staging, production)"
        exit 1
        ;;
    esac
    FIND_STR="${BASE_URL}${REALM}/"
  fi
  REPLACEMENT="@cardstack/${REALM}/"

  echo "Resolved: $FIND_STR -> $REPLACEMENT"

elif [ $# -ge 2 ]; then
  FIND_STR="$1"
  shift
  REPLACEMENT="$1"
  shift
else
  echo "Usage: $0 [--dry-run] <find> <replace> <directory> [<directory> ...]"
  echo "       $0 [--dry-run] -e <environment> -r <realm> <directory> [<directory> ...]"
  echo ""
  echo "  <find>           The string to find (URL or prefix)"
  echo "  <replace>        The replacement string"
  echo "  <directory>      One or more realm directories to process"
  echo ""
  echo "  -e, --environment  development | staging | production"
  echo "  -r, --realm        catalog | base | skills"
  echo "  --dry-run          Preview changes without modifying files"
  echo ""
  echo "  Environment URL mappings:"
  echo "    development  -> http://localhost:4201/"
  echo "    staging      -> https://realms-staging.stack.cards/"
  echo "    production   -> https://app.boxel.ai/"
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "Error: at least one <directory> is required"
  exit 1
fi

# Ensure trailing slashes
FIND_STR="${FIND_STR%/}/"
REPLACEMENT="${REPLACEMENT%/}/"

# If <find> is a URL, extract the path portion for matching path-only references.
# e.g., https://realms-staging.stack.cards/catalog/ -> /catalog/
# For non-URL find strings (like @cardstack/base/), skip path-only matching.
IS_URL=false
REALM_PATH=""
if echo "$FIND_STR" | grep -qE '^https?://'; then
  IS_URL=true
  REALM_PATH=$(echo "$FIND_STR" | sed -E 's|^https?://[^/]*||')
fi

# Derive patch filename from the find/replace strings
# e.g. @cardstack/catalog/ -> catalog, https://cardstack.com/base/ -> base
PATCH_NAME=$(echo "$FIND_STR $REPLACEMENT" | sed -E 's|https?://[^/]*/||g; s|@cardstack/||g; s|/||g; s| |-to-|')
PATCH_FILE="${PATCH_NAME}.patch"

total_files=0
> "$PATCH_FILE"

for search_dir in "$@"; do
  if [ ! -d "$search_dir" ]; then
    echo "Warning: directory '$search_dir' does not exist, skipping."
    continue
  fi

  echo "Scanning $search_dir ..."

  # Find .json and .gts files containing the find string.
  # For URLs, also match path-only form preceded by " or ' to avoid relative paths.
  # Read results into an array to correctly handle filenames with spaces.
  matching_files=()
  while IFS= read -r file; do
    [ -n "$file" ] && matching_files+=("$file")
  done < <(
    if [ "$IS_URL" = true ]; then
      grep -rlE "${FIND_STR}|[\"']${REALM_PATH}" "$search_dir" --include='*.json' --include='*.gts' 2>/dev/null || true
    else
      grep -rl "${FIND_STR}" "$search_dir" --include='*.json' --include='*.gts' 2>/dev/null || true
    fi
  )

  if [ ${#matching_files[@]} -eq 0 ]; then
    echo "  No matching references found"
    continue
  fi

  # Build sed args once. For URLs, also handle path-only preceded by " or '
  DQ='"'
  if [ "$IS_URL" = true ]; then
    SED_ARGS=(-e "s|${FIND_STR}|${REPLACEMENT}|g"
              -e "s|${DQ}${REALM_PATH}|${DQ}${REPLACEMENT}|g"
              -e "s|'${REALM_PATH}|'${REPLACEMENT}|g")
  else
    SED_ARGS=(-e "s|${FIND_STR}|${REPLACEMENT}|g")
  fi

  for file in "${matching_files[@]}"; do
    if ! sed "${SED_ARGS[@]}" "$file" > "$file.tmp" 2>/tmp/migrate-err.$$; then
      err="Error processing $file: $(cat /tmp/migrate-err.$$)"
      echo "  $err"
      ERRORS+=("$err")
      rm -f "$file.tmp" /tmp/migrate-err.$$
      continue
    fi
    rm -f /tmp/migrate-err.$$

    # Append unified diff to the patch file (use --label so both sides show the real path)
    { diff -u --label "$file" --label "$file" "$file" "$file.tmp" || true; } >> "$PATCH_FILE"

    if [ "$DRY_RUN" = true ]; then
      echo ""
      echo "  Would update: $file"
      { diff --unified=0 "$file" "$file.tmp" || true; } | tail -n +3 | grep '^[+-]' | while IFS= read -r line; do
        echo "    $line"
      done
      rm -f "$file.tmp"
    else
      if ! mv "$file.tmp" "$file" 2>/tmp/migrate-err.$$; then
        err="Error replacing $file: $(cat /tmp/migrate-err.$$)"
        echo "  $err"
        ERRORS+=("$err")
        rm -f "$file.tmp" /tmp/migrate-err.$$
        continue
      fi
      rm -f /tmp/migrate-err.$$
      echo "  Updated: $file"
    fi
    total_files=$((total_files + 1))
  done
done

echo ""
if [ "$DRY_RUN" = true ]; then
  echo "Dry run complete. $total_files file(s) would be updated."
  echo "Patch preview saved to: $PATCH_FILE"
  echo "  (this is a preview — no files were modified)"
else
  echo "Done. $total_files file(s) updated."
  echo "Rollback patch saved to: $PATCH_FILE"
  echo "  To undo: patch -R -p0 < $PATCH_FILE"
fi

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo "WARNING: ${#ERRORS[@]} error(s) encountered during processing:"
  for err in "${ERRORS[@]}"; do
    echo "  - $err"
  done
  exit 1
fi
