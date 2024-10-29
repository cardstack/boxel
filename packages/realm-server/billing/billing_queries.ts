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

export interface User {
  id: string;
  matrixUserId: string;
  stripeCustomerId: string;
}

export interface Plan {
  id: string;
  name: string;
  monthlyPrice: number;
  creditsIncluded: number;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  startedAt: number;
  endedAt?: number;
  status: string;
  stripeSubscriptionId: string;
}

export interface SubscriptionCycle {
  id: string;
  subscriptionId: string;
  periodStart: number;
  periodEnd: number;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  creditAmount: number;
  creditType: string;
  subscriptionCycleId: string;
}

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
): Promise<Plan> {
  let results = await query(dbAdapter, [
    `SELECT * FROM plans WHERE stripe_plan_id = `,
    param(stripePlanId),
  ]);

  if (results.length !== 1) {
    throw new Error(`No plan found with stripe plan id: ${stripePlanId}`);
  }

  return {
    id: results[0].id as string,
    name: results[0].name as string,
    monthlyPrice: results[0].monthly_price as number,
    creditsIncluded: results[0].credits_included as number,
  };
}

export async function getUserByStripeId(
  dbAdapter: DBAdapter,
  stripeCustomerId: string,
): Promise<User | null> {
  let results = await query(dbAdapter, [
    `SELECT * FROM users WHERE stripe_customer_id = `,
    param(stripeCustomerId),
  ]);

  if (results.length !== 1) {
    return null;
  }

  return {
    id: results[0].id as string,
    matrixUserId: results[0].matrix_user_id as string,
    stripeCustomerId: results[0].stripe_customer_id as string,
  };
}

export async function insertSubscriptionCycle(
  dbAdapter: DBAdapter,
  subscriptionCycle: {
    subscriptionId: string;
    periodStart: number;
    periodEnd: number;
  },
): Promise<SubscriptionCycle> {
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

  return {
    id: result[0].id as string,
    subscriptionId: result[0].subscription_id as string,
    periodStart: result[0].period_start as number,
    periodEnd: result[0].period_end as number,
  };
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
): Promise<Subscription> {
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

  return {
    id: result[0].id as string,
    userId: result[0].user_id as string,
    planId: result[0].plan_id as string,
    startedAt: result[0].started_at as number,
    status: result[0].status as string,
    stripeSubscriptionId: result[0].stripe_subscription_id as string,
  };
}

export async function addToCreditsLedger(
  dbAdapter: DBAdapter,
  user_id: string,
  credits: number,
  creditType:
    | 'plan_allowance'
    | 'extra_credit'
    | 'plan_allowance_used'
    | 'extra_credit_used'
    | 'plan_allowance_expired',
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
    creditType?: CreditType | Array<CreditType>;
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

  return parseInt(results[0].sum as string);
}

export async function getCurrentActiveSubscription(
  dbAdapter: DBAdapter,
  userId: string,
): Promise<Subscription | null> {
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

  return {
    id: results[0].id as string,
    userId: results[0].user_id as string,
    planId: results[0].plan_id as string,
    startedAt: results[0].started_at as number,
    status: results[0].status as string,
    stripeSubscriptionId: results[0].stripe_subscription_id as string,
  };
}

export async function getMostRecentSubscriptionCycle(
  dbAdapter: DBAdapter,
  subscriptionId: string,
): Promise<SubscriptionCycle | null> {
  let results = await query(dbAdapter, [
    `SELECT * FROM subscription_cycles WHERE subscription_id = `,
    param(subscriptionId),
    ` ORDER BY period_end DESC`,
  ]);

  if (results.length === 0) {
    return null;
  }

  return {
    id: results[0].id as string,
    subscriptionId: results[0].subscription_id as string,
    periodStart: results[0].period_start as number,
    periodEnd: results[0].period_end as number,
  };
}
