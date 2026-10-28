// Rejected keys: a key whose token endpoint refuses it, such as a Google
// service-account key that is revoked, deleted, disabled or can't act as its
// subject, is `rejected` as a whole, not at one destination. While it is,
// calls through any of its grants are refused without contacting the token
// endpoint, except one probe per key per interval. A probe that mints, or
// replacing the key, returns it to `active`.
//
// `user_keys` gains:
//
// * `rejected_at`: when the key entered `rejected`.
// * `last_probe_at`: when a call was last let through to the token endpoint
//   for the rejected key, so the next probe waits out the interval.
//
// Both are timestamps and hold no secret. `user_keys` is already withheld from
// the read-only role and excluded from the SQLite schema dump.
//
// `user_key_grant_notices.reason` gains `key-rejected`, beside
// `credential-rejected`: the notice for a key refused everywhere, naming the
// grant and destination of the call that found it, where `credential-rejected`
// is a key refused at one grant's destination.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_keys
      ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
      ADD COLUMN IF NOT EXISTS last_probe_at timestamptz
  `);
  pgm.sql(`
    ALTER TABLE user_key_grant_notices
      DROP CONSTRAINT IF EXISTS user_key_grant_notices_reason_check
  `);
  pgm.sql(`
    ALTER TABLE user_key_grant_notices
      ADD CONSTRAINT user_key_grant_notices_reason_check
      CHECK (reason IN ('credential-rejected', 'key-rejected'))
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM user_key_grant_notices WHERE reason = 'key-rejected'`);
  pgm.sql(`
    ALTER TABLE user_key_grant_notices
      DROP CONSTRAINT IF EXISTS user_key_grant_notices_reason_check
  `);
  pgm.sql(`
    ALTER TABLE user_key_grant_notices
      ADD CONSTRAINT user_key_grant_notices_reason_check
      CHECK (reason = 'credential-rejected')
  `);
  pgm.sql(`
    ALTER TABLE user_keys
      DROP COLUMN IF EXISTS rejected_at,
      DROP COLUMN IF EXISTS last_probe_at
  `);
};
