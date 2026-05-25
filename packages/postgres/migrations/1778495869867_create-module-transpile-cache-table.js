exports.shorthands = undefined;

let table = 'module_transpile_cache';

// CS-11030: cross-process coalesce for Realm.#moduleCache transpile.
// Stores the bytes produced by transpileJS keyed on (realm_url,
// canonical_path) so peer realm-server processes can re-read a row
// produced by the coordinator winner instead of each running babel on
// their own. Same UNLOGGED, RAM-backed shape as the `modules` definition
// cache — losing the data on Postgres restart only forces a re-transpile
// on next miss; nothing about correctness depends on durability.
//
// `generation` is the per-row OCC counter that closes the invalidate-
// during-transpile race for the L2 layer (mirrors CS-11028's L1 guard).
// Invalidation upserts a tombstone (body = headers = dependency_keys =
// NULL) and bumps `generation`. A writer captures the row's generation
// at the L2 read step, transpiles, then UPSERTs with that captured
// value via `ON CONFLICT DO UPDATE WHERE existing.generation <=
// captured` — if any peer's invalidate has bumped the row past the
// captured value the update is rejected, so a stale transpile started
// before the invalidate never resurrects the row.
//
// body / headers / dependency_keys are nullable so tombstones can sit
// in the row without bytes. Readers treat `body IS NULL` as a cache
// miss but still surface the row's generation so the writer can
// capture it. `created_at` is millis since epoch.
exports.up = (pgm) => {
  pgm.createTable(table, {
    realm_url: { type: 'varchar', notNull: true },
    canonical_path: { type: 'varchar', notNull: true },
    body: 'text',
    headers: 'jsonb',
    dependency_keys: 'jsonb',
    generation: { type: 'bigint', notNull: true, default: 0 },
    created_at: 'bigint',
  });
  pgm.sql(`ALTER TABLE ${table} SET UNLOGGED`);
  pgm.addConstraint(table, `${table}_pkey`, {
    primaryKey: ['realm_url', 'canonical_path'],
  });
  pgm.addIndex(table, ['realm_url']);
};

exports.down = (pgm) => {
  pgm.dropIndex(table, ['realm_url']);
  pgm.dropConstraint(table, `${table}_pkey`);
  pgm.dropTable(table);
};
