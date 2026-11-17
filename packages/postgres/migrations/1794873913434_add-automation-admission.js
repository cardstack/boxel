// An automation run's admission: the checks the worker makes before a run
// costs anything (the automation's row, the run's identity, its card and
// script, each declared operation, the run's spending). `admitted_at` records
// when an attempt admitted the run; a run admission refused ends as an error
// whose `error_reason` is the refusal's code.
//
// The table is server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS admitted_at timestamptz
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs DROP COLUMN IF EXISTS admitted_at
  `);
};
