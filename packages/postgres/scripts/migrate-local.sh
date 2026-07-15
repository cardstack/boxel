#!/usr/bin/env bash
# Local/CI migration driver. Applies (or rolls back) BOTH migration phases:
#   migrations/          additive, backward-compatible changes
#   migrations-removal/  destructive changes (column/table drops, renames)
#
# Deployed environments run these phases at different points in the rollout so a
# drop never executes while the previous code revision is still serving (see the
# migrate-db and migrate-db-remove jobs in .github/workflows/manual-deploy.yml).
# Locally and in CI there is no rolling deploy, so both phases run together — the
# removal phase LAST on `up` (drops happen after the additive changes they
# depend on) and FIRST on `down` (drops are undone before the tables they touch
# are removed), which keeps the combined sequence a valid linear order.
#
# The action (up | down [count] | redo ...) is forwarded from the caller, e.g.
# `pnpm migrate up`, `pnpm migrate down "$COUNT"`. Callers only ever roll the
# whole chain back (down count = every migration), so `down` rolls the removal
# phase back in full and forwards the caller's count to the additive phase.
set -euo pipefail

cd "$(dirname "$0")/.."

IGNORE='.*\.eslintrc\.js|package\.json'

# node-pg-migrate for one phase: mig <dir> <table> <action> [extra-args...]
mig() {
  ./node_modules/.bin/node-pg-migrate \
    --migrations-dir "$1" \
    --migrations-table "$2" \
    --no-check-order \
    --ignore-pattern "$IGNORE" \
    --verbose=false \
    "${@:3}"
}

action="${1:-up}"
shift || true

if [ "$action" = "down" ]; then
  # Roll the removal phase back in full first (its own applied count), then hand
  # the caller's count to the additive phase.
  removal_count=$(find migrations-removal -maxdepth 1 -type f -name '[0-9]*.js' | wc -l | tr -d ' ')
  if [ "$removal_count" -gt 0 ]; then
    mig migrations-removal migrations_removal down "$removal_count"
  fi
  mig migrations migrations down "$@"
else
  mig migrations migrations "$action" "$@"
  mig migrations-removal migrations_removal "$action" "$@"
fi
