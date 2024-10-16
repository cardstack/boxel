exports.up = (pgm) => {
  pgm.createTable('users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    matrix_user_id: { type: 'varchar', notNull: true, unique: true },
    stripe_customer_id: { type: 'varchar' },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createTable('plans', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: { type: 'varchar', notNull: true },
    monthly_price: { type: 'numeric', notNull: true },
    credits_included: { type: 'integer', notNull: true },
    stripe_plan_id: { type: 'varchar' },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createTable('subscription_cycles', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    subscription_id: { type: 'uuid' },
    period_start: { type: 'timestamp', notNull: true },
    period_end: { type: 'timestamp', notNull: true },
  });

  pgm.createType('subscription_status', ['active', 'canceled', 'expired']);

  pgm.createTable('subscriptions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: { type: 'uuid', references: 'users(id)' },
    plan_id: { type: 'uuid', references: 'plans(id)' },
    started_at: { type: 'timestamp', notNull: true },
    ended_at: { type: 'timestamp', notNull: true },
    status: { type: 'subscription_status', notNull: true },
    stripe_subscription_id: { type: 'varchar', notNull: true },
  });

  pgm.addConstraint(
    'subscription_cycles',
    'subscription_cycles_subscription_id_fkey',
    {
      foreignKeys: {
        columns: 'subscription_id',
        references: 'subscriptions(id)',
      },
    },
  );

  pgm.createTable('ai_actions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: { type: 'uuid', references: 'users(id)' },
    cost_in_usd: { type: 'numeric', notNull: true },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createType('credit_type', [
    'plan_allowance',
    'plan_allowance_used',
    'extra_credit',
    'extra_credit_used',
    'plan_allowance_expired',
  ]);

  pgm.createTable('credit_balance_events', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: { type: 'uuid', references: 'users(id)' },
    credit_amount: { type: 'numeric', notNull: true }, // can be negative
    credit_type: { type: 'credit_type', notNull: true },
    ai_action_id: { type: 'uuid', references: 'ai_actions(id)' }, // can be related to an ai_action, or null for manual adjustments (topping up, or pro-rating when changing plan)
    billing_cycle_id: { type: 'uuid', references: 'subscription_cycles(id)' },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createTable('stripe_events', {
    stripe_event_id: { type: 'varchar', notNull: true, primaryKey: true },
    event_type: { type: 'varchar', notNull: true },
    event_data: { type: 'jsonb', notNull: true },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.sql(`
    CREATE OR REPLACE FUNCTION ensure_single_active_subscription()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.status = 'active' THEN
        IF EXISTS (
          SELECT 1 FROM subscriptions
          WHERE user_id = NEW.user_id
            AND status = 'active'
            AND id != NEW.id
        ) THEN
          RAISE EXCEPTION 'User already has an active subscription';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.createTrigger(
    'subscriptions',
    'ensure_single_active_subscription_trigger',
    {
      when: 'BEFORE',
      operation: ['INSERT', 'UPDATE'],
      function: 'ensure_single_active_subscription',
      level: 'ROW',
    },
  );

  pgm.createIndex('users', 'stripe_customer_id');
  pgm.createIndex('subscriptions', 'user_id');
  pgm.createIndex('subscriptions', 'plan_id');
  pgm.createIndex('subscriptions', 'status');
  pgm.createIndex('subscriptions', 'stripe_subscription_id');
  pgm.createIndex('subscription_cycles', 'subscription_id');
  pgm.createIndex('subscription_cycles', ['period_start', 'period_end']);
  pgm.createIndex('ai_actions', 'user_id');
  pgm.createIndex('ai_actions', 'created_at');
  pgm.createIndex('credit_balance_events', 'credit_type');
  pgm.createIndex('credit_balance_events', 'created_at');
  pgm.createIndex('credit_balance_events', 'ai_action_id');
  pgm.createIndex('credit_balance_events', 'user_id');
  pgm.createIndex('credit_balance_events', 'billing_cycle_id');

  pgm.sql(`
    INSERT INTO plans (name, monthly_price, credits_included) VALUES
    ('Free', 0, 100),
    ('Creator', 12, 500),
    ('Power User', 49, 2500);
  `);

  pgm.sql(`
    INSERT INTO users (matrix_user_id)
    SELECT DISTINCT username
    FROM realm_user_permissions
    WHERE username NOT ILIKE '@realm/%'
      AND username NOT IN ('users', '*')
      AND username NOT ILIKE '%_realm:%';
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('ai_actions', { ifExists: true, cascade: true });
  pgm.dropTable('subscriptions', { cascade: true });
  pgm.dropTable('subscription_cycles', { cascade: true });
  pgm.dropTable('plans', { cascade: true });
  pgm.dropTable('users', { cascade: true });
  pgm.dropTable('stripe_events', { cascade: true });
  pgm.dropTable('credit_balance_events', { cascade: true });
  pgm.dropType('credit_type');
  pgm.dropType('subscription_status');
};
