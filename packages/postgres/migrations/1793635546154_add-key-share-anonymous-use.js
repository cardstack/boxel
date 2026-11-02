// Whether a share's key may be used by people who aren't signed in, which its
// owner agrees to when sharing the key, and the share's optional anonymous
// cap: how many calls a UTC day it serves, across every such caller. Those
// calls spend the share's own daily and monthly budgets too, so a cap keeps
// them from using up what signed-in readers rely on.
//
// A share that doesn't allow anonymous use has no cap.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE key_shares
      ADD COLUMN IF NOT EXISTS anonymous boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS anonymous_daily_cap integer
  `);
  pgm.sql(
    `ALTER TABLE key_shares DROP CONSTRAINT IF EXISTS key_shares_anonymous_daily_cap_check`,
  );
  pgm.sql(`
    ALTER TABLE key_shares ADD CONSTRAINT key_shares_anonymous_daily_cap_check
      CHECK (anonymous_daily_cap IS NULL OR (anonymous AND anonymous_daily_cap >= 1))
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    `ALTER TABLE key_shares DROP CONSTRAINT IF EXISTS key_shares_anonymous_daily_cap_check`,
  );
  pgm.sql(`
    ALTER TABLE key_shares
      DROP COLUMN IF EXISTS anonymous_daily_cap,
      DROP COLUMN IF EXISTS anonymous
  `);
};
