// When a key's owner saw each of their policy notices. The secure origin's key
// page marks the notices it lists read once it shows them; until then a notice
// counts toward the unread count the app shows as a badge on the user's
// avatar. The count reads the owner's newest notices through
// `key_policy_notices_owner_idx`, as the listing does.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE key_policy_notices
      ADD COLUMN IF NOT EXISTS read_at timestamptz
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE key_policy_notices DROP COLUMN IF EXISTS read_at`);
};
