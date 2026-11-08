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
// Additive: nullable columns with no default. Existing rows are backfilled in
// committed batches, so no transaction holds row locks across the table: the
// title from the stored doc, and the rank vector from the row's match vector
// (`search_tsv`) when that is small enough to stay inline, else its title and
// summary tiers alone (`ts_filter` A and B), which always are. A row the next
// index pass reaches gets the full rank vector; a row with no match vector
// yet (indexed before search intent) ranks lowest until it is reindexed.

exports.up = (pgm) => {
  pgm.noTransaction();
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
  pgm.sql(`
    CREATE OR REPLACE PROCEDURE boxel_index_rank_vector_backfill()
      LANGUAGE plpgsql AS $$
      DECLARE
        updated integer;
      BEGIN
        LOOP
          UPDATE boxel_index AS b
            SET rank_tsv = COALESCE(
                  b.rank_tsv,
                  CASE
                    WHEN b.search_tsv IS NULL THEN NULL
                    WHEN pg_column_size(b.search_tsv) <= 1800 THEN b.search_tsv
                    ELSE ts_filter(b.search_tsv, '{a,b}')
                  END
                ),
                search_title = COALESCE(
                  b.search_title,
                  lower(b.search_doc ->> '_title')
                )
            WHERE (b.url, b.realm_url, b.type) IN (
              SELECT url, realm_url, type FROM boxel_index
              WHERE (rank_tsv IS NULL AND search_tsv IS NOT NULL)
                 OR (search_title IS NULL AND search_doc ? '_title')
              LIMIT 500
            );
          GET DIAGNOSTICS updated = ROW_COUNT;
          COMMIT;
          EXIT WHEN updated = 0;
        END LOOP;
      END
    $$;
  `);
  pgm.sql(`CALL boxel_index_rank_vector_backfill()`);
  pgm.sql(`DROP PROCEDURE boxel_index_rank_vector_backfill()`);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`ALTER TABLE boxel_index DROP COLUMN IF EXISTS rank_tsv`);
  pgm.sql(`ALTER TABLE boxel_index DROP COLUMN IF EXISTS search_title`);
  pgm.sql(`DROP FUNCTION IF EXISTS search_rank_vector(JSONB)`);
};
