// A key's optional monthly anonymous cap: how many calls a UTC month it
// serves across everyone who isn't signed in, in every realm it is shared
// into, beside the daily one. Like the daily cap, a key that doesn't allow
// anonymous use has none.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_keys
      ADD COLUMN IF NOT EXISTS anonymous_monthly_cap integer
  `);
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
    ALTER TABLE user_keys
      DROP COLUMN IF EXISTS anonymous_monthly_cap
  `);
};
