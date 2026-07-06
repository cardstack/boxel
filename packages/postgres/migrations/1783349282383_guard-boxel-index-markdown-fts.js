exports.shorthands = undefined;

// Rebuild the boxel_index / boxel_index_working markdown FTS indexes onto
// `markdown_search_text(markdown)`, matching the prerendered_html indexes and
// the `matches` query predicate.
//
// A raw `to_tsvector('english', coalesce(markdown, ''))` index cannot build on
// rows whose markdown exceeds Postgres's ~1 MiB tsvector limit (base64 image
// data). Built CONCURRENTLY, that failure leaves the index INVALID rather than
// aborting — so it enforces nothing, the planner ignores it, and full-text
// search runs on a seq scan. Rebuilding onto the sanitizing function makes the
// indexes buildable, valid, and consistent with the prerendered_html side that
// reads them via the dual-read fallback.
//
// The replacement is built under a temporary name and then swapped in (drop the
// old index, rename the new one), so the existing index keeps serving until the
// replacement is ready — no window without an index, and a failed build leaves
// the current index untouched. CONCURRENTLY (so live writers on boxel_index
// aren't blocked) requires noTransaction — CREATE/DROP INDEX CONCURRENTLY cannot
// run inside a transaction.

const MARKDOWN_FTS_TABLES = ['boxel_index', 'boxel_index_working'];

// Build `<table>_markdown_fts_idx` from `expression` via a build-first swap. The
// leading DROP of the temp index clears any invalid leftover from an interrupted
// prior attempt, so a re-run rebuilds cleanly.
function swapMarkdownFtsIndex(pgm, table, expression) {
  let idx = `${table}_markdown_fts_idx`;
  let tmp = `${idx}_rebuild`;
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${tmp};`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY ${tmp}
      ON ${table}
      USING GIN (to_tsvector('english', ${expression}));
  `);
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${idx};`);
  pgm.sql(`ALTER INDEX ${tmp} RENAME TO ${idx};`);
}

exports.up = (pgm) => {
  pgm.noTransaction();
  // `markdown_search_text` is also created by the migration that adds the
  // prerendered_html tables. A database that already recorded that migration
  // will not rerun it, so define the function here too (idempotently, identical
  // body) BEFORE the indexes reference it — otherwise this migration would build
  // an index against a function that does not exist.
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
  for (let table of MARKDOWN_FTS_TABLES) {
    swapMarkdownFtsIndex(pgm, table, 'markdown_search_text(markdown)');
  }
};

exports.down = (pgm) => {
  pgm.noTransaction();
  // Restore the original raw expression via the same build-first swap. On data
  // with oversized markdown this build fails (the pre-repair state), but the
  // current index keeps serving because it isn't dropped until the rebuild
  // succeeds.
  for (let table of MARKDOWN_FTS_TABLES) {
    swapMarkdownFtsIndex(pgm, table, `coalesce(markdown, '')`);
  }
};
