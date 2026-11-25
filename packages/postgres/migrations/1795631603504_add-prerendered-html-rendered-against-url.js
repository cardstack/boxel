// The URL a row's stored HTML was rendered against (ADR 033 §1.8): the
// realm's URL, or its canonical host URL when the realm has host URLs. The
// realm server reads it to translate stored HTML from that URL in a response,
// also after a restart and for HTML that a failed render kept.
//
// Nullable, with no default and no backfill. NULL means the realm's URL,
// which is what every row written before this column was rendered against.
// A nullable column with no default is a catalog edit, so adding it is
// instant whatever the table holds. `prerendered_html_pending` gets the same
// column, since a commit copies every production column out of the pending
// row.
//
// The partial index holds only the live rows rendered against a URL other
// than the realm's. The realm server reads the distinct such URLs of every
// realm from it, so that read touches only those rows, and none while no
// realm renders against a host URL. The predicate is the text of that query
// (`loadRenderedAgainstURLs` in `realm-host-urls.ts`), so the planner matches
// it. The pending table gets no index: nothing reads it there.
//
// CONCURRENTLY because an ordinary build takes a lock that blocks writes for
// its whole duration, and `prerendered_html` is a large table the previous
// revision is still writing to while this runs. It cannot run inside a
// transaction, hence noTransaction(). node-pg-migrate logs `#> WARNING: Need
// to break single transaction! <` when applying this migration; that is
// expected, not a failure. An interrupted CONCURRENTLY build leaves an
// INVALID index under the target name, which `IF NOT EXISTS` would treat as
// done, so the CREATE is preceded by an unconditional DROP. The columns are
// added only where they don't exist, so a retry completes.

exports.shorthands = undefined;

const INDEX = 'prerendered_html_rendered_against_url_index';
const TABLES = ['prerendered_html', 'prerendered_html_pending'];

exports.up = (pgm) => {
  pgm.noTransaction();
  for (let table of TABLES) {
    pgm.addColumn(
      table,
      { rendered_against_url: { type: 'text' } },
      { ifNotExists: true },
    );
  }
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX};`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY ${INDEX}
      ON prerendered_html (realm_url, rendered_against_url)
      WHERE rendered_against_url <> realm_url AND is_deleted IS NOT TRUE;
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX};`);
  for (let table of TABLES) {
    pgm.dropColumn(table, 'rendered_against_url', { ifExists: true });
  }
};
