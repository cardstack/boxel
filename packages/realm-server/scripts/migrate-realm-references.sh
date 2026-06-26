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
#   -j, --jobs <n>      Number of parallel workers (default 16). Files are
#                       edited concurrently to hide per-file I/O latency on
#                       networked filesystems (e.g. EFS).
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
JOBS=16
ENV=""
REALM=""
ERRORS=()
EXCLUDE_DIRS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -j|--jobs)
      JOBS="$2"
      shift 2
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

# Paths of .json files that were valid JSON *before* editing. The post-run
# verification only flags a file if it was valid before and is invalid after
# (i.e. the replacement broke it) — files that were already non-strict (e.g.
# trailing commas, unescaped embedded source) are tolerated by the realm
# server's parser and must not fail the migration.
VALID_BEFORE_FILE=$(mktemp 2>/dev/null || echo "/tmp/migrate-valid-before.$$")
> "$VALID_BEFORE_FILE"

# --- Parallel processing scratch ---
# Files are processed concurrently (xargs -P) because the per-file work is
# I/O-latency-bound on networked filesystems (EFS). Each worker writes its own
# patch fragment (concurrent appends to one shared patch file would interleave
# and corrupt it) and appends results to shared list files; everything is
# aggregated after the directory loop.
FRAGMENTS_DIR=$(mktemp -d 2>/dev/null || echo "/tmp/migrate-frags.$$")
mkdir -p "$FRAGMENTS_DIR"
CHANGED_JSON_FILE=$(mktemp 2>/dev/null || echo "/tmp/migrate-changed-json.$$")
PROCESSED_FILE=$(mktemp 2>/dev/null || echo "/tmp/migrate-processed.$$")
WORKER_ERRORS_FILE=$(mktemp 2>/dev/null || echo "/tmp/migrate-werr.$$")
> "$CHANGED_JSON_FILE"
> "$PROCESSED_FILE"
> "$WORKER_ERRORS_FILE"

# Worker: process a batch of files passed as positional args. Reconstructs the
# sed program from exported scalars (arrays can't be exported across xargs).
# Runs in its own `bash -c`, so results go to the shared files above.
process_files() {
  local frag="$FRAGMENTS_DIR/frag.$$"
  local file tmp
  for file in "$@"; do
    tmp="$file.tmp.$$"
    if [ "$IS_URL" = true ]; then
      if ! sed -e "s|${FIND_STR}|${REPLACEMENT}|g" \
               -e "s|\"${REALM_PATH}|\"${REPLACEMENT}|g" \
               -e "s|'${REALM_PATH}|'${REPLACEMENT}|g" \
               "$file" > "$tmp" 2>/dev/null; then
        printf '%s\n' "Error processing $file" >> "$WORKER_ERRORS_FILE"
        rm -f "$tmp"
        continue
      fi
    else
      if ! sed -e "s|${FIND_STR}|${REPLACEMENT}|g" "$file" > "$tmp" 2>/dev/null; then
        printf '%s\n' "Error processing $file" >> "$WORKER_ERRORS_FILE"
        rm -f "$tmp"
        continue
      fi
    fi
    diff -u --label "$file" --label "$file" "$file" "$tmp" >> "$frag" 2>/dev/null || true
    printf '%s\n' "$file" >> "$PROCESSED_FILE"
    if [ "$DRY_RUN" = true ]; then
      rm -f "$tmp"
    elif mv "$tmp" "$file" 2>/dev/null; then
      case "$file" in
        *.json) printf '%s\n' "$file" >> "$CHANGED_JSON_FILE" ;;
      esac
    else
      printf '%s\n' "Error replacing $file" >> "$WORKER_ERRORS_FILE"
      rm -f "$tmp"
    fi
  done
}
export -f process_files
export FIND_STR REPLACEMENT IS_URL REALM_PATH DRY_RUN
export FRAGMENTS_DIR CHANGED_JSON_FILE PROCESSED_FILE WORKER_ERRORS_FILE

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

  # Record which matching .json files parse cleanly BEFORE editing, so the
  # post-run verification can distinguish "the replacement broke this" from
  # "this was already non-strict". One batched node pass per directory.
  if [ "$DRY_RUN" = false ]; then
    json_candidates=()
    for f in "${matching_files[@]}"; do
      case "$f" in
        *.json) json_candidates+=("$f") ;;
      esac
    done
    if [ ${#json_candidates[@]} -gt 0 ]; then
      node -e '
        const fs = require("fs");
        for (const f of process.argv.slice(1)) {
          try {
            JSON.parse(fs.readFileSync(f, "utf8"));
            console.log(f);
          } catch (e) {
            /* already non-strict; omit so it is not held to the after-check */
          }
        }
      ' "${json_candidates[@]}" >> "$VALID_BEFORE_FILE"
    fi
  fi

  echo "  ${#matching_files[@]} file(s) to process (jobs=$JOBS) ..."

  # Process this directory's matching files concurrently. NUL-delimited so any
  # path (spaces/newlines) is safe; -n batches files per worker to amortize the
  # bash fork; -P runs JOBS workers at once to hide per-file EFS latency.
  printf '%s\0' "${matching_files[@]}" \
    | xargs -0 -P "$JOBS" -n 50 bash -c 'process_files "$@"' _
done

# --- Aggregate parallel results ---
if ls "$FRAGMENTS_DIR"/frag.* >/dev/null 2>&1; then
  cat "$FRAGMENTS_DIR"/frag.* >> "$PATCH_FILE"
fi
total_files=$(wc -l < "$PROCESSED_FILE" 2>/dev/null | tr -d '[:space:]')
[ -z "$total_files" ] && total_files=0
while IFS= read -r werr; do
  [ -n "$werr" ] && ERRORS+=("$werr")
done < "$WORKER_ERRORS_FILE"

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

# Verify the replacement didn't turn any *previously valid* JSON invalid.
# Files that were already non-strict before editing (captured in
# VALID_BEFORE_FILE) are tolerated by the realm server's lenient parser, so
# they're reported as a note but don't fail the run — only a genuine
# valid -> invalid regression forces a non-zero exit.
changed_json_count=$(wc -l < "$CHANGED_JSON_FILE" 2>/dev/null | tr -d '[:space:]')
[ -z "$changed_json_count" ] && changed_json_count=0
if [ "$DRY_RUN" = false ] && [ "$changed_json_count" -gt 0 ]; then
  echo ""
  echo "Verifying $changed_json_count changed JSON file(s) ..."
  # Both path lists are read from files (not argv) so this scales past ARG_MAX.
  if ! node -e '
    const fs = require("fs");
    const validBefore = new Set(
      fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean)
    );
    const changed = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
    let broke = 0;
    let preexisting = 0;
    for (const f of changed) {
      try {
        JSON.parse(fs.readFileSync(f, "utf8"));
      } catch (e) {
        if (validBefore.has(f)) {
          console.error("  Migration broke valid JSON: " + f + ": " + e.message);
          broke++;
        } else {
          preexisting++;
        }
      }
    }
    if (preexisting > 0) {
      console.error(
        "  Note: " + preexisting +
        " changed file(s) were already non-strict JSON before the migration (not flagged)."
      );
    }
    process.exit(broke > 0 ? 1 : 0);
  ' "$VALID_BEFORE_FILE" "$CHANGED_JSON_FILE"; then
    ERRORS+=("Migration turned previously-valid JSON invalid in one or more files (see above). Roll back with: patch -R -p0 < $PATCH_FILE")
  else
    echo "  No previously-valid JSON was broken."
  fi
fi

rm -f "$VALID_BEFORE_FILE" "$CHANGED_JSON_FILE" "$PROCESSED_FILE" "$WORKER_ERRORS_FILE"
rm -rf "$FRAGMENTS_DIR"

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo "WARNING: ${#ERRORS[@]} error(s) encountered during processing:"
  for err in "${ERRORS[@]}"; do
    echo "  - $err"
  done
  exit 1
fi
