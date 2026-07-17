# @cardstack/postgres

Postgres schema and migrations for the boxel stack.

## Migrations run in two phases

Migrations live in two directories, each with its own
[node-pg-migrate](https://github.com/salsita/node-pg-migrate) tracking table:

| Directory             | Tracking table       | Runs during a deploy                                                               | For                                   |
| --------------------- | -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| `migrations/`         | `migrations`         | **before** the app rolls out (`migrate-db`)                                        | additive, backward-compatible changes |
| `migrations-removal/` | `migrations_removal` | **after** the app rolls out (`migrate-db-remove`), once the old tasks have drained | destructive changes                   |

**Why:** a destructive change applied during a rolling deploy breaks the
_previous_ code revision while it's still serving — the old tasks query a column
the migration just dropped and every request 500s until they drain. Deferring
drops/renames until after the new code is fully live avoids this. (This caused
published-realm outages on 2026-07-10, 07-13, and 07-15.) The `migrate-db-remove`
job is gated on the realm-server rollout reaching stability, so by the time a
drop runs there is no task left on the old code.

### Which directory does my migration go in?

Ask: **does `up()` remove or rename something the deployed code still reads?**

- **No → `migrations/`** — `addColumn`, `createTable`, new index, backfill, etc.
- **Yes → `migrations-removal/`** — `dropColumn`/`dropTable`/`renameColumn`/
  `renameTable` (and the raw-SQL equivalents), or anything that tightens a
  contract old code depends on (adding `NOT NULL` to a column old code doesn't
  populate, narrowing a type).

The standard expand/contract pattern spans two releases: release N adds the new
shape and stops reading the old one; release N+1 drops the old shape.

### Creating a migration

```sh
# additive (the common case) → writes to migrations/
pnpm --filter @cardstack/postgres migrate create <name>

# destructive → writes to migrations-removal/
pnpm --filter @cardstack/postgres migrate:create-removal <name>
```

Filenames must use a real `Date.now()` timestamp; `pnpm lint:migrations` rejects
prefixes with 6+ consecutive zeros. `migrate create` stamps a valid one.

A CI check (`scripts/check-removal-phase.cjs`) fails the build if a newly added
`migrations/` migration drops or renames a column/table in its `up()`, pointing
you to `migrations-removal/`. It's scoped to changed files (historical drops are
grandfathered) and inspects only `up()` — an additive migration's `down()` may
call `dropColumn` to reverse itself.

### Applying migrations

`pnpm migrate up | down [count] | create` is transparent — the driver
(`scripts/migrate-local.sh`) runs both phases as one combined sequence. `up`
applies additive then removal; `down [count]` reverts the N most-recent
migrations across both phases (default 1). You only think about the split when
_authoring_ a destructive change, not when applying.

### Gotchas

- **`boxel_index` and `boxel_index_working` are twin tables and must stay
  schema-identical** — the indexer does `SELECT * FROM boxel_index` and mirrors
  the row shape into `boxel_index_working`. Any column change must touch both.
- **Moving an already-applied migration between directories re-runs it** under
  the new tracking table; only safe if `up()` is idempotent (`IF EXISTS` /
  `ifNotExists`). Moving a not-yet-applied file is always clean.
- After changing migrations, run `pnpm make-schema` to regenerate the SQLite
  schema snapshot the host validates.
- `packages/realm-server/migrations/` is a separate migration system.
