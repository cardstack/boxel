// The credential an automation run ended on. When admission or one of the
// run's `callApi` calls is refused `credential-rejected` for a reason that
// needs a person (the vendor refused the key or connection: `rejected`; the
// OAuth client or share it goes through needs an administrator:
// `needs-admin`), the run records the reason and the share or personal key
// the refused slot is filled from. Who is told, and what fixes it, is read
// from these against the key, its client and its share as they are now.
//
// The table is server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS credential_reason text,
      ADD COLUMN IF NOT EXISTS credential_share_id text,
      ADD COLUMN IF NOT EXISTS credential_key_id text
  `);
  pgm.sql(`
    ALTER TABLE automation_runs
      DROP CONSTRAINT IF EXISTS automation_runs_credential_reason_check
  `);
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD CONSTRAINT automation_runs_credential_reason_check
      CHECK (credential_reason IS NULL OR credential_reason IN ('rejected', 'needs-admin'))
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      DROP CONSTRAINT IF EXISTS automation_runs_credential_reason_check,
      DROP COLUMN IF EXISTS credential_key_id,
      DROP COLUMN IF EXISTS credential_share_id,
      DROP COLUMN IF EXISTS credential_reason
  `);
};
