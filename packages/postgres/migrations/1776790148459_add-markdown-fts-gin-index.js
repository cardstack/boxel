// GIN expression index on to_tsvector('english', markdown) for full-text
// search via the `matches` filter. Index definition must match the
// expression emitted by matchesCondition() in
// packages/runtime-common/index-query-engine.ts — same language literal
// and coalesce() wrapper — otherwise the planner will not use it.
//
// `boxel_index_working` mirrors `boxel_index` because the search path
// can target either table via the useWorkInProgressIndex query option.
//
// CONCURRENTLY avoids locking writes during long builds in production.
// node-pg-migrate's outer singleTransaction wrapper is broken for this
// migration via pgm.noTransaction() — CREATE INDEX CONCURRENTLY cannot
// run inside a transaction at all.

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS boxel_index_markdown_fts_idx
      ON boxel_index
      USING GIN (to_tsvector('english', coalesce(markdown, '')));
  `);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS boxel_index_working_markdown_fts_idx
      ON boxel_index_working
      USING GIN (to_tsvector('english', coalesce(markdown, '')));
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_markdown_fts_idx;`);
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_working_markdown_fts_idx;`,
  );
};
