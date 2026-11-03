// A key has a monthly anonymous cap only while it allows anonymous use, as
// with its daily cap. This tightens the additive check on
// `anonymous_monthly_cap`, which takes any cap of at least one: code that
// predates the column turns anonymous use off without clearing it, so the
// coupling waits until no such code is serving. A cap left behind on a key
// that no longer allows anonymous use is cleared first.

exports.up = (pgm) => {
  pgm.sql(
    `UPDATE user_keys SET anonymous_monthly_cap = NULL WHERE NOT anonymous AND anonymous_monthly_cap IS NOT NULL`,
  );
  pgm.sql(
    `ALTER TABLE user_keys DROP CONSTRAINT IF EXISTS user_keys_anonymous_monthly_cap_check`,
  );
  pgm.sql(`
    ALTER TABLE user_keys ADD CONSTRAINT user_keys_anonymous_monthly_cap_check
      CHECK (anonymous_monthly_cap IS NULL OR (anonymous AND anonymous_monthly_cap >= 1))
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    `ALTER TABLE user_keys DROP CONSTRAINT IF EXISTS user_keys_anonymous_monthly_cap_check`,
  );
  pgm.sql(`
    ALTER TABLE user_keys ADD CONSTRAINT user_keys_anonymous_monthly_cap_check
      CHECK (anonymous_monthly_cap IS NULL OR anonymous_monthly_cap >= 1)
  `);
};
