// Accounts whose Matrix devices the realm server signs out once a password
// change's last login token has expired. A Matrix password change signs out
// every device of the account but the one that made it, but not a login token
// minted before the change and not yet used, which then signs in a new device
// afterwards. So the realm server signs the account's devices out again once
// any such token has expired, all but `keep_device_id`, the device that made
// the change (none for a reset).
//
// One row per account: a later change of the same account moves its sweep to
// the later time, and keeps that change's device. A row is deleted once its
// sweep has run, so the table holds only the sweeps still due.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS password_change_device_sweeps (
      -- The Matrix user id of the account.
      user_id varchar PRIMARY KEY,
      keep_device_id varchar,
      sweep_at timestamptz NOT NULL
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS password_change_device_sweeps`);
};
