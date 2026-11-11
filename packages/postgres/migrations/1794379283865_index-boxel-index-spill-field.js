// An index of the realm and root field each spilled value belongs to. A
// list-path match asks, once per search, whether the realm holds any spilled
// list under the path's root (`handleSpillArm` in runtime-common's
// index-query-engine); with none it drops the arm that reads spilled lists,
// and the search doc's GIN index answers the match alone. Without this index
// that probe reads the realm's spill rows until it finds one, which for a
// root that never spilled is all of them.
//
// CONCURRENTLY because an ordinary build blocks writes to the table for its
// whole duration, and the previous revision is still writing while this
// runs. It cannot run inside a transaction, hence noTransaction(). An
// interrupted CONCURRENTLY build leaves an INVALID index under the name, which
// `IF NOT EXISTS` would treat as done, so the CREATE follows an unconditional
// DROP and a retry rebuilds it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_spill_field_idx;`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_spill_field_idx
      ON boxel_index_spill (realm_url, field_path);
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_spill_field_idx;`);
};
