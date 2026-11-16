// Whether a run is a Preview (`dry_run`): it runs the script, stages its
// writes and stops before the commit. A Preview that finishes complete keeps
// the files it staged in `run_overlay_files` as the batch it shows, and a
// Preview never counts as the automation's last successful run.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS dry_run boolean NOT NULL DEFAULT false
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      DROP COLUMN IF EXISTS dry_run
  `);
};
