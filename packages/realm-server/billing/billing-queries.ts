import {
  DBAdapter,
  Expression,
  addExplicitParens,
  asExpressions,
  every,
  insert,
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
  creditType:
    | 'plan_allowance'
    | 'extra_credit'
    | 'plan_allowance_used'
    | 'extra_credit_used'
    | 'plan_allowance_expired';
  subscriptionCycleId: string;
}

export async function insertStripeEvent(
  dbAdapter: DBAdapter,
  event: StripeEvent,
) {
  let { valueExpressions, nameExpressions } = asExpressions({
    stripe_event_id: event.id,
    event_type: event.type,
    event_data: event.data,
  });
  await query(
    dbAdapter,
    insert('stripe_events', nameExpressions, valueExpressions),
  );
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
    id: results[0].id,
    name: results[0].name,
    monthlyPrice: results[0].monthly_price,
    creditsIncluded: results[0].credits_included,
  } as Plan;
}

export async function getPlan(dbAdapter: DBAdapter, id: string): Promise<Plan> {
  let results = await query(dbAdapter, [
    `SELECT * FROM plans WHERE id = `,
    param(id),
  ]);

  if (results.length !== 1) {
    throw new Error(`No plan found with id: ${id}`);
  }

  return {
    id: results[0].id,
    name: results[0].name,
    monthlyPrice: results[0].monthly_price,
    creditsIncluded: results[0].credits_included,
  } as Plan;
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
    id: results[0].id,
    matrixUserId: results[0].matrix_user_id,
    stripeCustomerId: results[0].stripe_customer_id,
  } as User;
}

export async function getUserByMatrixUserId(
  dbAdapter: DBAdapter,
  matrixUserId: string,
): Promise<User | null> {
  let results = await query(dbAdapter, [
    `SELECT * FROM users WHERE matrix_user_id = `,
    param(matrixUserId),
  ]);

  if (results.length !== 1) {
    return null;
  }

  return {
    id: results[0].id,
    matrixUserId: results[0].matrix_user_id,
    stripeCustomerId: results[0].stripe_customer_id,
  } as User;
}

export async function insertSubscriptionCycle(
  dbAdapter: DBAdapter,
  subscriptionCycle: {
    subscriptionId: string;
    periodStart: number;
    periodEnd: number;
  },
): Promise<SubscriptionCycle> {
  let { valueExpressions, nameExpressions } = asExpressions({
    subscription_id: subscriptionCycle.subscriptionId,
    period_start: subscriptionCycle.periodStart,
    period_end: subscriptionCycle.periodEnd,
  });

  let result = await query(
    dbAdapter,
    insert('subscription_cycles', nameExpressions, valueExpressions),
  );

  return {
    id: result[0].id,
    subscriptionId: result[0].subscription_id,
    periodStart: result[0].period_start,
    periodEnd: result[0].period_end,
  } as SubscriptionCycle;
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
  let { valueExpressions, nameExpressions } = asExpressions({
    user_id: subscription.user_id,
    plan_id: subscription.plan_id,
    started_at: subscription.started_at,
    status: subscription.status,
    stripe_subscription_id: subscription.stripe_subscription_id,
  });

  let result = await query(
    dbAdapter,
    insert('subscriptions', nameExpressions, valueExpressions),
  );

  return {
    id: result[0].id,
    userId: result[0].user_id,
    planId: result[0].plan_id,
    startedAt: result[0].started_at,
    status: result[0].status,
    stripeSubscriptionId: result[0].stripe_subscription_id,
  } as Subscription;
}

export async function addToCreditsLedger(
  dbAdapter: DBAdapter,
  ledgerEntry: Omit<LedgerEntry, 'id'>,
) {
  let { valueExpressions, nameExpressions } = asExpressions({
    user_id: ledgerEntry.userId,
    credit_amount: ledgerEntry.creditAmount,
    credit_type: ledgerEntry.creditType,
    subscription_cycle_id: ledgerEntry.subscriptionCycleId,
  });

  await query(
    dbAdapter,
    insert('credits_ledger', nameExpressions, valueExpressions),
  );
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

  let conditions: Expression[] = [];

  if (creditType) {
    let creditTypes = Array.isArray(creditType) ? creditType : [creditType];
    conditions.push([
      `credit_type IN`,
      ...(addExplicitParens(
        separatedByCommas(creditTypes.map((c) => [param(c)])),
      ) as Expression),
    ]);
  }

  if (subscriptionCycleId) {
    conditions.push([`subscription_cycle_id = `, param(subscriptionCycleId)]);
  } else if (userId) {
    conditions.push([`user_id = `, param(userId)]);
  }

  let everyCondition = every(conditions);

  let ledgerQuery: Expression = [
    `SELECT SUM(credit_amount) FROM credits_ledger WHERE`,
    ...(everyCondition as Expression),
  ];

  let results = await query(dbAdapter, ledgerQuery);

  return results[0].sum != null ? parseInt(results[0].sum as string) : 0;
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
    id: results[0].id,
    userId: results[0].user_id,
    planId: results[0].plan_id,
    startedAt: results[0].started_at,
    status: results[0].status,
    stripeSubscriptionId: results[0].stripe_subscription_id,
  } as Subscription;
}

export async function getMostRecentSubscription(
  dbAdapter: DBAdapter,
  userId: string,
) {
  let results = await query(dbAdapter, [
    `SELECT * FROM subscriptions WHERE user_id = `,
    param(userId),
    `ORDER BY started_at DESC`,
  ]);
  if (results.length === 0) {
    return null;
  }

  return {
    id: results[0].id,
    userId: results[0].user_id,
    planId: results[0].plan_id,
    startedAt: results[0].started_at,
    status: results[0].status,
    stripeSubscriptionId: results[0].stripe_subscription_id,
  } as Subscription;
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
    id: results[0].id,
    subscriptionId: results[0].subscription_id,
    periodStart: results[0].period_start,
    periodEnd: results[0].period_end,
  } as SubscriptionCycle;
}

export async function markStripeEventAsProcessed(
  dbAdapter: DBAdapter,
  stripeEventId: string,
) {
  await query(dbAdapter, [
    `UPDATE stripe_events SET is_processed = TRUE WHERE stripe_event_id = `,
    param(stripeEventId),
  ]);
}
