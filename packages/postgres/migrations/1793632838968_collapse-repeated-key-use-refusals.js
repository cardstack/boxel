// A `key_uses` row can stand for more than one use (`count`), so a caller who
// keeps calling past a limit grows the table by a row a minute, not a row a
// call.
//
// Refusals are collapsed: the refusals of one minute (`refusal_window`, the
// start of that UTC minute) that match in share or key, realm, operation,
// caller, mode, code, status and host are one row, its `count` the number of
// them and its `created_at` the latest. The unique index is what makes a
// refusal either the row's first or one more on it, atomically, however many
// arrive at once. Every other use is one row with a `count` of 1 and no
// `refusal_window`.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE key_uses
      ADD COLUMN IF NOT EXISTS count integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS refusal_window timestamptz
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS key_uses_refusal_window_idx
      ON key_uses (
        share_id, key_id, realm_url, operation, caller, mode, code, status,
        host, refusal_window
      ) NULLS NOT DISTINCT
      WHERE refusal_window IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS key_uses_refusal_window_idx`);
  pgm.sql(`
    ALTER TABLE key_uses
      DROP COLUMN IF EXISTS refusal_window,
      DROP COLUMN IF EXISTS count
  `);
};
