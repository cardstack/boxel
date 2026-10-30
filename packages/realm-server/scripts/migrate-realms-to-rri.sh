#!/bin/bash
#
# One-command wrapper around migrate-realm-references.sh that converts the
# on-disk virtual-alias realm references to RRI prefix form across the given
# directories.
#
# The <alias>|<prefix> pairs to convert come from PREFIX_REALMS in
# packages/runtime-common/realm-prefixes.ts, read with the node that runs the
# realm server: every prefix realm with an `alias` there is converted, and a
# realm without one is authored in @cardstack/<realm>/ form on disk already and
# needs no conversion. Only the base realm has an alias
# (https://cardstack.com/base/).
#
# Pass-through flags (--dry-run, --json-only, --modules-only, --exclude <dir>)
# are forwarded to each underlying run; each run writes its own rollback .patch.
# --json-only converts card JSON, --modules-only converts .gts/.ts import
# specifiers, and neither converts both.
#
# --persistent <root> targets exactly the realm directories the server mounts
# (the REALM_DIRS list below, joined to <root>) instead of taking explicit
# directory arguments. This is the safest option: it converts only live realm
# trees and never descends into backups, decommissioned data, or other
# non-realm content sitting alongside them. Missing dirs under <root> are
# skipped with a warning.
#
# Usage:
#   ./migrate-realms-to-rri.sh [--dry-run] [--json-only] [--exclude <dir>]... <directory> [<directory> ...]
#   ./migrate-realms-to-rri.sh [--dry-run] [--json-only] --persistent <root>
#
# Examples:
#   # Preview against every live realm tree under /persistent (recommended)
#   ./migrate-realms-to-rri.sh --dry-run --json-only --persistent /persistent
#
#   # Apply it
#   ./migrate-realms-to-rri.sh --json-only --persistent /persistent
#
#   # Rewrite .gts/.ts import specifiers (separate pass)
#   ./migrate-realms-to-rri.sh --modules-only --persistent /persistent
#
#   # Or target explicit directories
#   ./migrate-realms-to-rri.sh --json-only /persistent/base /persistent/realms

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATE="$SCRIPT_DIR/migrate-realm-references.sh"

# <find>|<replace> pairs, one per prefix realm with an alias, from PREFIX_REALMS.
# Node strips the declaration's types as it loads it, so this needs no build and
# no node_modules.
PREFIX_REALMS_MODULE="$SCRIPT_DIR/../../runtime-common/realm-prefixes.ts"
MAPPINGS=()
while IFS= read -r mapping; do
  MAPPINGS+=("$mapping")
done < <(
  # The template literal inside the quotes is JavaScript's to expand.
  # shellcheck disable=SC2016
  NODE_NO_WARNINGS=1 node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    let { PREFIX_REALMS } = await import(pathToFileURL(process.argv[1]).href);
    for (let realm of PREFIX_REALMS) {
      if (realm.alias) {
        console.log(`${realm.alias}|${realm.prefix}`);
      }
    }
  ' -- "$PREFIX_REALMS_MODULE"
)
if [ ${#MAPPINGS[@]} -lt 1 ]; then
  echo "Could not read any alias from $PREFIX_REALMS_MODULE" >&2
  exit 1
fi

# Realm directory names the server mounts — mirrors the --path / --realmsRootPath
# entries in start-staging.sh / start-production.sh. KEEP IN SYNC with those.
# Used by --persistent to target exactly the live realm trees under a root.
REALM_DIRS=(
  base
  catalog
  submissions
  skills
  boxel-homepage
  experiments
  openrouter
  software-factory
  realms
)

FLAGS=()
DIRS=()
PERSISTENT_ROOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run|--json-only|--modules-only)
      FLAGS+=("$1")
      shift
      ;;
    --exclude)
      FLAGS+=("$1" "$2")
      shift 2
      ;;
    --persistent)
      PERSISTENT_ROOT="$2"
      shift 2
      ;;
    -*)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
    *)
      DIRS+=("$1")
      shift
      ;;
  esac
done

if [ -n "$PERSISTENT_ROOT" ]; then
  if [ ${#DIRS[@]} -gt 0 ]; then
    echo "Note: --persistent given; ignoring explicit directory arguments" >&2
  fi
  DIRS=()
  root="${PERSISTENT_ROOT%/}"
  for name in "${REALM_DIRS[@]}"; do
    DIRS+=("$root/$name")
  done
fi

if [ ${#DIRS[@]} -lt 1 ]; then
  echo "Usage: $0 [--dry-run] [--json-only] [--exclude <dir>]... <directory> [<directory> ...]" >&2
  echo "       $0 [--dry-run] [--json-only] --persistent <root>" >&2
  exit 1
fi

status=0
for mapping in "${MAPPINGS[@]}"; do
  find_str="${mapping%%|*}"
  replace_str="${mapping#*|}"
  echo "=== $find_str -> $replace_str ==="
  # Assemble the underlying invocation. DIRS is always non-empty (checked
  # above), so this array is always safe to expand, with or without flags.
  run_args=()
  if [ ${#FLAGS[@]} -gt 0 ]; then
    run_args+=("${FLAGS[@]}")
  fi
  run_args+=("$find_str" "$replace_str")
  run_args+=("${DIRS[@]}")
  if ! bash "$MIGRATE" "${run_args[@]}"; then
    status=1
  fi
  echo ""
done

exit $status
