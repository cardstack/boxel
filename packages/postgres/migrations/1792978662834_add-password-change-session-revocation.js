// A device a password change's sweep signs out may still hold a Matrix OpenID
// token, which isn't tied to a device and buys a realm-server session for an
// hour, so once a sweep has run the account's realm-server sessions are ended
// once more at `revoke_at`, after every such token has expired. A row whose
// sweep has run keeps only that revocation (`sweep_at` none), and is deleted
// once the revocation has run too.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE password_change_device_sweeps
      ALTER COLUMN sweep_at DROP NOT NULL,
      ADD COLUMN IF NOT EXISTS revoke_at timestamptz
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE password_change_device_sweeps DROP COLUMN IF EXISTS revoke_at
  `);
};
