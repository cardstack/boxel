import {
  DBAdapter,
  Expression,
  addExplicitParens,
  asExpressions,
  param,
  query,
  separatedByCommas,
} from '@cardstack/runtime-common';
import { StripeEvent } from './stripe-webhook-handlers';

export async function insertStripeEvent(
  dbAdapter: DBAdapter,
  event: StripeEvent,
) {
  let { valueExpressions, nameExpressions: _nameExpressions } = asExpressions({
    stripe_event_id: event.id,
    event_type: event.type,
    event_data: event.data,
  });
  await query(dbAdapter, [
    `INSERT INTO stripe_events (stripe_event_id, event_type, event_data) VALUES`,
    ...addExplicitParens(separatedByCommas(valueExpressions)),
  ] as Expression);
}

export async function getPlanByStripeId(
  dbAdapter: DBAdapter,
  stripePlanId: string,
) {
  let results = await query(dbAdapter, [
    `SELECT * FROM plans WHERE stripe_plan_id = `,
    param(stripePlanId),
  ]);

  if (results.length !== 1) {
    throw new Error(`No plan found with stripe plan id: ${stripePlanId}`);
  }

  return results[0] as {
    id: string;
    name: string;
    monthlyPrice: number;
    creditsIncluded: number;
  };
}

export async function getUserByStripeId(
  dbAdapter: DBAdapter,
  stripeCustomerId: string,
) {
  let results = await query(dbAdapter, [
    `SELECT * FROM users WHERE stripe_customer_id = `,
    param(stripeCustomerId),
  ]);

  if (results.length !== 1) {
    throw new Error(
      `No user found with stripe customer id: ${stripeCustomerId}`,
    );
  }

  return results[0];
}

export async function insertSubscriptionCycle(
  dbAdapter: DBAdapter,
  subscriptionCycle: {
    subscriptionId: string;
    periodStart: number;
    periodEnd: number;
  },
) {
  let { valueExpressions, nameExpressions: _nameExpressions } = asExpressions({
    subscription_id: subscriptionCycle.subscriptionId,
    period_start: subscriptionCycle.periodStart,
    period_end: subscriptionCycle.periodEnd,
  });

  let result = await query(dbAdapter, [
    `INSERT INTO subscription_cycles (subscription_id, period_start, period_end) VALUES`,
    ...addExplicitParens(separatedByCommas(valueExpressions)),
    ` RETURNING *`,
  ] as Expression);

  return result[0];
}

export async function getActiveSubscription(
  dbAdapter: DBAdapter,
  userId: string,
) {
  let results = await query(dbAdapter, [
    `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active'`,
    param(userId),
  ]);

  if (results.length !== 1) {
    return null;
  }

  return results[0];
}

export async function insertSubscription(
  dbAdapter: DBAdapter,
  subscription: {
    user_id: string;
    plan_id: string;
    started_at: number;
    status: string;
    stripe_subscription_id: string;
  },
) {
  let { valueExpressions, nameExpressions: _nameExpressions } = asExpressions({
    user_id: subscription.user_id,
    plan_id: subscription.plan_id,
    started_at: subscription.started_at,
    status: subscription.status,
    stripe_subscription_id: subscription.stripe_subscription_id,
  });

  let result = await query(dbAdapter, [
    `INSERT INTO subscriptions (user_id, plan_id, started_at, status, stripe_subscription_id) VALUES`,
    ...addExplicitParens(separatedByCommas(valueExpressions)),
    ` RETURNING *`,
  ] as Expression);

  return result[0];
}

export async function addToCreditsLedger(
  dbAdapter: DBAdapter,
  user_id: string,
  credits: number,
  creditType: 'plan_allowance' | 'extra_credit',
  subscriptionCycleId: string,
) {
  let { valueExpressions, nameExpressions: _nameExpressions } = asExpressions({
    user_id: user_id,
    credit_amount: credits,
    credit_type: creditType,
    subscription_cycle_id: subscriptionCycleId,
  });

  await query(dbAdapter, [
    `INSERT INTO credits_ledger (user_id, credit_amount, credit_type, subscription_cycle_id) VALUES`,
    ...addExplicitParens(separatedByCommas(valueExpressions)),
  ] as Expression);
}

export async function getStripeEventById(
  dbAdapter: DBAdapter,
  stripeEventId: string,
) {
  let results = await query(dbAdapter, [
    `SELECT * FROM stripe_events WHERE stripe_event_id = `,
    param(stripeEventId),
  ]);

  if (results.length !== 1) {
    return null;
  }

  return results[0];
}
type CreditType =
  | 'plan_allowance'
  | 'extra_credit'
  | 'plan_allowance_used'
  | 'extra_credit_used'
  | 'plan_allowance_expired';

export async function sumUpCreditsLedger(
  dbAdapter: DBAdapter,
  params: {
    creditType: CreditType | Array<CreditType>;
    userId?: string;
    subscriptionCycleId?: string;
  },
) {
  let { creditType, userId, subscriptionCycleId } = params;

  if (userId && subscriptionCycleId) {
    throw new Error(
      'It is redundant to specify both userId and subscriptionCycleId',
    );
  }

  let creditTypes: CreditType[];
  if (!creditType) {
    creditTypes = [
      'plan_allowance',
      'extra_credit',
      'plan_allowance_used',
      'extra_credit_used',
      'plan_allowance_expired',
    ];
  } else {
    creditTypes = Array.isArray(creditType) ? creditType : [creditType];
  }

  let ledgerQuery = [
    `SELECT SUM(credit_amount) FROM credits_ledger WHERE credit_type IN`,
    ...(addExplicitParens(
      separatedByCommas(creditTypes.map((c) => [param(c)])),
    ) as Expression),
  ];

  if (subscriptionCycleId) {
    ledgerQuery.push(
      ` AND subscription_cycle_id = `,
      param(subscriptionCycleId),
    );
  } else if (userId) {
    ledgerQuery.push(` AND user_id = `, param(userId));
  }

  let results = await query(dbAdapter, ledgerQuery);

  return results[0].sum as number;
}

export async function getCurrentActiveSubscription(
  dbAdapter: DBAdapter,
  userId: string,
) {
  let results = await query(dbAdapter, [
    `SELECT * FROM subscriptions WHERE user_id = `,
    param(userId),
    ` AND status = 'active'`,
  ]);
  if (results.length === 0) {
    return null;
  }

  if (results.length !== 1) {
    throw new Error(
      `There must be only one active subscription for user: ${userId}, found ${results.length}`,
    );
  }

  return results[0];
}

export async function getMostRecentSubscriptionCycle(
  dbAdapter: DBAdapter,
  subscriptionId: string,
) {
  let results = await query(dbAdapter, [
    `SELECT * FROM subscription_cycles WHERE subscription_id = `,
    param(subscriptionId),
    ` ORDER BY period_end DESC`,
  ]);

  if (results.length === 0) {
    return null;
  }

  return results[0];
}
