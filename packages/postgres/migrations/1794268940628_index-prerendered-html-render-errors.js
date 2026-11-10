// A partial index of the prerendered_html rows that hold a render error. A
// search's "not errored" test asks, per candidate row, whether a current
// render error exists (`notEffectivelyErrored` in runtime-common's
// index-query-engine), as a NOT EXISTS this index answers. Few rows ever hold
// an error, so the index stays small and cached, and a query that tests
// thousands of candidates no longer reads each one's prerendered row.
//
// CONCURRENTLY because an ordinary build blocks writes to the table for its
// whole duration, and the previous revision is still writing renders while
// this runs. It cannot run inside a transaction, hence noTransaction(). An
// interrupted CONCURRENTLY build leaves an INVALID index under the name, which
// `IF NOT EXISTS` would treat as done, so the CREATE follows an unconditional
// DROP and a retry rebuilds it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS prerendered_html_render_error_index;`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY prerendered_html_render_error_index
      ON prerendered_html (url, realm_url, type, generation)
      WHERE error_doc IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS prerendered_html_render_error_index;`,
  );
};
