/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.renameTable('credit_balance_events', 'credits_ledger');

  pgm.addColumn('stripe_events', {
    is_processed: { type: 'boolean', notNull: true, default: false },
  });

  pgm.alterColumn('subscriptions', 'ended_at', {
    type: 'timestamp',
    notNull: false,
  });

  // alter period_start and period_end to type bigint
  pgm.alterColumn('subscriptions', 'started_at', {
    type: 'bigint',
    using: 'extract(epoch from started_at)::bigint',
  });
  pgm.alterColumn('subscriptions', 'ended_at', {
    type: 'bigint',
    using: 'extract(epoch from ended_at)::bigint',
  });
  pgm.alterColumn('subscription_cycles', 'period_start', {
    type: 'bigint',
    using: 'extract(epoch from period_start)::bigint',
  });
  pgm.alterColumn('subscription_cycles', 'period_end', {
    type: 'bigint',
    using: 'extract(epoch from period_end)::bigint',
  });

  pgm.renameColumn(
    'credits_ledger',
    'billing_cycle_id',
    'subscription_cycle_id',
  );
};

exports.down = (pgm) => {
  pgm.renameTable('credits_ledger', 'credit_balance_events');
  pgm.dropColumn('stripe_events', 'is_processed');
  pgm.alterColumn('subscriptions', 'ended_at', {
    type: 'timestamp',
    notNull: true,
    using: 'to_timestamp(ended_at)',
  });
  pgm.alterColumn('subscriptions', 'started_at', {
    type: 'timestamp',
    notNull: true,
    using: 'to_timestamp(started_at)',
  });
  pgm.alterColumn('subscription_cycles', 'period_start', {
    type: 'timestamp',
    notNull: true,
    using: 'to_timestamp(period_start)',
  });
  pgm.alterColumn('subscription_cycles', 'period_end', {
    type: 'timestamp',
    notNull: true,
    using: 'to_timestamp(period_end)',
  });

  pgm.renameColumn(
    'credit_balance_events',
    'subscription_cycle_id',
    'billing_cycle_id',
  );
};
