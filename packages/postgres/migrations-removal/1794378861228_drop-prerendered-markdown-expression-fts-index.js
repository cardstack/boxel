// Post-deploy: drop the expression index the `matches` filter used before it
// read the stored `markdown_tsv` column (see
// migrations/1794378861227_add-prerendered-markdown-tsv.js). It runs after the
// previous code revision has drained, because that revision still queries
// `to_tsvector('english', markdown_search_text(markdown))` and needs this
// index while it serves. Dropping it saves recomputing that expression on
// every prerendered_html write.

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS prerendered_html_markdown_fts_idx`,
  );
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS prerendered_html_markdown_fts_idx
      ON prerendered_html
      USING GIN (to_tsvector('english', markdown_search_text(markdown)))
  `);
};
