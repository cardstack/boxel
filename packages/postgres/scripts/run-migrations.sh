#!/bin/sh
# Apply all pending DB migrations and exit with node-pg-migrate's status, so a
# failing migration surfaces as a non-zero exit. Run from the image's WORKDIR
# (/boxel/packages/postgres). Used two ways:
#   - the pg-migration container's CMD wraps this in `... && sleep infinity` so
#     the long-lived service stays up after a successful migrate
#   - the deploy runs it as a one-shot task (command override, no sleep) and
#     gates the rest of the rollout on its exit code
set -e

# Normalize legacy migration filenames before running (see fix-migration-names).
node ./scripts/fix-migration-names.ts

# --ignore-pattern keeps node-pg-migrate from treating non-migration files in
# the migrations directory (the `{ "type": "commonjs" }` package.json that pins
# migrations to CommonJS, plus .eslintrc.js) as migrations. Without it,
# package.json is loaded as a migration, has no `up` export, and the whole `up`
# run errors and rolls back — so no migrations apply. Mirrors the `migrate`
# script in package.json. (.eslintrc.js is a dotfile and ignored by default;
# package.json is not, so it must be listed explicitly.)
exec ./node_modules/.bin/node-pg-migrate \
  --check-order false \
  --migrations-table migrations \
  --ignore-pattern '.*\.eslintrc\.js|package\.json' \
  up
