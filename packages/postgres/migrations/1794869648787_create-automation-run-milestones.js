// An automation run's milestones: the steps its script declares with
// `realm.progress.plan([...])` and marks as it reaches each one with
// `realm.progress.milestone(name)`, with the count it reports inside one
// (`realm.progress.count(done, total)`). The script is their only source; the
// automation card holds no list of them.
//
// `automation_runs.milestone_plan` is the plan the script declared last, in
// order. Each `automation_run_milestones` row is one milestone the run
// reached, at `position` in the order it reached them: `started_at` is when
// the script marked it, and the milestone lasts until the next one starts or
// the run ends. `count_done` and `count_total` are the last count reported
// inside it.
//
// The rows are written as the run's log lines arrive, under the run row's
// lock, and outside the log's cap, so a run whose log is full still records
// where it got to. Deleting a run row deletes its milestones. The table is
// server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS automation_run_milestones (
      run_id uuid NOT NULL REFERENCES automation_runs (id) ON DELETE CASCADE,
      position integer NOT NULL,
      name text NOT NULL,
      started_at timestamptz NOT NULL,
      count_done integer,
      count_total integer,
      PRIMARY KEY (run_id, position)
    )
  `);
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS milestone_plan text[],
      ADD COLUMN IF NOT EXISTS milestones_dropped integer NOT NULL DEFAULT 0
  `);
  // The automation's last run, which the card's view reads.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS automation_runs_last_finished_idx
      ON automation_runs (automation_id, finished_at DESC)
      WHERE finished_at IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS automation_runs_last_finished_idx`);
  pgm.sql(`
    ALTER TABLE automation_runs
      DROP COLUMN IF EXISTS milestone_plan,
      DROP COLUMN IF EXISTS milestones_dropped
  `);
  pgm.sql(`DROP TABLE IF EXISTS automation_run_milestones`);
};
