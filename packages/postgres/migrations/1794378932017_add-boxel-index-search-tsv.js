// Store each card's role-weighted full-text vector in `boxel_index.search_tsv`
// (docs/search-intent.md).
//
// A card author gives a field a search role (`title`, `summary`, `body`, …),
// and the render groups the card's words by the weight their roles carry: A
// for titles, names and aliases; B for summaries, keywords and labels; C for
// plain text; D for body text, notes and code. It stamps the groups into the
// search doc as `_searchText: { A, B, C, D }`. The index writer builds this
// column from them as it promotes a pass (`search_text_vector`), and the
// promoted doc doesn't keep them. Relevance ranks over this vector together
// with the rendered markdown's, so a word in a title outranks the same word in
// a transcript, and `matches … in: 'title'` reads its A weight alone.
//
// Deploy safety mirrors `add-prerendered-markdown-tsv`: the column is added
// nullable with no default (a catalog-only change), and the GIN index is
// built CONCURRENTLY. There is no backfill: a row gains its vector the next
// time it is indexed, and until then ranks by its markdown alone, as every row
// did before.

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `ALTER TABLE boxel_index ADD COLUMN IF NOT EXISTS search_tsv tsvector`,
  );
  pgm.sql(`
    CREATE OR REPLACE FUNCTION search_text_vector(t JSONB) RETURNS tsvector
      LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
        SELECT
          setweight(to_tsvector('english', left(coalesce(t ->> 'A', ''), 10000)), 'A') ||
          setweight(to_tsvector('english', left(coalesce(t ->> 'B', ''), 40000)), 'B') ||
          setweight(to_tsvector('english', left(coalesce(t ->> 'C', ''), 200000)), 'C') ||
          setweight(to_tsvector('english', left(coalesce(t ->> 'D', ''), 200000)), 'D')
      $$
  `);
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_search_tsv_idx`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_search_tsv_idx
      ON boxel_index USING GIN (search_tsv)
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_search_tsv_idx`);
  pgm.sql(`ALTER TABLE boxel_index DROP COLUMN IF EXISTS search_tsv`);
  pgm.sql(`DROP FUNCTION IF EXISTS search_text_vector(JSONB)`);
};
