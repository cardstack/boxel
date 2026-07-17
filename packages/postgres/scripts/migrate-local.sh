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
# The action (up | down [count] | create <name> | redo ...) is forwarded from
# the caller, e.g. `pnpm migrate up`, `pnpm migrate down "$COUNT"`. `down [count]`
# reverts the `count` most-recently-applied migrations across the COMBINED
# newest-first timeline of both phases (count defaults to 1, matching
# node-pg-migrate) — so it never reverts more than asked, and a full-chain
# rollback (CI's reversibility test) still undoes everything. `create` is
# scaffolding, not application, so it targets the additive phase only (see the
# create case below).
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

# Roll back the $2 most-recent migrations of phase $1 (additive|removal).
rollback_run() {
  [ "$2" -eq 0 ] && return 0
  if [ "$1" = removal ]; then
    mig migrations-removal migrations_removal down "$2"
  else
    mig migrations migrations down "$2"
  fi
}

action="${1:-up}"
shift || true

case "$action" in
  create)
    # Scaffolding is additive by default: `pnpm migrate create <name>` writes a
    # single file to migrations/. For a destructive migration use
    # `create-removal` (below), which writes to migrations-removal/. Running
    # `create` against both phases would emit a spurious second migration.
    mig migrations migrations create "$@"
    ;;
  create-removal)
    # Scaffold a destructive migration (DROP COLUMN/TABLE, RENAME) directly into
    # migrations-removal/, which runs post-deploy so the drop never executes
    # while the previous code revision is still serving.
    mig migrations-removal migrations_removal create "$@"
    ;;
  down)
    # Revert the requested count across the combined newest-first timeline of
    # both phases, not the whole removal phase. Read both tracking tables, order
    # by application time, take the top $count, and roll each back from its own
    # phase — coalescing consecutive same-phase entries into one `down K` so a
    # full-chain rollback (CI) stays ~2 calls, not one per migration. Uses the
    # DB (not filenames) as the source of truth because --no-check-order lets
    # migrations apply out of filename order.
    count="${1:-1}"
    applied_phases=$(psql -h "${PGHOST:-localhost}" -At -c "
      SELECT phase FROM (
        SELECT 'additive' AS phase, name, run_on FROM migrations
        UNION ALL
        SELECT 'removal' AS phase, name, run_on FROM migrations_removal
      ) applied
      ORDER BY run_on DESC, name DESC
      LIMIT ${count}") || {
      echo "migrate-local.sh: failed to read migration tracking tables" >&2
      exit 1
    }
    phase="" run=0
    while read -r p; do
      [ -z "$p" ] && continue
      if [ -n "$phase" ] && [ "$p" != "$phase" ]; then
        rollback_run "$phase" "$run"
        run=0
      fi
      phase="$p"
      run=$((run + 1))
    done <<< "$applied_phases"
    rollback_run "$phase" "$run"
    ;;
  *)
    # Apply actions (up, redo, …) run against both phases: additive first, then
    # removal.
    mig migrations migrations "$action" "$@"
    mig migrations-removal migrations_removal "$action" "$@"
    ;;
esac
