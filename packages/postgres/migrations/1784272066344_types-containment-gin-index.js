// GIN expression index for type-anchored search filters. The types-contains
// predicate in packages/runtime-common/expression.ts compiles to
// `COALESCE(types, '[]'::jsonb) @> '["<type>"]'::jsonb`, and the planner
// only uses an index whose expression matches the query expression — the
// index must cover COALESCE(types, '[]'::jsonb), not the bare column.
// jsonb_path_ops is smaller and faster than the default jsonb_ops and
// supports @>, the only operator this predicate uses.
//
// The bare-column GIN indexes on types (from 1735668047598 and
// 1735832183444) can never serve this predicate, and no other query
// filters on types, so they are dropped here.
//
// `boxel_index_working` mirrors `boxel_index` because the search path
// can target either table via the useWorkInProgressIndex query option.
//
// CONCURRENTLY avoids locking writes during long builds in production.
// node-pg-migrate's outer singleTransaction wrapper is broken for this
// migration via pgm.noTransaction() — CREATE/DROP INDEX CONCURRENTLY
// cannot run inside a transaction at all.

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS boxel_index_types_containment_idx
      ON boxel_index
      USING GIN ((COALESCE(types, '[]'::jsonb)) jsonb_path_ops);
  `);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS boxel_index_working_types_containment_idx
      ON boxel_index_working
      USING GIN ((COALESCE(types, '[]'::jsonb)) jsonb_path_ops);
  `);
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_types_index;`);
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_working_types_index;`);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_types_containment_idx;`,
  );
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_working_types_containment_idx;`,
  );
  // Restore under the original auto-generated names so the down migrations
  // of 1735668047598 and 1735832183444 still find them.
  pgm.sql(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS boxel_index_types_index ON boxel_index USING GIN (types);`,
  );
  pgm.sql(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS boxel_index_working_types_index ON boxel_index_working USING GIN (types);`,
  );
};
