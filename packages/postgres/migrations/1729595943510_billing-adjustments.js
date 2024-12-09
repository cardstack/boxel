exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.renameTable('credit_balance_events', 'credits_ledger');
  pgm.addColumn('stripe_events', {
    is_processed: { type: 'boolean', notNull: true, default: false },
  });
  pgm.renameColumn(
    'credits_ledger',
    'billing_cycle_id',
    'subscription_cycle_id',
  );

  let timestampColumns = [
    { table: 'subscriptions', columns: ['started_at', 'ended_at'] },
    { table: 'subscription_cycles', columns: ['period_start', 'period_end'] },
    { table: 'users', columns: ['created_at'] },
    { table: 'plans', columns: ['created_at'] },
    { table: 'ai_actions', columns: ['created_at'] },
    { table: 'credits_ledger', columns: ['created_at'] },
    { table: 'stripe_events', columns: ['created_at'] },
  ];

  for (let { table, columns } of timestampColumns) {
    for (let column of columns) {
      pgm.alterColumn(table, column, { default: null });
    }
  }

  for (let { table, columns } of timestampColumns) {
    for (let column of columns) {
      pgm.alterColumn(table, column, {
        type: 'integer',
        notNull: column !== 'ended_at',
        using: 'extract(epoch from ' + column + ')::integer',
      });
    }
  }

  let tablesWithCreatedAt = [
    'users',
    'plans',
    'ai_actions',
    'credits_ledger',
    'stripe_events',
  ];
  for (let table of tablesWithCreatedAt) {
    pgm.alterColumn(table, 'created_at', {
      default: pgm.func('EXTRACT(epoch FROM CURRENT_TIMESTAMP)::integer'),
    });
  }
};

exports.down = (pgm) => {
  pgm.renameTable('credits_ledger', 'credit_balance_events');
  pgm.dropColumn('stripe_events', 'is_processed');
  pgm.renameColumn(
    'credit_balance_events',
    'subscription_cycle_id',
    'billing_cycle_id',
  );

  let timestampColumns = [
    { table: 'subscriptions', columns: ['started_at', 'ended_at'] },
    { table: 'subscription_cycles', columns: ['period_start', 'period_end'] },
    { table: 'users', columns: ['created_at'] },
    { table: 'plans', columns: ['created_at'] },
    { table: 'ai_actions', columns: ['created_at'] },
    { table: 'credit_balance_events', columns: ['created_at'] },
    { table: 'stripe_events', columns: ['created_at'] },
  ];

  for (let { table, columns } of timestampColumns) {
    for (let column of columns) {
      pgm.alterColumn(table, column, { default: null });
    }
  }

  for (let { table, columns } of timestampColumns) {
    for (let column of columns) {
      pgm.alterColumn(table, column, {
        type: 'timestamp',
        notNull: column !== 'ended_at',
        using: 'to_timestamp(' + column + ')',
      });
    }
  }

  let tablesWithCreatedAt = [
    'users',
    'plans',
    'ai_actions',
    'credit_balance_events',
    'stripe_events',
  ];
  for (let table of tablesWithCreatedAt) {
    pgm.alterColumn(table, 'created_at', {
      default: pgm.func('CURRENT_TIMESTAMP'),
    });
  }
};
