// Store each rendered card's full-text vector in `prerendered_html.markdown_tsv`
// so every `matches` search reads it instead of recomputing
// `to_tsvector('english', markdown_search_text(markdown))` per row.
//
// The expression index answers "which rows hold these words", but anything it
// can't decide from the index alone recomputes that expression: a phrase (the
// index holds no word positions), a relevance rank, and any plan that probes
// rows by key and filters them. `markdown_search_text` runs a regex over up to
// 400 KB of markdown, so on long documents (talk transcripts) each recompute
// costs ~0.8 ms, and a phrase over a few thousand candidates took seconds.
// Reading a stored vector is a detoast.
//
// The index writer computes the vector as it promotes a pass's staged rows
// into prerendered_html (`promotePrerenderedHtmlPending`), which is the only
// path that writes a production row's markdown. prerendered_html is a
// secondary index the writer owns, so the vector is written on the way in,
// next to the markdown it comes from; there is no trigger. Staging
// (`prerendered_html_pending`) doesn't carry it: a search over a pass's staged
// rows computes it inline.
//
// Deploy safety, for a table that can be large in production:
// - The column is added nullable with no default, a catalog-only change (no
//   table rewrite, no long lock). `GENERATED ... STORED` would rewrite the
//   whole table under an exclusive lock.
// - Existing rows are backfilled in committed batches, so no transaction holds
//   row locks across the table, and searches find them without a reindex.
// - The GIN index is built CONCURRENTLY. An interrupted build leaves an invalid
//   index and an unrecorded migration; rerunning drops it and builds again.
// - The old expression index stays until the post-deploy removal migration,
//   because the previous code revision still queries through it during a
//   rolling deploy.

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `ALTER TABLE prerendered_html ADD COLUMN IF NOT EXISTS markdown_tsv tsvector`,
  );
  pgm.sql(`
    CREATE OR REPLACE PROCEDURE prerendered_markdown_tsv_backfill()
      LANGUAGE plpgsql AS $$
      DECLARE
        updated integer;
      BEGIN
        LOOP
          UPDATE prerendered_html AS p
            SET markdown_tsv = to_tsvector('english', markdown_search_text(p.markdown))
            WHERE (p.url, p.realm_url, p.type) IN (
              SELECT url, realm_url, type FROM prerendered_html
              WHERE markdown_tsv IS NULL AND markdown IS NOT NULL
              LIMIT 500
            );
          GET DIAGNOSTICS updated = ROW_COUNT;
          COMMIT;
          EXIT WHEN updated = 0;
        END LOOP;
      END
    $$;
  `);
  pgm.sql(`CALL prerendered_markdown_tsv_backfill()`);
  pgm.sql(`DROP PROCEDURE prerendered_markdown_tsv_backfill()`);
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS prerendered_html_markdown_tsv_idx`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY prerendered_html_markdown_tsv_idx
      ON prerendered_html USING GIN (markdown_tsv)
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS prerendered_html_markdown_tsv_idx`,
  );
  pgm.sql(`ALTER TABLE prerendered_html DROP COLUMN IF EXISTS markdown_tsv`);
};
