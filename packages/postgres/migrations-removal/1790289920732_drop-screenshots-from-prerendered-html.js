// Removal half of the `screenshots` → `captures` rename. Runs post-deploy,
// once the realm-server rollout has stabilized and no task still reading
// `screenshots` is in flight. The additive migration copied every manifest
// that existed when it ran into `captures`. A row a previous-revision worker
// committed after that holds its manifest only in `screenshots` (a commit
// copies every column the schema holds out of the pending row, writing NULL
// over `captures`), so this drop loses it: the row serves no declared captures
// until its next reindex. That cost is accepted rather than re-copied here.

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
