// Removal half of the `screenshots` → `captures` rename. Runs post-deploy,
// once the realm-server rollout has stabilized and no task still reading
// `screenshots` is in flight. The additive migration already copied every
// manifest into `captures`, so nothing is lost here.

exports.shorthands = undefined;

exports.up = (pgm) => {
  for (let table of [
    'prerendered_html',
    'prerendered_html_pending',
    'prerendered_html_working',
  ]) {
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
