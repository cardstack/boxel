// The notable tasks an automation run's script reports inside a milestone
// with `realm.progress.task(text)`, such as "Grouped the bug label". The
// script is their only source.
//
// Each `automation_run_tasks` row is one task the run reported, at
// `position` in the order reported: `milestone_position` is the
// `automation_run_milestones` row the run was in when the script reported
// the task, and `reported_at` is the tab's time for the report.
// `automation_runs.tasks_dropped` counts the tasks a run reported past the
// most a run records, and those reported inside a milestone the run marked
// past its own cap.
//
// The rows are written as the run's log lines arrive, under the run row's
// lock, and outside the log's cap, as milestones are. Deleting a run row
// deletes its tasks. The table is server-only, and excluded from the SQLite
// schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS automation_run_tasks (
      run_id uuid NOT NULL REFERENCES automation_runs (id) ON DELETE CASCADE,
      position integer NOT NULL,
      milestone_position integer NOT NULL,
      text text NOT NULL,
      reported_at timestamptz NOT NULL,
      PRIMARY KEY (run_id, position)
    )
  `);
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS tasks_dropped integer NOT NULL DEFAULT 0
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE automation_runs DROP COLUMN IF EXISTS tasks_dropped`);
  pgm.sql(`DROP TABLE IF EXISTS automation_run_tasks`);
};
