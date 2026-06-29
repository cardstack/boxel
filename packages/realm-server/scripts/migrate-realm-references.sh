#!/bin/bash
#
# Migrates realm references by replacing one string with another.
#
# When <find> is a URL, also handles path-only references:
#   1. Full URL:  https://realms-staging.stack.cards/catalog/blog-app/BlogApp/ramped
#   2. Path-only: /catalog/blog-app/BlogApp/ramped (preceded by " or ' in source)
#   Does NOT touch relative paths like ../catalog/... (within-realm references).
#
# When <find> is not a URL (e.g. @cardstack/base/), only does literal replacement.
#
# A unified diff of all changes is saved to <name>.patch
# so changes can be rolled back with: patch -R -p0 < <name>.patch
#
# Usage:
#   ./migrate-realm-references.sh [--dry-run] [--json-only] [--exclude <dir>]... <find> <replace> <directory> [<directory> ...]
#   ./migrate-realm-references.sh [--dry-run] [--json-only] [--exclude <dir>]... -e <environment> -r <realm> <directory> [<directory> ...]
#
# Flags:
#   --dry-run           Preview changes without modifying files
#   --json-only         Only scan card JSON (skip .gts/.ts source modules)
#   --modules-only      Only scan source modules (.gts/.ts), skip card JSON —
#                       e.g. to rewrite import specifiers as a separate pass.
#                       Mutually exclusive with --json-only.
#   --exclude <dir>     Skip directories matching <dir> (by name, any depth).
#                       Repeatable. e.g. --exclude decommissioned to leave
#                       moved-aside or backup trees untouched.
#
# Shortcut flags:
#   -e, --environment   development | staging | production
#   -r, --realm         catalog | base | skills | openrouter
#
#   Environment URL mappings:
#     development  -> http://localhost:4201/
#     staging      -> https://realms-staging.stack.cards/
#     production   -> https://app.boxel.ai/
#
#   The replacement is auto-derived as @cardstack/<realm>/
#
# After a non-dry-run, every changed .json file is re-parsed to confirm the
# replacement left valid JSON; a parse failure is reported and exits non-zero.
# Source modules (.gts/.ts) are not parse-checked — a prefix swap inside an
# import specifier can't change syntax, and the rollback patch is the backstop.
#
# Examples:
#   # Convert base references to RRI prefix form in card JSON,
#   # skipping moved-aside / backup trees.
#   ./migrate-realm-references.sh --json-only --exclude decommissioned https://cardstack.com/base/ @cardstack/base/ /persistent
#
#   # Rewrite base import specifiers in .gts/.ts modules (separate pass).
#   ./migrate-realm-references.sh --modules-only --exclude decommissioned https://cardstack.com/base/ @cardstack/base/ /persistent
#
#   # Shortcut form (deployment-URL references)
#   ./migrate-realm-references.sh --dry-run -e staging -r catalog /persistent/catalog /persistent/experiments
#
#   # Equivalent explicit form
#   ./migrate-realm-references.sh --dry-run https://realms-staging.stack.cards/catalog/ @cardstack/catalog/ /persistent/catalog /persistent/experiments
#
#   # More shortcut examples
#   ./migrate-realm-references.sh -e production -r base /persistent/base /persistent/catalog /persistent/experiments
#   ./migrate-realm-references.sh -e development -r skills ./realms/
#
#   # Reverse (prefix -> URL, explicit form only)
#   ./migrate-realm-references.sh @cardstack/base/ https://cardstack.com/base/ ./realms/
#
# To roll back:
#   patch -R -p0 < <name>.patch

set -uo pipefail

# --- Parse flags ---

DRY_RUN=false
JSON_ONLY=false
MODULES_ONLY=false
ENV=""
REALM=""
ERRORS=()
CHANGED_JSON=()
EXCLUDE_DIRS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --json-only)
      JSON_ONLY=true
      shift
      ;;
    --modules-only)
      MODULES_ONLY=true
      shift
      ;;
    --exclude)
      EXCLUDE_DIRS+=("$2")
      shift 2
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
  if [ -z "$ENV" ] || [ -z "$REALM" ]; then
    echo "Error: -e/--environment and -r/--realm must both be specified" >&2
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

  case "$REALM" in
    catalog|base|skills|openrouter) ;;
    *)
      echo "Error: unknown realm '$REALM' (expected: catalog, base, skills, openrouter)"
      exit 1
      ;;
  esac

  FIND_STR="${BASE_URL}${REALM}/"
  REPLACEMENT="@cardstack/${REALM}/"

  echo "Resolved: $FIND_STR -> $REPLACEMENT"

elif [ $# -ge 2 ]; then
  FIND_STR="$1"
  shift
  REPLACEMENT="$1"
  shift
else
  echo "Usage: $0 [--dry-run] [--json-only] [--exclude <dir>]... <find> <replace> <directory> [<directory> ...]"
  echo "       $0 [--dry-run] [--json-only] [--exclude <dir>]... -e <environment> -r <realm> <directory> [<directory> ...]"
  echo ""
  echo "  <find>           The string to find (URL or prefix)"
  echo "  <replace>        The replacement string"
  echo "  <directory>      One or more realm directories to process"
  echo ""
  echo "  -e, --environment  development | staging | production"
  echo "  -r, --realm        catalog | base | skills | openrouter"
  echo "  --dry-run          Preview changes without modifying files"
  echo "  --json-only        Only scan card JSON (skip .gts/.ts modules)"
  echo "  --modules-only     Only scan .gts/.ts modules (skip card JSON)"
  echo "  --exclude <dir>    Skip directories matching <dir> (repeatable)"
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

# Which file types to scan. Default covers card JSON plus in-realm source
# modules (.gts/.ts). --json-only restricts to card documents; --modules-only
# restricts to source modules (e.g. when rewriting import specifiers as a
# separate pass). The two are mutually exclusive.
if [ "$JSON_ONLY" = true ] && [ "$MODULES_ONLY" = true ]; then
  echo "Error: --json-only and --modules-only are mutually exclusive" >&2
  exit 1
fi
if [ "$JSON_ONLY" = true ]; then
  INCLUDE_ARGS=(--include='*.json')
elif [ "$MODULES_ONLY" = true ]; then
  INCLUDE_ARGS=(--include='*.gts' --include='*.ts')
else
  INCLUDE_ARGS=(--include='*.json' --include='*.gts' --include='*.ts')
fi

# Directories to skip (matched by name at any depth), e.g. --exclude
# decommissioned to leave moved-aside / backup trees untouched.
EXCLUDE_ARGS=()
if [ ${#EXCLUDE_DIRS[@]} -gt 0 ]; then
  for d in "${EXCLUDE_DIRS[@]}"; do
    EXCLUDE_ARGS+=("--exclude-dir=$d")
  done
fi

# File-type + exclude args for grep, assembled once. INCLUDE_ARGS is always
# non-empty, so this array is always safe to expand even when no excludes
# were given.
GREP_ARGS=("${INCLUDE_ARGS[@]}")
if [ ${#EXCLUDE_ARGS[@]} -gt 0 ]; then
  GREP_ARGS+=("${EXCLUDE_ARGS[@]}")
fi

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
# Distinguish the JSON-only and modules-only passes so running both for the
# same find/replace (e.g. in the same directory) doesn't overwrite the first
# pass's rollback patch with the second's.
if [ "$JSON_ONLY" = true ]; then
  PATCH_NAME="${PATCH_NAME}-json"
elif [ "$MODULES_ONLY" = true ]; then
  PATCH_NAME="${PATCH_NAME}-modules"
fi
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
      grep -rlE "${FIND_STR}|[\"']${REALM_PATH}" "$search_dir" "${GREP_ARGS[@]}" 2>/dev/null || true
    else
      grep -rl "${FIND_STR}" "$search_dir" "${GREP_ARGS[@]}" 2>/dev/null || true
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
      case "$file" in
        *.json) CHANGED_JSON+=("$file") ;;
      esac
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

# Verify every changed JSON file still parses, so a bad replacement can't
# silently corrupt a card document. Failures are reported and force a
# non-zero exit; roll back with the patch above.
if [ "$DRY_RUN" = false ] && [ ${#CHANGED_JSON[@]} -gt 0 ]; then
  echo ""
  echo "Verifying ${#CHANGED_JSON[@]} changed JSON file(s) still parse ..."
  if ! node -e '
    const fs = require("fs");
    let bad = 0;
    for (const f of process.argv.slice(1)) {
      try {
        JSON.parse(fs.readFileSync(f, "utf8"));
      } catch (e) {
        console.error("  Invalid JSON after migration: " + f + ": " + e.message);
        bad++;
      }
    }
    process.exit(bad > 0 ? 1 : 0);
  ' "${CHANGED_JSON[@]}"; then
    ERRORS+=("JSON validation failed for one or more migrated files (see above). Roll back with: patch -R -p0 < $PATCH_FILE")
  else
    echo "  All migrated JSON files parse cleanly."
  fi
fi

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo "WARNING: ${#ERRORS[@]} error(s) encountered during processing:"
  for err in "${ERRORS[@]}"; do
    echo "  - $err"
  done
  exit 1
fi
