// The declared-capture manifest ({name → {specHash, objectKey, …}}) the
// prerender-html visit writes for each row, under the name that covers a
// paged PDF as well as a raster tile. Additive half of the `screenshots` →
// `captures` rename: the column is added alongside the old one and
// backfilled, and the previous code revision keeps reading and writing
// `screenshots` until the removal migration drops it post-deploy. Its commits
// also write NULL over `captures` meanwhile (a commit copies every column
// the schema holds out of the pending row); the removal migration re-copies
// those rows before it drops the old column.
//
// Added to the production table and both twins — `prerendered_html_pending`
// (a pass stages rows there and the commit copies every production column
// out) and `prerendered_html_working` — which must stay column-compatible.

exports.shorthands = undefined;

exports.up = (pgm) => {
  for (let table of [
    'prerendered_html',
    'prerendered_html_pending',
    'prerendered_html_working',
  ]) {
    pgm.addColumns(table, { captures: 'jsonb' });
    // Carry existing manifests across so already-indexed rows keep serving
    // their captures until their next reindex rewrites them.
    pgm.sql(
      `UPDATE ${table} SET captures = screenshots WHERE screenshots IS NOT NULL`,
    );
  }
};

exports.down = (pgm) => {
  for (let table of [
    'prerendered_html',
    'prerendered_html_pending',
    'prerendered_html_working',
  ]) {
    pgm.dropColumns(table, ['captures']);
  }
};
