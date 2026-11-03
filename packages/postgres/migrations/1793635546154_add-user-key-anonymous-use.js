// Whether a key may be used by people who aren't signed in, which its owner
// decides for the key itself, when adding it or afterwards, and the key's
// optional anonymous cap: how many calls a UTC day it serves, across every
// such caller in every realm it is shared into. Whether such people can use
// it in a realm is that realm's policy's to say; a key serves them only where
// both allow it.
//
// A key that doesn't allow anonymous use has no cap.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_keys
      ADD COLUMN IF NOT EXISTS anonymous boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS anonymous_daily_cap integer
  `);
  pgm.sql(
    `ALTER TABLE user_keys DROP CONSTRAINT IF EXISTS user_keys_anonymous_daily_cap_check`,
  );
  pgm.sql(`
    ALTER TABLE user_keys ADD CONSTRAINT user_keys_anonymous_daily_cap_check
      CHECK (anonymous_daily_cap IS NULL OR (anonymous AND anonymous_daily_cap >= 1))
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    `ALTER TABLE user_keys DROP CONSTRAINT IF EXISTS user_keys_anonymous_daily_cap_check`,
  );
  pgm.sql(`
    ALTER TABLE user_keys
      DROP COLUMN IF EXISTS anonymous_daily_cap,
      DROP COLUMN IF EXISTS anonymous
  `);
};
