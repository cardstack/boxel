// When realm-historian last swept each realm's directory, and when a sweep
// was last asked for. `last_swept_at` is the time the sweep's walk started,
// so the daily sweep's schedule survives a restart of the task, and a sweep
// is asked for by setting `sweep_requested_at` to a later time:
//
//   UPDATE realm_history_state SET sweep_requested_at = now()
//   WHERE realm_id = '<realm id>';
//
// Both start out null: a realm with no `last_swept_at` is due its first
// sweep.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE realm_history_state
      ADD COLUMN IF NOT EXISTS last_swept_at timestamptz,
      ADD COLUMN IF NOT EXISTS sweep_requested_at timestamptz
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE realm_history_state
      DROP COLUMN IF EXISTS last_swept_at,
      DROP COLUMN IF EXISTS sweep_requested_at
  `);
};
