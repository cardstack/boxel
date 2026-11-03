// When a key's owner saw each of their policy notices. The secure origin's key
// page marks the notices it lists read once it shows them; until then a notice
// counts toward the unread count the app shows as a badge on the user's
// avatar. The partial index serves that count, which is asked for whenever a
// session starts.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE key_policy_notices
      ADD COLUMN IF NOT EXISTS read_at timestamptz
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_policy_notices_unread_idx
      ON key_policy_notices (owner) WHERE read_at IS NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS key_policy_notices_unread_idx`);
  pgm.sql(`ALTER TABLE key_policy_notices DROP COLUMN IF EXISTS read_at`);
};
