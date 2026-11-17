// The credits an automation run's admission holds against its identity's
// balance (ADR 029 §1.5).
//
// - `cost_ceiling_credits`: the most the run can cost, in whole credits, set
//   when the spending check admits it.
// - `credit_hold_released_at`: when the hold stopped counting, set once the
//   run has ended and its `run` charge is written, or there is nothing to
//   charge.
//
// Until it is released, admission counts a run's ceiling, less the AI the
// ledger has charged it, against its identity's balance and its automation's
// credit caps, so two runs admitted at once can't both pass on one run's
// worth of balance.
//
// The two partial indexes hold only the runs whose hold hasn't been released,
// so the sums admission makes under the identity's cost lock read the runs in
// flight, not every run ever admitted. `automation_runs_by_automation_created_idx`
// serves the credit caps' read of an automation's recent runs. The table is
// server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS cost_ceiling_credits integer,
      ADD COLUMN IF NOT EXISTS credit_hold_released_at timestamptz
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS automation_runs_credit_holds_by_identity_idx
      ON automation_runs (acts_as, finished_at)
      WHERE cost_ceiling_credits IS NOT NULL
        AND credit_hold_released_at IS NULL
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS automation_runs_credit_holds_by_automation_idx
      ON automation_runs (automation_id, finished_at)
      WHERE cost_ceiling_credits IS NOT NULL
        AND credit_hold_released_at IS NULL
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS automation_runs_by_automation_created_idx
      ON automation_runs (automation_id, created_at)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS automation_runs_by_automation_created_idx`);
  pgm.sql(
    `DROP INDEX IF EXISTS automation_runs_credit_holds_by_automation_idx`,
  );
  pgm.sql(`DROP INDEX IF EXISTS automation_runs_credit_holds_by_identity_idx`);
  pgm.sql(`
    ALTER TABLE automation_runs
      DROP COLUMN IF EXISTS credit_hold_released_at,
      DROP COLUMN IF EXISTS cost_ceiling_credits
  `);
};
