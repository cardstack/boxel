---
name: postgres-migrations
allowed-tools: Read, Grep, Bash
description: How to author Postgres migrations in packages/postgres under the two-phase (additive vs removal) system — additive changes go in migrations/ and run pre-deploy; destructive changes (DROP COLUMN/TABLE, RENAME) go in migrations-removal/ and run post-deploy so they never break the previous code revision mid-rollout. Use whenever creating, editing, moving, or reviewing a migration in packages/postgres, deciding which directory a migration belongs in, or touching the boxel_index / boxel_index_working index tables. Triggers on adding a DB migration, a DROP/RENAME in a migration, or a review of one.
---

# Postgres migrations — the two-phase system

`packages/postgres/` migrations are split into two directories, each with its own
node-pg-migrate tracking table, because a destructive schema change applied
during a rolling deploy breaks the **previous** code revision while it is still
serving (old tasks query a column the migration just dropped).

| Directory             | Tracking table       | When it runs in a deploy                                                                                                  | For                                   |
| --------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `migrations/`         | `migrations`         | **pre**-deploy (`migrate-db` job)                                                                                         | additive, backward-compatible changes |
| `migrations-removal/` | `migrations_removal` | **post**-deploy (`migrate-db-remove` job), gated on the realm-server rollout reaching stability so old tasks have drained | destructive changes                   |

## Which directory?

Ask: **does the migration's `up()` remove or rename something the currently
deployed code still reads?** If yes → `migrations-removal/`.

- **Additive → `migrations/`**: `addColumn`, `createTable`, new index, backfill,
  dual-write. Safe for old code to run against.
- **Destructive → `migrations-removal/`**: `dropColumn` / `dropColumns` /
  `dropTable` / `renameColumn` / `renameTable`, and the raw-SQL equivalents
  (`pgm.sql('ALTER TABLE ... DROP COLUMN ...')`, `RENAME`). Also anything that
  tightens a contract the old code depends on (e.g. adding `NOT NULL` to a
  column old code doesn't populate, narrowing a type).

The standard expand/contract pattern spans **two** releases: release N adds the
new shape and stops reading the old one (additive migration + code); release
N+1 drops the old shape (removal migration). Never ship the drop in the same
release that stops reading it unless you are certain no old task will run against
the new schema.

## Creating a migration

```sh
# additive (the common case) — writes to migrations/
pnpm --filter @cardstack/postgres migrate create <name>

# destructive — writes straight to migrations-removal/
pnpm --filter @cardstack/postgres migrate:create-removal <name>
```

Filenames need a real `Date.now()` millisecond timestamp; `pnpm lint:migrations`
rejects any prefix with 6+ consecutive zeros. `migrate create` stamps a valid
one. Never hand-pick a round number.

Migration files are CommonJS (`exports.up` / `exports.down`); both directories
carry a `package.json` pinning `{ "type": "commonjs" }`.

## Enforcement

`packages/postgres/scripts/check-removal-phase.cjs` (CI: "Guard removal-phase
migrations") AST-parses each **newly added** `migrations/` file and fails if its
`up()` drops or renames a column/table. It is scoped to changed files (so drops
already present in `migrations/` are grandfathered) and looks only at `up()` (an
additive migration's `down()` legitimately calls `dropColumn` to reverse
itself). It is heuristic — it will not catch `NOT NULL` tightening, type
narrowing, or destructive SQL built from non-literal strings — so the decision
rule above still applies.

## Applying migrations locally / in CI

`pnpm migrate up|down [count]|create` is transparent — the driver
(`scripts/migrate-local.sh`) runs both phases as one combined sequence
(additive first on `up`; `down [count]` reverts the N most-recent across both
phases, default 1). You do **not** think about the split when applying; only
when authoring a destructive change.

## Gotchas

- **`boxel_index` and `boxel_index_working` are twin tables that must stay
  schema-identical.** The indexer does `SELECT * FROM boxel_index` and mirrors
  the row shape into `boxel_index_working`, so any column add/drop must touch
  **both** (the removal migration uses `TABLES = ['boxel_index',
'boxel_index_working']`). Changing only one breaks index writes with
  `column "..." of relation "boxel_index_working" does not exist`.
- **Moving an already-applied migration between directories re-runs it** under
  the new tracking table. Only safe if its `up()` is idempotent (`IF EXISTS` /
  `ifNotExists`). Moving a not-yet-applied file is always clean.
- **Schema snapshot**: after any migration change run `pnpm make-schema`; the
  host validates the committed `packages/host/config/schema/<latest>_schema.sql`
  against the newest migration across **both** directories.
- `packages/realm-server/migrations/` is a **separate** migration system (not
  this one); don't conflate them.
