// When the reconcile pass enqueued a new job for a run whose job was gone.
// Reconcile gives a run one more job; a run still unfinished with no live job
// after that is ended. Null for a run reconcile never touched.
//
// The table is server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS reconciled_at timestamptz
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs DROP COLUMN IF EXISTS reconciled_at
  `);
};
