exports.shorthands = undefined;

// `prerendered_html` / `prerendered_html_working` are the sole home of
// rendered output: every reader sources HTML and markdown from the
// prerendered_html channel, and nothing reads or writes the boxel_index
// copies. Drop the boxel_index HTML/markdown columns and their indexes
// (the markdown FTS GIN indexes explicitly; the fitted/embedded GIN
// indexes fall with their columns). `icon_html` stays — the icon renders
// in the index visit and lives on boxel_index.

const TABLES = ['boxel_index', 'boxel_index_working'];

const HTML_COLUMNS = [
  'isolated_html',
  'head_html',
  'embedded_html',
  'fitted_html',
  'atom_html',
  'markdown',
];

exports.up = (pgm) => {
  // CONCURRENTLY (hence noTransaction) so live readers aren't blocked while
  // the FTS indexes go away; the column drops themselves are metadata-only.
  pgm.noTransaction();
  for (let table of TABLES) {
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${table}_markdown_fts_idx;`);
    // Clear any invalid leftover from an interrupted swap-rebuild of the
    // FTS index.
    pgm.sql(
      `DROP INDEX CONCURRENTLY IF EXISTS ${table}_markdown_fts_idx_rebuild;`,
    );
  }
  for (let table of TABLES) {
    pgm.dropColumns(table, HTML_COLUMNS, { ifExists: true });
  }
};

exports.down = (pgm) => {
  pgm.noTransaction();
  // Restore the columns empty; a from-scratch reindex is required to
  // repopulate them.
  for (let table of TABLES) {
    pgm.addColumns(
      table,
      {
        isolated_html: { type: 'varchar' },
        head_html: { type: 'varchar' },
        embedded_html: { type: 'jsonb' },
        fitted_html: { type: 'jsonb' },
        atom_html: { type: 'varchar' },
        markdown: { type: 'text' },
      },
      { ifNotExists: true },
    );
    pgm.createIndex(table, 'fitted_html', {
      method: 'gin',
      ifNotExists: true,
    });
    pgm.createIndex(table, 'embedded_html', {
      method: 'gin',
      ifNotExists: true,
    });
  }
  for (let table of TABLES) {
    // Drop before create rather than IF NOT EXISTS: a failed CONCURRENTLY
    // build leaves an INVALID index that still exists, which IF NOT EXISTS
    // would skip forever on a re-run.
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${table}_markdown_fts_idx;`);
    pgm.sql(`
      CREATE INDEX CONCURRENTLY ${table}_markdown_fts_idx
        ON ${table}
        USING GIN (to_tsvector('english', markdown_search_text(markdown)));
    `);
  }
};
