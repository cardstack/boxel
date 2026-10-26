// A GIN index over `boxel_index.relationship_deps`, for the jsonb containment
// predicate the invalidation fan-out and the commit-time peer check match a
// changed card against, the same way the GIN index on `deps` serves `deps`.
//
// Partial, because rows written before the column existed hold NULL and the
// predicate never matches them.
//
// CONCURRENTLY because an ordinary build takes a lock that blocks writes for
// its whole duration, and `boxel_index` is both the largest table here and one
// the previous revision is still writing to while this runs — the additive
// phase applies before the new code is deployed. It cannot run inside a
// transaction, hence noTransaction(). node-pg-migrate logs
// `#> WARNING: Need to break single transaction! <` when applying this
// migration; that is expected, not a failure.
//
// Separate from the migration that adds the column so a build that is
// interrupted does not take the column with it on retry.
//
// An interrupted CONCURRENTLY build leaves an INVALID index under the target
// name, which the planner ignores and `IF NOT EXISTS` would treat as done. The
// CREATE is therefore preceded by an unconditional DROP, so a retry rebuilds
// it.
//
// `boxel_index_pending` gets no index: the fan-out reads only this pass's own
// staged rows there, and it does not read this column on that table.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_relationship_deps_index;`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_relationship_deps_index
      ON boxel_index USING gin (relationship_deps)
      WHERE relationship_deps IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_relationship_deps_index;`,
  );
};
