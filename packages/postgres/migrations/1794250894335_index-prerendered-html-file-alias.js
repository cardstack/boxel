// An index on `prerendered_html (realm_url, file_alias)`, for the lookup each
// render visit makes of its card's prior capture state (`priorCaptureStates`
// in runtime-common's index-writer), which reads a row by its URL or by its
// file alias. The URL branch is served by the primary key; nothing served the
// alias branch, so Postgres scanned the whole table on every visit.
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
    `DROP INDEX CONCURRENTLY IF EXISTS prerendered_html_realm_file_alias_index;`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY prerendered_html_realm_file_alias_index
      ON prerendered_html (realm_url, file_alias);
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS prerendered_html_realm_file_alias_index;`,
  );
};
