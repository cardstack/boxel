// Word statistics are removed (docs/search.md, "Relevance"): full-text
// relevance ranks by proximity over each card's rank vector. Ranking by term
// statistics, if it comes back, comes from a Postgres BM25 extension, not
// from tables the realm keeps. This drops the two tables that
// 1795300001002_search-text-columns created (its add-bm25-term-stats step).
// The typo-correction floor for a caller a policy scopes now counts at query
// time (runtime-common/query-engine/text-search.ts).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS boxel_term_stats`);
  pgm.sql(`DROP TABLE IF EXISTS boxel_realm_text_stats`);
};

exports.down = (pgm) => {
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
};
