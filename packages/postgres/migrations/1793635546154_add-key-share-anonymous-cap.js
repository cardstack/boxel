// A share's anonymous cap: how many calls a UTC day the share serves, across
// every caller who isn't signed in, where its owner allowed anonymous use of
// it. Those calls spend the share's own daily and monthly budgets too, so the
// cap keeps them from using up what signed-in readers rely on.
//
// Null where the share's owner never allowed anonymous use: the approval that
// first allows it sets the cap.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE key_shares
      ADD COLUMN IF NOT EXISTS anonymous_daily_cap integer
  `);
  pgm.sql(
    `ALTER TABLE key_shares DROP CONSTRAINT IF EXISTS key_shares_anonymous_daily_cap_check`,
  );
  pgm.sql(`
    ALTER TABLE key_shares ADD CONSTRAINT key_shares_anonymous_daily_cap_check
      CHECK (anonymous_daily_cap IS NULL OR anonymous_daily_cap >= 1)
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    `ALTER TABLE key_shares DROP CONSTRAINT IF EXISTS key_shares_anonymous_daily_cap_check`,
  );
  pgm.sql(`ALTER TABLE key_shares DROP COLUMN IF EXISTS anonymous_daily_cap`);
};
