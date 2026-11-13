// An automation run's log (ADR 025 §1.1): one `automation_run_log` row per
// line, in the order the run made them. `source` says who wrote the line:
// `script` for the script's console lines, activity lines, run milestones and
// its uncaught error, which the run's tab sends with the run's token;
// `platform` for what the realm server did on the run's behalf (each
// `callApi` and `resolve` call, the commit, how the run ended). `kind`
// is the line's kind (`console`, `activity`, `plan`, `milestone`, `count`,
// `error`, `call-api`, `resolve`, `commit`, `finish`), `level` its console level,
// and `script_line` the line of the script it came from, when known. `data`
// holds what the kind adds, such as a call's status, time and size. Every
// text is redacted before it is stored.
//
// A run's log is capped. The counts on the run row (`log_lines`,
// `log_chars`) are what the cap is checked against, under the row's lock, and
// `log_dropped` counts the lines refused past it, so the log can say how many
// it dropped.
//
// Deleting a run row deletes its log. The table is server-only, and excluded
// from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS automation_run_log (
      run_id uuid NOT NULL REFERENCES automation_runs (id) ON DELETE CASCADE,
      seq integer NOT NULL,
      at timestamptz NOT NULL,
      source text NOT NULL,
      kind text NOT NULL,
      level text,
      message text NOT NULL,
      script_line integer,
      data jsonb,
      PRIMARY KEY (run_id, seq),
      CONSTRAINT automation_run_log_source_check
        CHECK (source IN ('script', 'platform'))
    )
  `);
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS log_lines integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS log_chars bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS log_dropped integer NOT NULL DEFAULT 0
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      DROP COLUMN IF EXISTS log_lines,
      DROP COLUMN IF EXISTS log_chars,
      DROP COLUMN IF EXISTS log_dropped
  `);
  pgm.sql(`DROP TABLE IF EXISTS automation_run_log`);
};
