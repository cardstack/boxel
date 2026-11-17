// The credits an automation run's admission holds against its identity's
// balance (ADR 029 §1.5): `cost_ceiling_credits` is the most the run can cost,
// in whole credits, set when the spending check admits it. Admission counts
// it, less the AI the run has already been charged for, against the balance
// of the run's identity while the run is in flight, so two runs admitted at
// once can't both pass on one run's worth of balance.
//
// The index serves that count: an identity's admitted runs, the unfinished
// ones and those that ended recently. The table is server-only, and excluded
// from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS cost_ceiling_credits integer
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS automation_runs_credit_holds_idx
      ON automation_runs (acts_as, finished_at)
      WHERE cost_ceiling_credits IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS automation_runs_credit_holds_idx`);
  pgm.sql(`
    ALTER TABLE automation_runs DROP COLUMN IF EXISTS cost_ceiling_credits
  `);
};
