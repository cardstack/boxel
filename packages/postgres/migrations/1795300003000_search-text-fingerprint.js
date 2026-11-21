// `boxel_index.search_text_fp` is the md5 of the search text the render
// stamped into a card's staged search doc (`_searchText`), which the promoted
// doc doesn't keep: it lives on as `search_tsv`, `rank_tsv` and
// `pattern_text`. A promotion compares a staged row with its live row to
// write an unchanged row's bookkeeping alone, and this column is how it tells
// that the search text is unchanged without rebuilding the vectors.
//
// Nullable, no default, no backfill: a catalog-only change. A row gains its
// fingerprint the next time it is indexed, and until then counts as changed.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(
    `ALTER TABLE boxel_index ADD COLUMN IF NOT EXISTS search_text_fp TEXT`,
  );
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE boxel_index DROP COLUMN IF EXISTS search_text_fp`);
};
