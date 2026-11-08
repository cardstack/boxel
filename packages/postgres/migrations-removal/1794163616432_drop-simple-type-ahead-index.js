// Post-deploy: drop the type-ahead index built on Postgres's plain `simple`
// configuration (migrations/1793909895811_add-type-ahead-index.js). The engine
// now queries the accent-folding `boxel_simple` vector, indexed by
// migrations/1794163555429_one-text-search-config.js. It runs after the
// previous code revision has drained, because that revision still queries the
// `simple` vector and needs this index while it serves.

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_type_ahead_idx`);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS boxel_index_type_ahead_idx
      ON boxel_index
      USING GIN (to_tsvector('simple', coalesce(search_doc ->> '_typeahead', '')))
  `);
};
