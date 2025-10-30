#! /bin/sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

restore_in_repo() {
  prefix="$1"
  if git ls-files --error-unmatch "$prefix" >/dev/null 2>&1; then
    git ls-files -z -- "$prefix" | while IFS= read -r -d '' file; do
      ts=$(git log -1 --format=%ct -- "$file" || true)
      if [ -n "$ts" ]; then
        touch -d "@$ts" "$file"
      fi
    done
  fi
}

restore_external_repo() {
  dir="$1"
  if [ -d "$dir/.git" ]; then
    (cd "$dir"
      git ls-files -z | while IFS= read -r -d '' file; do
        ts=$(git log -1 --format=%ct -- "$file" || true)
        if [ -n "$ts" ]; then
          touch -d "@$ts" "$file"
        fi
      done)
  fi
}

restore_in_repo "packages/base"
restore_in_repo "packages/catalog-realm"
restore_in_repo "packages/host/tests/cards"
restore_in_repo "packages/realm-server/tests/cards"

restore_external_repo "$REPO_ROOT/packages/skills-realm/contents"
