#! /bin/sh

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

restore_in_repo() {
  prefix="$1"
  tmp=$(mktemp)
  if git ls-files -z -- "$prefix" >"$tmp" 2>/dev/null; then
    if [ -s "$tmp" ]; then
      while IFS= read -r -d '' file; do
        ts=$(git log -1 --format=%ct -- "$file" 2>/dev/null || true)
        if [ -n "$ts" ]; then
          touch -d "@$ts" "$file"
        fi
      done <"$tmp"
    fi
  fi
  rm -f "$tmp"
}

restore_external_repo() {
  dir="$1"
  if [ -d "$dir/.git" ]; then
    tmp=$(mktemp)
    if git -C "$dir" ls-files -z >"$tmp" 2>/dev/null; then
      if [ -s "$tmp" ]; then
        while IFS= read -r -d '' file; do
          ts=$(git -C "$dir" log -1 --format=%ct -- "$file" 2>/dev/null || true)
          if [ -n "$ts" ]; then
            touch -d "@$ts" "$dir/$file"
          fi
        done <"$tmp"
      fi
    fi
    rm -f "$tmp"
  fi
}

restore_in_repo "packages/base"
restore_in_repo "packages/catalog-realm"
restore_in_repo "packages/host/tests/cards"
restore_in_repo "packages/realm-server/tests/cards"

restore_external_repo "$REPO_ROOT/packages/skills-realm/contents"
