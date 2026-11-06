// A small, inline ranking vector and title for every row, so ranking stays
// fast whatever a realm's cards hold (docs/search-intent.md).
//
// `search_tsv` holds every field word a card has, which makes it a good
// match vector but an expensive rank vector: a card with a long body field
// carries a vector of hundreds of kilobytes, stored out of line, and ranking
// thousands of matches reads every one of them. `rank_tsv` holds the words
// that decide relevance (titles, names and aliases; summaries, keywords and
// labels; and only the start of plain and body text) capped so it stays
// inline in the row (under the ~2 KB at which Postgres moves a value out of
// line). Ranking reads it alone; matching still reads the full vectors.
//
// `search_title` is the row's display title, lowercased, also inline: type-
// ahead ranks a title that equals or starts with what was typed above other
// matches, without reading the search doc.
//
// Additive: nullable columns with no default; a row gains them the next
// time it is indexed, and ranks lowest until then.

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE boxel_index ADD COLUMN IF NOT EXISTS rank_tsv tsvector`);
  pgm.sql(`ALTER TABLE boxel_index ADD COLUMN IF NOT EXISTS search_title TEXT`);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION search_rank_vector(t JSONB) RETURNS tsvector
      LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
        SELECT
          setweight(to_tsvector('english', left(coalesce(t ->> 'A', ''), 400)), 'A') ||
          setweight(to_tsvector('english', left(coalesce(t ->> 'B', ''), 600)), 'B') ||
          setweight(to_tsvector('english', left(coalesce(t ->> 'C', ''), 600)), 'C') ||
          setweight(to_tsvector('english', left(coalesce(t ->> 'D', ''), 400)), 'D')
      $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE boxel_index DROP COLUMN IF EXISTS rank_tsv`);
  pgm.sql(`ALTER TABLE boxel_index DROP COLUMN IF EXISTS search_title`);
  pgm.sql(`DROP FUNCTION IF EXISTS search_rank_vector(JSONB)`);
};
