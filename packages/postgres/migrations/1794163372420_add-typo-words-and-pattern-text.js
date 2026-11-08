// What `typos` and `patterns` search (docs/search-intent.md) read, on stock
// Postgres with pg_trgm (added by `add-search-doc-title-trigram-indexes`).
//
// `boxel_index_words` is each realm's word list: the words of every field
// declared `typos: true`, lowercased, three letters or more. A
// `matches … typos: true` term looks up the listed words closest to each of
// its words (trigram similarity, through the GIN index) and matches any of
// them, so "kleppman" finds "Kleppmann". The index writer adds a pass's words
// as it promotes the pass; a word that no card holds any more stays listed and
// matches nothing.
//
// `boxel_index.pattern_text` holds the values of a card's pattern fields
// (declared `patterns: true`, or an `identifier` or `code` role), one per
// line, trigram-indexed so a glob or regex filter narrows to the rows that
// can match before it checks the field itself.
//
// Both are additive: the column is nullable with no default, the indexes are
// built CONCURRENTLY, and a row gains its values the next time it is indexed.

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS boxel_index_words (
      realm_url TEXT NOT NULL,
      word TEXT NOT NULL,
      CONSTRAINT boxel_index_words_pkey PRIMARY KEY (realm_url, word)
    )
  `);
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_words_trgm_idx`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_words_trgm_idx
      ON boxel_index_words USING GIN (word gin_trgm_ops)
  `);
  pgm.sql(`ALTER TABLE boxel_index ADD COLUMN IF NOT EXISTS pattern_text TEXT`);
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_pattern_text_idx`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_pattern_text_idx
      ON boxel_index USING GIN (pattern_text gin_trgm_ops)
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_pattern_text_idx`);
  pgm.sql(`ALTER TABLE boxel_index DROP COLUMN IF EXISTS pattern_text`);
  pgm.sql(`DROP TABLE IF EXISTS boxel_index_words`);
};
