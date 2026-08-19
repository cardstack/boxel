#!/bin/sh
# Apply pending DB migrations for one phase and exit with node-pg-migrate's
# status, so a failing migration surfaces as a non-zero exit. Run from the
# image's WORKDIR (/boxel/packages/postgres).
#
# Two phases, each with its own migrations directory and tracking table:
#   run-migrations.sh                                    → migrations/  (table: migrations)
#   run-migrations.sh migrations-removal migrations_removal
#
# The default phase (migrations/) holds additive, backward-compatible changes
# and runs BEFORE the app rolls out. The removal phase (migrations-removal/)
# holds destructive changes — column/table drops and renames — and runs only
# AFTER the new app is fully live (see the migrate-db-remove job in
# manual-deploy.yml), so a drop never executes while a task on the previous
# code revision is still querying the column.
#
# Used two ways in either phase:
#   - the pg-migration container's CMD wraps the default phase in
#     `... && sleep infinity` so the long-lived service stays up after a
#     successful migrate
#   - the deploy runs each phase as a one-shot task (command override, no
#     sleep) and gates the rollout on its exit code
set -e

DIR="${1:-migrations}"
TABLE="${2:-migrations}"

# Normalize legacy migration filenames before running (see fix-migration-names).
# Only the default migrations directory has legacy names to repair.
if [ "$DIR" = "migrations" ]; then
  node ./scripts/fix-migration-names.ts
fi

# --ignore-pattern keeps node-pg-migrate from treating non-migration files in
# the migrations directory (the `{ "type": "commonjs" }` package.json that pins
# migrations to CommonJS, plus .eslintrc.js) as migrations. Without it,
# package.json is loaded as a migration, has no `up` export, and the whole `up`
# run errors and rolls back — so no migrations apply. (.eslintrc.js is a dotfile
# and ignored by default; package.json is not, so it must be listed explicitly.)
exec ./node_modules/.bin/node-pg-migrate \
  --check-order false \
  --migrations-dir "$DIR" \
  --migrations-table "$TABLE" \
  --ignore-pattern '.*\.eslintrc\.js|package\.json' \
  up
