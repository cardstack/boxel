exports.shorthands = undefined;

// Rebuild the boxel_index / boxel_index_working markdown FTS indexes onto
// `markdown_search_text(markdown)` (created in the prerendered_html migration),
// matching the prerendered_html indexes and the `matches` query predicate.
//
// The original indexes (migration 1776790148459) index the raw
// `to_tsvector('english', coalesce(markdown, ''))`. That build fails on rows
// whose markdown exceeds Postgres's ~1 MiB tsvector limit (base64 image data) —
// and because it was built CONCURRENTLY, the failure left the indexes INVALID
// (they enforce nothing and the planner ignores them, so those oversized rows
// were able to land and full-text search fell back to seq scans). Rebuilding
// onto the sanitizing function makes the indexes buildable, valid, and
// consistent with the prerendered_html side that reads them via the dual-read
// fallback.
//
// CONCURRENTLY (so live writers on boxel_index aren't blocked) requires
// noTransaction — CREATE/DROP INDEX CONCURRENTLY cannot run inside a
// transaction.

exports.up = (pgm) => {
  pgm.noTransaction();
  // `markdown_search_text` is normally created by the prerendered_html migration
  // (1783182911063). But a database that already recorded that migration before
  // it was edited to add the function will not rerun it, so define the function
  // here too (idempotently, identical body) BEFORE the indexes reference it —
  // otherwise this non-transactional migration would drop the FTS indexes and
  // then fail with "function markdown_search_text(text) does not exist",
  // leaving the database with no markdown indexes.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION markdown_search_text(md text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE
      AS $$
        SELECT left(
          regexp_replace(coalesce(md, ''), '[A-Za-z0-9+/=]{255,}', ' ', 'g'),
          400000
        )
      $$;
  `);
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_markdown_fts_idx;`);
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_working_markdown_fts_idx;`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS boxel_index_markdown_fts_idx
      ON boxel_index
      USING GIN (to_tsvector('english', markdown_search_text(markdown)));
  `);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS boxel_index_working_markdown_fts_idx
      ON boxel_index_working
      USING GIN (to_tsvector('english', markdown_search_text(markdown)));
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_markdown_fts_idx;`);
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_working_markdown_fts_idx;`,
  );
  // Restore the original raw expression. On data with oversized markdown this
  // build fails and leaves the index INVALID — which is exactly the pre-repair
  // state, so the down migration faithfully reverses the up.
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
