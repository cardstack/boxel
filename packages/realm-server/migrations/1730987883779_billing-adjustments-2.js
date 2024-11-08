/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Defensive: add a constraint to credits_ledger so that plan_allowance, plan_allowance_used, plan_allowance_expired MUST have subscription_cycle_id
  pgm.addConstraint('credits_ledger', 'plan_allowance_subscription_cycle_id', {
    check: `credit_type NOT IN ('plan_allowance', 'plan_allowance_used', 'plan_allowance_expired') OR subscription_cycle_id IS NOT NULL`,
  });

  pgm.sql(
    `ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'ended_due_to_plan_change'`,
  );
};

exports.down = (pgm) => {
  pgm.dropConstraint('credits_ledger', 'plan_allowance_subscription_cycle_id');
};
