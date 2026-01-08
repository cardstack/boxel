exports.up = (pgm) => {
  pgm.addTypeValue('credit_type', 'daily_credit', { ifNotExists: true });
  pgm.addTypeValue('credit_type', 'daily_credit_used', { ifNotExists: true });
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM credits_ledger
    WHERE credit_type IN ('daily_credit', 'daily_credit_used');
  `);

  pgm.dropConstraint('credits_ledger', 'plan_allowance_subscription_cycle_id');

  pgm.sql(`
    ALTER TYPE credit_type RENAME TO credit_type_old;
    CREATE TYPE credit_type AS ENUM (
      'plan_allowance',
      'plan_allowance_used',
      'extra_credit',
      'extra_credit_used',
      'plan_allowance_expired'
    );
    ALTER TABLE credits_ledger
      ALTER COLUMN credit_type TYPE credit_type
      USING credit_type::text::credit_type;
    DROP TYPE credit_type_old;
  `);

  pgm.addConstraint('credits_ledger', 'plan_allowance_subscription_cycle_id', {
    check: `credit_type NOT IN ('plan_allowance', 'plan_allowance_used', 'plan_allowance_expired') OR subscription_cycle_id IS NOT NULL`,
  });
};
