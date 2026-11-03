// A share's limits are typed columns (`rate_burst`, `rate_refill_per_minute`,
// `daily_budget`, `monthly_budget`). The `limits` jsonb column held a place
// for them, was never written or read, and goes.

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE key_shares DROP COLUMN IF EXISTS limits`);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE key_shares
      ADD COLUMN IF NOT EXISTS limits jsonb NOT NULL DEFAULT '{}'::jsonb
  `);
};
