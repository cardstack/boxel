// The version of its automation an attempt of a run read (ADR 039): the
// SHA-256 of the run's identity as payer, the declared operations, the
// script, the triggers and the params (`version_key`), the `callApiCalls`
// cap (`version_call_api_calls`), and the declared operations themselves
// (`version_operations`). The worker records them before it asks the realm to
// admit the run, and the realm admits the operations the attempt read and
// compares a binding's automation approval with that version, at admission
// and at each of the run's calls. Null until an attempt records them.
//
// The table is server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS version_key text,
      ADD COLUMN IF NOT EXISTS version_call_api_calls integer,
      ADD COLUMN IF NOT EXISTS version_operations jsonb
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      DROP COLUMN IF EXISTS version_key,
      DROP COLUMN IF EXISTS version_call_api_calls,
      DROP COLUMN IF EXISTS version_operations
  `);
};
