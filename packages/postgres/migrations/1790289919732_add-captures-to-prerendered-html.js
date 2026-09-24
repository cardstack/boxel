// The declared-capture manifest ({name → {specHash, objectKey, …}}) the
// prerender-html visit writes for each row, renamed from `screenshots` now
// that a declared entry can also be a paged PDF rather than only a raster
// tile. Additive half of the rename: the column is added alongside the old
// one and backfilled, so the previous code revision keeps reading
// `screenshots` until the removal migration drops it post-deploy.
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
