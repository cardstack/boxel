exports.shorthands = undefined;

// The counters behind rate limits and budgets that aren't the anonymous
// limiter's, each under a key its caller composes (a share or key, and the
// caller it counts). In the database rather than in each process, so a limit
// holds across every realm-server process and across a restart.
//
// A token bucket holds `burst` tokens and refills at a steady rate; each
// invocation takes from it. The row is the bucket's level as of `refilled_at`,
// and a key with no row is a full bucket, so a row can go once the bucket
// would have refilled.
//
// A budget counts what a key has spent in one calendar period (a UTC day or
// month). The row is the count for one key and one period; a period that has
// ended is swept, never read again.

exports.up = (pgm) => {
  pgm.createTable('rate_limit_buckets', {
    bucket_key: { type: 'varchar', notNull: true, primaryKey: true },
    // Fractional, since the bucket refills continuously.
    tokens: { type: 'double precision', notNull: true },
    // Epoch milliseconds at which `tokens` was the level.
    refilled_at: { type: 'bigint', notNull: true },
    // Epoch seconds by which the bucket is full again, which is when the row
    // can go.
    expires_at: { type: 'bigint', notNull: true },
  });
  pgm.createIndex('rate_limit_buckets', 'expires_at');

  pgm.createTable('rate_limit_budgets', {
    budget_key: { type: 'varchar', notNull: true },
    // `day` or `month`.
    period: { type: 'varchar', notNull: true },
    // Epoch seconds at which the period began.
    period_start: { type: 'bigint', notNull: true },
    count: { type: 'bigint', notNull: true },
    // Epoch seconds at which the period ends, which is when the row can go.
    expires_at: { type: 'bigint', notNull: true },
  });
  pgm.addConstraint('rate_limit_budgets', 'rate_limit_budgets_pkey', {
    primaryKey: ['budget_key', 'period', 'period_start'],
  });
  pgm.createIndex('rate_limit_budgets', 'expires_at');
};

exports.down = (pgm) => {
  pgm.dropTable('rate_limit_budgets');
  pgm.dropTable('rate_limit_buckets');
};
