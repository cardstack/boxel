// Removal half of the `screenshots` → `captures` rename. Runs post-deploy,
// once the realm-server rollout has stabilized and no task still reading
// `screenshots` is in flight. The additive migration copied every manifest
// that existed when it ran into `captures`. A row a previous-revision worker
// committed after that holds its manifest only in `screenshots` (a commit
// copies every column the schema holds out of the pending row, writing NULL
// over `captures`), so this drop loses it: the row serves no declared captures
// until its next reindex. That cost is accepted rather than re-copied here.
//
// The declared-capture retry state on `diagnostics` moves to its current keys
// here too (`screenshotErrors` → `captureErrors`,
// `screenshotCaptureFailureRenders` → `captureFailureRenders`), so a row that
// was mid-retry at deploy time stays in the reconcile sweep's retry arm and
// keeps its failure counts. Post-deploy rather than additive because the
// previous revision reads and writes the old keys until it drains; running
// after it catches the rows it wrote during the rollout as well.

exports.shorthands = undefined;

exports.up = (pgm) => {
  for (let table of ['prerendered_html', 'prerendered_html_pending']) {
    pgm.dropColumns(table, ['screenshots']);
    pgm.sql(
      `UPDATE ${table}
          SET diagnostics = (diagnostics - 'screenshotErrors' - 'screenshotCaptureFailureRenders')
            || jsonb_strip_nulls(jsonb_build_object(
                 'captureErrors', diagnostics->'screenshotErrors',
                 'captureFailureRenders', diagnostics->'screenshotCaptureFailureRenders'))
        WHERE diagnostics ?| array['screenshotErrors', 'screenshotCaptureFailureRenders']`,
    );
  }
};

exports.down = (pgm) => {
  for (let table of ['prerendered_html', 'prerendered_html_pending']) {
    pgm.addColumns(table, { screenshots: 'jsonb' });
    pgm.sql(
      `UPDATE ${table} SET screenshots = captures WHERE captures IS NOT NULL`,
    );
  }
};
