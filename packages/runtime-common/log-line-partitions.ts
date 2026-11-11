// `boxel_log_lines` is partitioned by realm (the logs-layer migration in
// packages/postgres): each realm's lines live in a partition of their own,
// which every statement reaches by naming `realm_url`, and which deleting the
// realm drops. `boxel_log_realms` records each realm's partition.
//
// A realm's partition is created the first time its lines are written, in a
// transaction of its own and before the write: attaching a partition locks
// the DEFAULT partition, which a write transaction that had already written
// lines there would hold. Creation is serialized by an advisory lock and is a
// no-op for a realm that has one, so writers in several processes may race
// to create the same realm's. A realm whose partition can't be made in time
// (`lock_timeout`) has its lines written into the DEFAULT partition, where
// every read still finds them, and moved out when its partition is created.
// The same pattern as the vector store's per-space partitions
// (`vector-store-pg.ts`).

import type { DBAdapter } from './db.ts';
import { param, type Expression, type Querier } from './expression.ts';
import { logger } from './log.ts';
import { sqlTextLiteral } from './sql-literal.ts';

const log = logger('realm:log-lines');

const DEFAULT_PARTITION = 'boxel_log_lines_default';

// A readable prefix of the realm's URL (its host and path, lowercased, runs
// of other characters as `_`) and a hash of the whole URL; the migration
// names the partitions it makes the same way.
const partitionNameSql = `'boxel_log_lines_'
  || left(coalesce(nullif(trim(both '_' FROM regexp_replace(
       lower(regexp_replace($1::text, '^[a-z]+://', '')),
       '[^a-z0-9]+', '_', 'g')), ''), 'realm'), 24)
  || '_' || left(md5($1::text), 8)`;

// Autovacuum and analyze for a realm's partition: a partitioned parent
// can't hold storage parameters, so each leaf gets them when it is made (as
// migration 1794348725000 gives the partitions that existed before it). An
// append-mostly table needs its insert threshold low to be analyzed often
// enough for its plans to keep up.
const PARTITION_STORAGE = `autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 500, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 500, autovacuum_vacuum_insert_scale_factor = 0.05`;

// The realms known to have a partition, per adapter.
const known = new WeakMap<DBAdapter, Set<string>>();

// Gives `realmURL` its partition of `boxel_log_lines`, if the table is
// partitioned and the realm has none, moving any of its lines the DEFAULT
// partition holds into it. Never throws: a realm left without a partition
// writes into the DEFAULT one.
export async function ensureLogPartition(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<void> {
  if (dbAdapter.kind !== 'pg') {
    return;
  }
  let realms = known.get(dbAdapter) ?? new Set<string>();
  known.set(dbAdapter, realms);
  if (realms.has(realmURL)) {
    return;
  }
  try {
    await dbAdapter.withTransaction(
      async (q) => {
        let [partitioned] = await q([
          `SELECT EXISTS (SELECT 1 FROM pg_partitioned_table
             WHERE partrelid = to_regclass('boxel_log_lines')) AS partitioned`,
        ] as Expression);
        if (!partitioned?.partitioned) {
          return;
        }
        await q([`SET LOCAL lock_timeout = '2s'`] as Expression);
        await q([
          `SELECT pg_advisory_xact_lock(hashtext('boxel_log_lines partitions'))`,
        ] as Expression);
        let [existing] = await q([
          'SELECT partition_name FROM boxel_log_realms WHERE realm_url =',
          param(realmURL),
        ] as Expression);
        if (existing) {
          return;
        }
        let [named] = await dbAdapter.execute(
          `SELECT ${partitionNameSql} AS name`,
          { bind: [realmURL] },
        );
        let name = String(named.name);
        if (!/^[a-z0-9_]+$/.test(name)) {
          throw new Error(`unexpected partition name ${name}`);
        }
        // A table of the parent's shape, filled with the realm's lines the
        // DEFAULT partition holds, then attached: attaching locks the parent
        // only against other DDL, where creating the table as a partition
        // would lock out every read and write of the parent.
        await q([
          `CREATE TABLE ${name} (LIKE boxel_log_lines INCLUDING DEFAULTS INCLUDING CONSTRAINTS) WITH (${PARTITION_STORAGE})`,
        ] as Expression);
        await q([
          `WITH moved AS (DELETE FROM ${DEFAULT_PARTITION} WHERE realm_url =`,
          param(realmURL),
          `RETURNING *) INSERT INTO ${name} SELECT * FROM moved`,
        ] as Expression);
        await q([
          `ALTER TABLE boxel_log_lines ATTACH PARTITION ${name} FOR VALUES IN (${sqlTextLiteral(realmURL)})`,
        ] as Expression);
        await q([
          'INSERT INTO boxel_log_realms (realm_url, partition_name) VALUES (',
          param(realmURL),
          ',',
          param(name),
          ')',
        ] as Expression);
      },
      { label: `log partition for ${realmURL}` },
    );
    realms.add(realmURL);
  } catch (e) {
    log.warn(
      `could not create the log-line partition for ${realmURL}; its lines stay in the default partition: ${(e as Error).message}`,
    );
  }
}

// Drops `realmURL`'s partition of `boxel_log_lines` and its catalog row, and
// deletes any of its lines the DEFAULT partition holds. For deleting a realm.
export async function dropLogPartition(
  dbAdapter: DBAdapter,
  q: Querier,
  realmURL: string,
): Promise<void> {
  if (dbAdapter.kind !== 'pg') {
    return;
  }
  let [row] = await q([
    'SELECT partition_name FROM boxel_log_realms WHERE realm_url =',
    param(realmURL),
  ] as Expression);
  let name = row?.partition_name ? String(row.partition_name) : undefined;
  if (name && /^[a-z0-9_]+$/.test(name)) {
    await q([`DROP TABLE IF EXISTS ${name}`] as Expression);
  }
  await q([
    'DELETE FROM boxel_log_realms WHERE realm_url =',
    param(realmURL),
  ] as Expression);
  await q([
    'DELETE FROM boxel_log_lines WHERE realm_url =',
    param(realmURL),
  ] as Expression);
  known.get(dbAdapter)?.delete(realmURL);
}
