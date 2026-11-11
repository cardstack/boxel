// Word statistics for text relevance, in plain SQL on stock Postgres
// (docs/search.md). A card type that declares `searchDefaults.wordStatistics`
// ranks its `matches` by each query word's inverse document frequency times
// Postgres's own `ts_rank` of the word in the row's rank vector, so rare words
// count more, repetition saturates, title words outweigh body words and long
// rows are normalized.
//
// - `boxel_term_stats`: each realm's lexemes and how many rows hold each (df).
// - `boxel_realm_text_stats`: each realm's row count and when the statistics
//   were rebuilt. The engine rebuilds them in the background, under an
//   advisory lock, when a search on an opted-in type finds them missing or
//   older than a few minutes; never inside an index commit.
//
// Accents fold: `boxel_english` is the English configuration with `unaccent`
// in front of the stemmer, used for the vectors here and the queries in the
// engine, so "creme" finds "Crème". `boxel_simple` is the unstemmed
// counterpart. Both need only the `unaccent` extension, which RDS ships.
//
// Additive. Existing vectors take the new configuration when the next index
// pass reaches them.

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS boxel_term_stats (
      realm_url TEXT NOT NULL,
      lexeme TEXT NOT NULL,
      df INTEGER NOT NULL,
      PRIMARY KEY (realm_url, lexeme)
    )
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS boxel_realm_text_stats (
      realm_url TEXT PRIMARY KEY,
      doc_count INTEGER NOT NULL,
      rebuilt_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS unaccent`);
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'boxel_english') THEN
        CREATE TEXT SEARCH CONFIGURATION boxel_english (COPY = english);
        ALTER TEXT SEARCH CONFIGURATION boxel_english
          ALTER MAPPING FOR hword, hword_part, word WITH unaccent, english_stem;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'boxel_simple') THEN
        CREATE TEXT SEARCH CONFIGURATION boxel_simple (COPY = simple);
        ALTER TEXT SEARCH CONFIGURATION boxel_simple
          ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;
      END IF;
    END
    $$
  `);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION search_text_vector(t JSONB) RETURNS tsvector
      LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
        SELECT
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'A', ''), 10000)), 'A') ||
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'B', ''), 40000)), 'B') ||
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'C', ''), 200000)), 'C') ||
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'D', ''), 200000)), 'D')
      $$
  `);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION search_rank_vector(t JSONB) RETURNS tsvector
      LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
        SELECT
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'A', ''), 400)), 'A') ||
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'B', ''), 600)), 'B') ||
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'C', ''), 600)), 'C') ||
          setweight(to_tsvector('boxel_english', left(coalesce(t ->> 'D', ''), 400)), 'D')
      $$
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP TABLE IF EXISTS boxel_term_stats`);
  pgm.sql(`DROP TABLE IF EXISTS boxel_realm_text_stats`);
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
  pgm.sql(`DROP TEXT SEARCH CONFIGURATION IF EXISTS boxel_english`);
  pgm.sql(`DROP TEXT SEARCH CONFIGURATION IF EXISTS boxel_simple`);
};
