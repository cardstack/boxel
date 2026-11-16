// An automation run's admission: the checks the worker makes before the run
// costs anything (the run's identity, the automation's row, its card and
// script, each declared operation, the run's balance). `admitted_at` records
// when an attempt admitted the run; a run admission refused ends as an error
// whose `error_reason` is the refusal's code.
//
// `automation_notices` records the notices sent when admission refuses a run
// over something only a person can fix, such as an operation whose binding
// isn't approved. One row per recipient: the person the run acts as. The
// unique index keeps one open notice per recipient, automation, reason,
// operation and type: a later refusal of the same kind refreshes it
// (`last_refused_at`) rather than adding another, so an automation that comes
// due every few minutes while its binding stays unapproved holds one notice.
// A notice ends when what it reports is fixed: a run of the automation is
// admitted, or the person approves the operation. The secure origin's key
// page lists them and marks the ones it shows read.
//
// Both are server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS admitted_at timestamptz
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS automation_notices (
      id bigserial PRIMARY KEY,
      -- The Matrix user id the notice is for.
      recipient varchar NOT NULL,
      -- The automation card and its realm, as canonical identifiers.
      automation_id text NOT NULL,
      realm text NOT NULL,
      -- The run admission refused. The notice outlives the run's row.
      run_id uuid REFERENCES automation_runs (id) ON DELETE SET NULL,
      -- The refusal's code, such as binding-not-approved.
      reason varchar NOT NULL,
      -- The declared operation refused, and the type it is declared on, when
      -- the refusal is about one.
      operation varchar,
      target_module text,
      target_name varchar,
      detail text NOT NULL,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      -- The most recent refusal it reports.
      last_refused_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS automation_notices_open_idx
      ON automation_notices (
        recipient,
        automation_id,
        reason,
        COALESCE(operation, ''),
        COALESCE(target_module, ''),
        COALESCE(target_name, '')
      )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS automation_notices_recipient_idx
      ON automation_notices (recipient, created_at)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS automation_notices`);
  pgm.sql(`
    ALTER TABLE automation_runs DROP COLUMN IF EXISTS admitted_at
  `);
};
