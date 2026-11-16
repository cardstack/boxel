// A Preview (ADR 027 §1.4): `dry_run` marks a run that runs the script,
// stages its writes and stops before the commit. A Preview never counts as
// the automation's last successful run.
//
// `automation_preview_files` is a Preview's result: the files it staged, one
// row per realm-local path with the bytes inline, copied out of the run's
// overlay in the transaction that finishes the Preview complete. The overlay
// itself is discarded there, as for every run. Only a person's latest
// Preview of an automation keeps its files. Deleting the run row deletes
// them. The table is server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS dry_run boolean NOT NULL DEFAULT false
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS automation_preview_files (
      run_id uuid NOT NULL REFERENCES automation_runs (id) ON DELETE CASCADE,
      path text NOT NULL,
      content bytea NOT NULL,
      size integer NOT NULL,
      PRIMARY KEY (run_id, path)
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS automation_preview_files`);
  pgm.sql(`
    ALTER TABLE automation_runs
      DROP COLUMN IF EXISTS dry_run
  `);
};
