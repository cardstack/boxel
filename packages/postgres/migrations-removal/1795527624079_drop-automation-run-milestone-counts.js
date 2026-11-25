// Drops `count_done` and `count_total` from `automation_run_milestones`. A run
// reports the notable tasks inside a milestone (`automation_run_tasks`), and
// `realm.progress.count(done, total)` records nothing, so no code writes or
// reads the columns.
//
// Dropping a column only changes the catalog, so the brief ACCESS EXCLUSIVE
// lock doesn't rewrite the table.
//
// `down()` adds the columns back empty: the counts they held are gone.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_run_milestones
      DROP COLUMN IF EXISTS count_done,
      DROP COLUMN IF EXISTS count_total
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_run_milestones
      ADD COLUMN IF NOT EXISTS count_done integer,
      ADD COLUMN IF NOT EXISTS count_total integer
  `);
};
