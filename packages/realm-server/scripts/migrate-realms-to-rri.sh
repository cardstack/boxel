#!/bin/bash
#
# One-command wrapper around migrate-realm-references.sh that converts the
# on-disk virtual-alias realm references to RRI prefix form across the given
# directories.
#
# Only the base realm is addressed by a virtual alias
# (https://cardstack.com/base/); catalog, skills, and openrouter are authored
# directly in scoped @cardstack/<realm>/ form on disk, so they need no
# conversion. If a realm regains a virtual alias, add a mapping to MAPPINGS
# below and it is picked up automatically.
#
# Pass-through flags (--dry-run, --json-only) are forwarded to each underlying
# run; each run writes its own rollback .patch.
#
# Usage:
#   ./migrate-realms-to-rri.sh [--dry-run] [--json-only] <directory> [<directory> ...]
#
# Examples:
#   # Preview the conversion across a realm data tree (no writes)
#   ./migrate-realms-to-rri.sh --dry-run --json-only /persistent
#
#   # Apply it
#   ./migrate-realms-to-rri.sh --json-only /persistent

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATE="$SCRIPT_DIR/migrate-realm-references.sh"

# <find>|<replace> pairs, one per virtual-alias realm.
MAPPINGS=(
  "https://cardstack.com/base/|@cardstack/base/"
)

FLAGS=()
DIRS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run|--json-only)
      FLAGS+=("$1")
      shift
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

if [ ${#DIRS[@]} -lt 1 ]; then
  echo "Usage: $0 [--dry-run] [--json-only] <directory> [<directory> ...]" >&2
  exit 1
fi

status=0
for mapping in "${MAPPINGS[@]}"; do
  find_str="${mapping%%|*}"
  replace_str="${mapping#*|}"
  echo "=== $find_str -> $replace_str ==="
  if ! bash "$MIGRATE" ${FLAGS[@]+"${FLAGS[@]}"} "$find_str" "$replace_str" "${DIRS[@]}"; then
    status=1
  fi
  echo ""
done

exit $status
