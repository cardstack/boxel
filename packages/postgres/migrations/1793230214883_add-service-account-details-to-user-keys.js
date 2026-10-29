// What a `google-service-account` key acts as, kept beside its sealed value so
// its owner can see it: the service account's email, the user it acts as for
// domain-wide delegation (null when it acts as itself) and the scopes its
// tokens ask for. None of these is secret, and the sealed value still holds
// them too: minting reads only the sealed value. Only a service account has
// them. `user_keys` is already withheld from the read-only role, and its new
// columns with it.
//
// `service_account_details_at` is the `updated_at` the details were written
// with, in the same statement that sealed the value. Details whose stamp
// differs from the row's `updated_at` belong to an earlier value: a revision
// that seals a service account's value without writing these columns (one
// still serving during a rollout, or after a rollback) moves `updated_at` and
// leaves the stamp behind, so the details are never shown for a value they
// don't describe.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_keys
      ADD COLUMN IF NOT EXISTS service_account_email varchar,
      ADD COLUMN IF NOT EXISTS service_account_subject varchar,
      ADD COLUMN IF NOT EXISTS service_account_scopes varchar[],
      ADD COLUMN IF NOT EXISTS service_account_details_at timestamptz
  `);
  pgm.sql(`
    ALTER TABLE user_keys
      ADD CONSTRAINT user_keys_service_account_check CHECK (
        kind = 'google-service-account'
        OR (
          service_account_email IS NULL
          AND service_account_subject IS NULL
          AND service_account_scopes IS NULL
          AND service_account_details_at IS NULL
        )
      )
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    `ALTER TABLE user_keys DROP CONSTRAINT IF EXISTS user_keys_service_account_check`,
  );
  pgm.sql(`
    ALTER TABLE user_keys
      DROP COLUMN IF EXISTS service_account_details_at,
      DROP COLUMN IF EXISTS service_account_scopes,
      DROP COLUMN IF EXISTS service_account_subject,
      DROP COLUMN IF EXISTS service_account_email
  `);
};
