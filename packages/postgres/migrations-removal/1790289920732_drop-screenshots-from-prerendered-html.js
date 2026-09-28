// Removal half of the `screenshots` → `captures` rename. Runs post-deploy,
// once the realm-server rollout has stabilized and no task on the previous
// code revision is still in flight.
//
// The additive migration's backfill doesn't cover every row. A commit copies
// every column the live schema holds out of the pending row, so while both
// columns exist, a previous-revision worker's commit writes its manifest to
// `screenshots` and a NULL over `captures`, and a current-revision commit
// does the reverse. The copy below restores exactly the first kind: a row
// the current revision committed has `screenshots` NULL, so a manifest it
// cleared is never resurrected.

exports.shorthands = undefined;

exports.up = (pgm) => {
  for (let table of [
    'prerendered_html',
    'prerendered_html_pending',
    'prerendered_html_working',
  ]) {
    pgm.sql(
      `UPDATE ${table} SET captures = screenshots
       WHERE captures IS NULL AND screenshots IS NOT NULL`,
    );
    pgm.dropColumns(table, ['screenshots']);
  }
};

exports.down = (pgm) => {
  for (let table of [
    'prerendered_html',
    'prerendered_html_pending',
    'prerendered_html_working',
  ]) {
    pgm.addColumns(table, { screenshots: 'jsonb' });
    pgm.sql(
      `UPDATE ${table} SET screenshots = captures WHERE captures IS NOT NULL`,
    );
  }
};
