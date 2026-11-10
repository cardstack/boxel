// An index for the `typeahead` filter.
//
// A card's title and its `cardInfo.alternativeNames` are stamped into its
// search doc's `_typeahead` key: a few words such as a name or a synonym. The
// `typeahead` filter matches every typed word as a word prefix of that text,
// using an unstemmed ('simple') tsvector so a partial word is never stemmed
// out of reach. The query engine's predicate is this exact expression,
// `to_tsvector('simple', coalesce(search_doc ->> '_typeahead', ''))`, so the
// planner can use the index. Rows without the key index an empty vector.
//
// Built CONCURRENTLY so live index writers aren't blocked, which needs
// noTransaction.

exports.up = (pgm) => {
  pgm.noTransaction();
  // An interrupted CONCURRENTLY build leaves an INVALID index that `IF NOT
  // EXISTS` would treat as done, so the build follows a DROP and a retry
  // rebuilds it. Separate statements: CONCURRENTLY can't share one.
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_type_ahead_idx;`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_type_ahead_idx
      ON boxel_index
      USING GIN (to_tsvector('simple', coalesce(search_doc ->> '_typeahead', '')));
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_type_ahead_idx;`);
};
