import type {
  DBAdapter,
  Expression,
  PgPrimitive,
} from '@cardstack/runtime-common';
import type { Querier } from '@cardstack/runtime-common';
import {
  addExplicitParens,
  asExpressions,
  chargeKindForCreditType,
  dbAdapterQuerier,
  every,
  insert,
  param,
  query,
  separatedByCommas,
  update,
} from '@cardstack/runtime-common';
import type { StripeEvent } from './stripe-webhook-handlers/index.ts';
import type {
  ChargedLedgerEntry,
  ChargeUsage,
  CreditType,
  LedgerCharge,
  LedgerChargeKind,
  LedgerEntry,
  Plan,
  RealmIdentifier,
  SpendCharge,
  Subscription,
  UsageUnit,
  SubscriptionCycle,
  User,
} from '@cardstack/runtime-common';

function planRowToPlan(row: Record<string, PgPrimitive>): Plan {
  return {
    id: row.id,
    name: row.name,
    monthlyPrice: parseFloat(row.monthly_price as string),
    creditsIncluded: row.credits_included,
    stripePlanId: row.stripe_plan_id,
  } as Plan;
}

export async function insertStripeEvent(
  dbAdapter: DBAdapter,
  event: StripeEvent,
) {
  try {
    let { valueExpressions, nameExpressions } = asExpressions({
      stripe_event_id: event.id,
      event_type: event.type,
      event_data: event.data,
    });
    await query(
      dbAdapter,
      insert('stripe_events', nameExpressions, valueExpressions),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('duplicate key value')
    ) {
      let stripeEvent = await getStripeEventById(dbAdapter, event.id);
      if (stripeEvent?.is_processed) {
        throw new Error('Stripe event already processed');
      }
    }
    throw error;
  }
}

export async function getPlanByStripeId(
  dbAdapter: DBAdapter,
  stripePlanId: string,
): Promise<Plan | null> {
  let results = await query(dbAdapter, [
    `SELECT * FROM plans WHERE stripe_plan_id = `,
    param(stripePlanId),
  ]);

  if (results.length !== 1) {
    return null;
  }

  return planRowToPlan(results[0]);
}

export async function updateUserStripeCustomerId(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  stripeCustomerId: string,
) {
  let user = await getUserByMatrixUserId(dbAdapter, matrixUserId);

  if (!user) {
    // This means there is no user in our db yet, which is a case for matrix users that signed up before we
    // introduced the users table and starded inserting users on realm creation.
    // We can just create a new user in our db with matrix user id and stripe customer id.
    let { valueExpressions, nameExpressions } = asExpressions({
      matrix_user_id: matrixUserId,
      stripe_customer_id: stripeCustomerId,
    });
    await query(dbAdapter, insert('users', nameExpressions, valueExpressions));
  } else {
    let { valueExpressions, nameExpressions } = asExpressions({
      stripe_customer_id: stripeCustomerId,
    });
    await query(dbAdapter, [
      ...update('users', nameExpressions, valueExpressions),
      ` WHERE matrix_user_id = `,
      param(matrixUserId),
    ]);
  }
}

export async function updateUserStripeCustomerEmail(
  dbAdapter: DBAdapter,
  stripeCustomerId: string,
  stripeCustomerEmail: string,
) {
  let { valueExpressions, nameExpressions } = asExpressions({
    stripe_customer_email: stripeCustomerEmail,
  });
  await query(dbAdapter, [
    ...update('users', nameExpressions, valueExpressions),
    ` WHERE stripe_customer_id = `,
    param(stripeCustomerId),
  ]);
}

export async function getUserById(
  dbAdapter: DBAdapter,
  userId: string,
): Promise<User | null> {
  let results = await query(dbAdapter, [
    `SELECT * FROM users WHERE id = `,
    param(userId),
  ]);

  if (results.length !== 1) {
    return null;
  }

  return {
    id: results[0].id,
    matrixUserId: results[0].matrix_user_id,
    stripeCustomerId: results[0].stripe_customer_id,
    stripeCustomerEmail: results[0].stripe_customer_email,
    matrixRegistrationToken: results[0].matrix_registration_token,
    sessionRoomId: results[0].session_room_id ?? null,
  } as User;
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
    matrixRegistrationToken: results[0].matrix_registration_token,
    sessionRoomId: results[0].session_room_id ?? null,
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
    stripeCustomerEmail: results[0].stripe_customer_email,
    matrixRegistrationToken: results[0].matrix_registration_token,
    sessionRoomId: results[0].session_room_id ?? null,
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

type NewLedgerEntry = Omit<LedgerEntry, 'id'> & {
  // What the entry paid for, or where its credits came from. Defaults to the
  // kind its credit type implies, with no reference.
  charge?: LedgerCharge;
  // Shared by every entry one spend writes, and the key its usage is
  // recorded under.
  chargeId?: string;
};

// A `DBAdapter`, or a `Querier` pinned to a transaction's connection.
type Queryable = DBAdapter | Querier;

function querierFor(db: Queryable): Querier {
  return typeof db === 'function' ? db : dbAdapterQuerier(db);
}

function ledgerColumns(entry: NewLedgerEntry) {
  let charge: LedgerCharge = entry.charge ?? {
    kind: chargeKindForCreditType(entry.creditType),
  };
  return {
    user_id: entry.userId,
    credit_amount: entry.creditAmount,
    credit_type: entry.creditType,
    subscription_cycle_id: entry.subscriptionCycleId,
    charge_kind: charge.kind,
    realm: 'realm' in charge ? (charge.realm ?? null) : null,
    run_id: 'runId' in charge ? (charge.runId ?? null) : null,
    batch_id: 'batchId' in charge ? charge.batchId : null,
    automation_id: 'automationId' in charge ? charge.automationId : null,
    charge_day: 'day' in charge ? charge.day : null,
    pricing_version:
      'pricingVersion' in charge ? (charge.pricingVersion ?? null) : null,
    charge_id: entry.chargeId ?? null,
  };
}

// The INSERT that writes `entries` as one statement, so they land together or
// not at all.
function ledgerInsert(entries: NewLedgerEntry[]): Expression {
  let nameExpressions: string[][] | undefined;
  let rows: Expression[] = [];
  for (let entry of entries) {
    let expressions = asExpressions(ledgerColumns(entry));
    nameExpressions ??= expressions.nameExpressions;
    rows.push(
      addExplicitParens(
        separatedByCommas(expressions.valueExpressions),
      ) as Expression,
    );
  }
  return [
    'INSERT INTO credits_ledger',
    ...addExplicitParens(separatedByCommas(nameExpressions!)),
    'VALUES',
    ...separatedByCommas(rows),
  ] as Expression;
}

async function insertLedgerEntries(
  db: Queryable,
  entries: NewLedgerEntry[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  await querierFor(db)(ledgerInsert(entries));
}

export async function addToCreditsLedger(
  dbAdapter: DBAdapter,
  ledgerEntry: NewLedgerEntry,
) {
  await insertLedgerEntries(dbAdapter, [ledgerEntry]);
}

// The identity of a charge that is written at most once: its kind and
// reference. Undefined for an `ai` charge, which is one per call.
//
// The payer is not part of it: a run, a batch, or an automation's storage for
// one day is charged once, to whoever pays when it is first charged. A retry
// after the payer changes (an automation resumed by another direct writer)
// reads as `already-charged` and bills no one a second time.
function chargeIdentity(charge: SpendCharge): string | undefined {
  switch (charge.kind) {
    case 'ai':
      return undefined;
    case 'run':
    case 'run_indexing':
      return `${charge.kind}:${charge.runId}`;
    case 'batched_ai':
      return `${charge.kind}:${charge.runId}:${charge.batchId}`;
    case 'storage':
      return `${charge.kind}:${charge.automationId}:${charge.day}`;
  }
}

async function isCharged(q: Querier, charge: SpendCharge): Promise<boolean> {
  let columns = ledgerColumns({
    userId: '',
    creditAmount: 0,
    creditType: 'extra_credit_used',
    subscriptionCycleId: null,
    charge,
  });
  // `=` and `IS NULL` per column, never `IS NOT DISTINCT FROM`, which no index
  // serves: this way the lookup is an index scan on
  // `credits_ledger_charge_once_idx`. The kind is written as a literal (it is
  // one of the closed set `chargeIdentity` accepts) so the planner can match
  // the index's partial predicate.
  let match = (column: string, value: string | null): Expression =>
    value === null
      ? [` AND ${column} IS NULL`]
      : [` AND ${column} = `, param(value)];
  let rows = await q([
    `SELECT 1 FROM credits_ledger WHERE charge_kind = '${columns.charge_kind}'`,
    ...match('run_id', columns.run_id),
    ...match('batch_id', columns.batch_id),
    ...match('automation_id', columns.automation_id),
    ...match('charge_day', columns.charge_day),
    ` LIMIT 1`,
  ] as Expression);
  return rows.length > 0;
}

// Mirrors `chargeKindForCreditType` for entries written without a kind.
const CHARGE_KIND_FROM_CREDIT_TYPE_SQL = `COALESCE(charge_kind, CASE credit_type
  WHEN 'plan_allowance_used' THEN 'ai'
  WHEN 'extra_credit_used' THEN 'ai'
  WHEN 'daily_credit_used' THEN 'ai'
  WHEN 'plan_allowance' THEN 'grant'
  WHEN 'daily_credit' THEN 'grant'
  WHEN 'extra_credit' THEN 'purchase'
  WHEN 'plan_allowance_expired' THEN 'expiry'
END)`;

// Reads ledger entries with what each paid for, oldest first. Every filter
// given must match. An entry written without a charge kind reads the kind its
// credit type implies, so filtering on `chargeKind: 'ai'` finds those spends
// too.
export interface LedgerFilter {
  userId?: string;
  chargeKind?: LedgerChargeKind;
  realm?: RealmIdentifier;
  runId?: string;
  batchId?: string;
  automationId?: string;
  chargeDay?: string;
}

// The WHERE conditions over `credits_ledger` for `filter`; every filter given
// must match.
function ledgerConditions(filter: LedgerFilter): Expression[] {
  let conditions: Expression[] = [];
  let columnFilters: [string, string | undefined][] = [
    ['user_id', filter.userId],
    ['realm', filter.realm],
    ['run_id', filter.runId],
    ['batch_id', filter.batchId],
    ['automation_id', filter.automationId],
    ['charge_day', filter.chargeDay],
  ];
  for (let [column, value] of columnFilters) {
    if (value !== undefined) {
      conditions.push([`${column} = `, param(value)]);
    }
  }
  if (filter.chargeKind !== undefined) {
    conditions.push([
      `${CHARGE_KIND_FROM_CREDIT_TYPE_SQL} = `,
      param(filter.chargeKind),
    ]);
  }
  return conditions;
}

export async function getLedgerEntries(
  dbAdapter: DBAdapter,
  filter: LedgerFilter,
): Promise<ChargedLedgerEntry[]> {
  let conditions = ledgerConditions(filter);
  let rows = await query(dbAdapter, [
    `SELECT *, ${CHARGE_KIND_FROM_CREDIT_TYPE_SQL} AS read_charge_kind,`,
    `to_char(charge_day, 'YYYY-MM-DD') AS read_charge_day`,
    `FROM credits_ledger`,
    ...(conditions.length
      ? (['WHERE', ...every(conditions)] as Expression)
      : []),
    `ORDER BY created_at, id`,
  ] as Expression);
  return rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    creditAmount: row.credit_amount as number,
    creditType: row.credit_type as CreditType,
    subscriptionCycleId: (row.subscription_cycle_id as string | null) ?? null,
    chargeKind: row.read_charge_kind as LedgerChargeKind,
    chargeId: (row.charge_id as string | null) ?? null,
    realm: (row.realm as RealmIdentifier | null) ?? null,
    runId: (row.run_id as string | null) ?? null,
    batchId: (row.batch_id as string | null) ?? null,
    automationId: (row.automation_id as string | null) ?? null,
    chargeDay: (row.read_charge_day as string | null) ?? null,
    pricingVersion: (row.pricing_version as string | null) ?? null,
    createdAt: Number(row.created_at),
  }));
}

// How much of each unit the charges matching `filter` priced, summed by charge
// kind and unit. Only spends record usage, and only those given it, so a
// charge without usage contributes nothing here even when it cost credits.
export async function getLedgerUsage(
  dbAdapter: DBAdapter,
  filter: LedgerFilter,
): Promise<
  { chargeKind: LedgerChargeKind; unit: UsageUnit; quantity: number }[]
> {
  let conditions: Expression[] = [
    [`charge_id IS NOT NULL`],
    ...ledgerConditions(filter),
  ];
  // One charge spans several ledger entries, so the charges are made distinct
  // before their usage is summed.
  let rows = await query(dbAdapter, [
    `SELECT charges.charge_kind, usage.unit, SUM(usage.quantity) AS quantity`,
    `FROM credit_charge_usage usage JOIN (`,
    `SELECT DISTINCT charge_id, charge_kind FROM credits_ledger WHERE`,
    ...every(conditions),
    `) charges ON charges.charge_id = usage.charge_id`,
    `GROUP BY charges.charge_kind, usage.unit`,
    `ORDER BY charges.charge_kind, usage.unit`,
  ] as Expression);
  return rows.map((row) => ({
    chargeKind: row.charge_kind as LedgerChargeKind,
    unit: row.unit as UsageUnit,
    quantity: Number(row.quantity),
  }));
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

export async function sumUpCreditsLedger(
  db: Queryable,
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

  let results = await querierFor(db)(ledgerQuery);

  // Sum can be null if there are no matching rows in the credits_ledger table
  return results[0].sum === null ? 0 : parseInt(results[0].sum as string);
}

export async function getDailyCreditGrantInfo(
  dbAdapter: DBAdapter,
  userId: string,
): Promise<{
  lastDailyCreditGrantAt: number | null;
  dailyCreditGrantCount: number;
}> {
  let results = await query(dbAdapter, [
    `SELECT MAX(created_at) AS last_grant_at, COUNT(*) AS grant_count FROM credits_ledger WHERE user_id = `,
    param(userId),
    ` AND credit_type = 'daily_credit'`,
  ]);

  let lastGrantAt = results[0]?.last_grant_at;
  let parsed: number | null = null;
  if (lastGrantAt != null) {
    parsed =
      typeof lastGrantAt === 'number'
        ? lastGrantAt
        : parseInt(lastGrantAt as string);
    if (Number.isNaN(parsed)) {
      parsed = null;
    }
  }

  return {
    lastDailyCreditGrantAt: parsed,
    dailyCreditGrantCount: parseInt(results[0]?.grant_count as string) || 0,
  };
}

export async function getCurrentActiveSubscription(
  db: Queryable,
  userId: string,
): Promise<Subscription | null> {
  let results = await querierFor(db)([
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

export async function getMostRecentSubscriptionCycle(
  db: Queryable,
  subscriptionId: string,
): Promise<SubscriptionCycle | null> {
  let results = await querierFor(db)([
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

export async function getSubscriptionByStripeSubscriptionId(
  dbAdapter: DBAdapter,
  stripeSubscriptionId: string,
): Promise<Subscription | null> {
  let results = await query(dbAdapter, [
    `SELECT * FROM subscriptions WHERE stripe_subscription_id = `,
    param(stripeSubscriptionId),
  ]);

  if (results.length === 0) {
    return null;
  }

  return {
    id: results[0].id,
    userId: results[0].user_id,
    planId: results[0].plan_id,
    status: results[0].status,
  } as Subscription;
}

export async function updateSubscription(
  dbAdapter: DBAdapter,
  subscriptionId: string,
  params: {
    status: string;
    endedAt?: number;
  },
) {
  let { valueExpressions, nameExpressions } = asExpressions({
    status: params.status,
    ended_at: params.endedAt,
  });

  await query(dbAdapter, [
    ...update('subscriptions', nameExpressions, valueExpressions),
    `WHERE id =`,
    param(subscriptionId),
  ] as Expression);
}

export async function getPlanById(
  dbAdapter: DBAdapter,
  planId: string,
): Promise<Plan | null> {
  let results = await query(dbAdapter, [
    `SELECT * FROM plans WHERE id = `,
    param(planId),
  ]);

  if (results.length !== 1) {
    return null;
  }

  return planRowToPlan(results[0]);
}

export async function getPlanByMonthlyPrice(
  dbAdapter: DBAdapter,
  monthlyPrice: number,
): Promise<Plan | null> {
  let results = await query(dbAdapter, [
    `SELECT * FROM plans WHERE monthly_price = `,
    param(monthlyPrice),
  ]);

  if (results.length <= 0) {
    return null;
  }

  return planRowToPlan(results[0]);
}

export async function expireRemainingPlanAllowanceInSubscriptionCycle(
  dbAdapter: DBAdapter,
  userId: string,
  subscriptionCycleId: string,
) {
  let creditsToExpire = await sumUpCreditsLedger(dbAdapter, {
    creditType: ['plan_allowance', 'plan_allowance_used'],
    subscriptionCycleId,
  });

  await addToCreditsLedger(dbAdapter, {
    userId: userId,
    creditAmount: -creditsToExpire,
    creditType: 'plan_allowance_expired',
    subscriptionCycleId,
    charge: { kind: 'expiry' },
  });
}

// What `spendCredits` did with a charge:
// - `charged`: it wrote the charge's ledger entries.
// - `already-charged`: the charge's identity was already in the ledger, so it
//   wrote nothing.
// - `nothing-to-charge`: the user's buckets held nothing to draw on, so it
//   wrote nothing. No entry carries the charge's identity, so a later call can
//   still charge it.
export type SpendResult = 'charged' | 'already-charged' | 'nothing-to-charge';

// Spends `creditsToSpend` of the user's credits on `charge`, drawing on their
// plan allowance first, then daily credits, then extra credits, and charging
// only what those hold. It writes one ledger entry per bucket it draws from,
// all carrying the charge, in one INSERT.
//
// `usage` is how much of each unit the charge priced. It is recorded with the
// charge, under the id its entries share, so it is written exactly when they
// are.
//
// A charge with an identity (see `chargeIdentity`) is written at most once:
// in one transaction, holding a lock on the identity, it checks whether the
// charge is already in the ledger and writes nothing if it is. Calls in this
// process for one identity queue in memory first (see `inChargeQueue`), so
// only one of them holds a pooled connection while it waits on the lock.
//
// The balance it draws on is read and spent without a lock of its own, so two
// different charges for one user must not run at once: callers hold the
// payer's cost lock (`DBAdapter.withUserCostLock`) around it, as billable
// calls do when they settle.
export async function spendCredits(
  dbAdapter: DBAdapter,
  userId: string,
  creditsToSpend: number,
  charge: SpendCharge = { kind: 'ai' },
  usage: ChargeUsage = {},
): Promise<SpendResult> {
  if (charge.kind === 'storage' && !isCalendarDay(charge.day)) {
    throw new Error(
      `a storage charge's day must be a YYYY-MM-DD date, got ${charge.day}`,
    );
  }
  let identity = chargeIdentity(charge);
  if (identity === undefined) {
    return await writeSpend(dbAdapter, userId, creditsToSpend, charge, usage);
  }
  return await inChargeQueue(dbAdapter, identity, () =>
    dbAdapter.withTransaction(
      async (tx) => {
        await tx([
          `SELECT pg_advisory_xact_lock(hashtextextended(`,
          param(`credits-ledger-charge:${identity}`),
          `, 0))`,
        ]);
        if (await isCharged(tx, charge)) {
          return 'already-charged';
        }
        return await writeSpend(tx, userId, creditsToSpend, charge, usage);
      },
      { label: `ledger charge ${identity}` },
    ),
  );
}

// The tail of each charge identity's in-process queue, per adapter. An entry
// lives only while a call for its identity is queued or running.
const chargeQueues = new WeakMap<DBAdapter, Map<string, Promise<void>>>();

// Runs `fn` once every earlier call queued here for the same adapter and
// charge identity has settled. The advisory lock on the identity still
// serializes writers across replicas; this queue keeps same-identity callers
// within one process waiting in memory, so each identity pins at most one
// pooled connection per process however many calls for it arrive at once.
// The same shape as `PgAdapter.withUserCostLock`'s in-process queue.
//
// Callers that hold the payer's cost lock already wait in memory behind
// same-payer writers. That lock does not cover writers of one charge under
// different payers: a charge's identity leaves out the payer (see
// `chargeIdentity`), so an automation's storage for a day can be retried for
// a new payer while a write for the old one is still waiting on the lock.
// Those writers hold different cost locks and meet only here.
//
// A call that fails does not fail the calls queued behind it: each waits for
// the one ahead to settle, not to succeed, and sees only its own outcome.
async function inChargeQueue<T>(
  dbAdapter: DBAdapter,
  identity: string,
  fn: () => Promise<T>,
): Promise<T> {
  let queues = chargeQueues.get(dbAdapter);
  if (!queues) {
    queues = new Map();
    chargeQueues.set(dbAdapter, queues);
  }
  let previous = queues.get(identity) ?? Promise.resolve();
  let mine = previous.then(fn);
  let settled = mine.then(
    () => undefined,
    () => undefined,
  );
  queues.set(identity, settled);
  // Removes the entry once its queue is idle. A later caller that has queued
  // behind this one owns the tail, and removing it would let the next caller
  // skip past that later one.
  void settled.then(() => {
    if (queues.get(identity) === settled) {
      queues.delete(identity);
    }
  });
  return await mine;
}

// Writes a spend's ledger entries and its usage in one statement: a
// data-modifying CTE inserts the usage beside the entries, so both land or
// neither does, inside or outside a transaction.
async function writeSpend(
  db: Queryable,
  userId: string,
  creditsToSpend: number,
  charge: SpendCharge,
  usage: ChargeUsage,
): Promise<SpendResult> {
  let entries = await planSpend(db, userId, creditsToSpend);
  if (entries.length === 0) {
    return 'nothing-to-charge';
  }
  for (let [unit, quantity] of Object.entries(usage)) {
    if (
      quantity !== undefined &&
      (typeof quantity !== 'number' ||
        !Number.isFinite(quantity) ||
        quantity < 0)
    ) {
      throw new Error(
        `usage for ${unit} must be a finite number of 0 or more, got ${quantity}`,
      );
    }
  }
  let chargeId = globalThis.crypto.randomUUID();
  let insertEntries = ledgerInsert(
    entries.map((entry) => ({ ...entry, charge, chargeId })),
  );
  let units = (Object.entries(usage) as [UsageUnit, number | undefined][])
    .filter(([, quantity]) => quantity !== undefined)
    .map(
      ([unit, quantity]) =>
        addExplicitParens(
          separatedByCommas([
            [param(chargeId)],
            [param(unit)],
            [param(String(quantity))],
            [param(userId)],
          ]),
        ) as Expression,
    );
  if (units.length === 0) {
    await querierFor(db)(insertEntries);
  } else {
    await querierFor(db)([
      'WITH usage AS (INSERT INTO credit_charge_usage (charge_id, unit, quantity, user_id) VALUES',
      ...separatedByCommas(units),
      ')',
      ...insertEntries,
    ] as Expression);
  }
  return 'charged';
}

function isCalendarDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return false;
  }
  let date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day);
}

// The ledger entries that spend `creditsToSpend` from the user's buckets.
async function planSpend(
  db: Queryable,
  userId: string,
  creditsToSpend: number,
): Promise<Omit<LedgerEntry, 'id'>[]> {
  let entries: Omit<LedgerEntry, 'id'>[] = [];
  let subscription = await getCurrentActiveSubscription(db, userId);

  if (!subscription) {
    // If user has no subscription, it means they are on the free plan
    let availableDailyCredits = await sumUpCreditsLedger(db, {
      creditType: ['daily_credit', 'daily_credit_used'],
      userId,
    });
    let dailyCreditsToSpend = Math.min(creditsToSpend, availableDailyCredits);
    let remainingCredits = creditsToSpend - dailyCreditsToSpend;

    if (dailyCreditsToSpend > 0) {
      entries.push({
        userId,
        creditAmount: -dailyCreditsToSpend,
        creditType: 'daily_credit_used',
        subscriptionCycleId: null, // Free plan has no subscription cycle
      });
    }

    if (remainingCredits > 0) {
      let availableExtraCredits = await sumUpCreditsLedger(db, {
        creditType: ['extra_credit', 'extra_credit_used'],
        userId,
      });

      let extraCreditsToSpend = Math.min(
        remainingCredits,
        availableExtraCredits,
      );

      if (extraCreditsToSpend > 0) {
        entries.push({
          userId,
          creditAmount: -extraCreditsToSpend,
          creditType: 'extra_credit_used',
          subscriptionCycleId: null, // Free plan has no subscription cycle
        });
      }
    }

    return entries;
  }

  let subscriptionCycle = await getMostRecentSubscriptionCycle(
    db,
    subscription.id,
  );
  if (!subscriptionCycle) {
    throw new Error('subscription cycle not found');
  }
  let availablePlanAllowanceCredits = Math.max(
    0,
    await sumUpCreditsLedger(db, {
      creditType: [
        'plan_allowance',
        'plan_allowance_used',
        'plan_allowance_expired',
      ],
      subscriptionCycleId: subscriptionCycle.id,
    }),
  );

  if (availablePlanAllowanceCredits >= creditsToSpend) {
    entries.push({
      userId,
      creditAmount: -creditsToSpend,
      creditType: 'plan_allowance_used',
      subscriptionCycleId: subscriptionCycle.id,
    });
    return entries;
  }

  let planAllowanceToSpend = availablePlanAllowanceCredits; // Spend all plan allowance credits first
  let remainingCredits = creditsToSpend - planAllowanceToSpend;

  if (planAllowanceToSpend > 0) {
    entries.push({
      userId,
      creditAmount: -planAllowanceToSpend,
      creditType: 'plan_allowance_used',
      subscriptionCycleId: subscriptionCycle.id,
    });
  }

  let availableDailyCredits = await sumUpCreditsLedger(db, {
    creditType: ['daily_credit', 'daily_credit_used'],
    userId,
  });
  let dailyCreditsToSpend = Math.min(remainingCredits, availableDailyCredits);
  remainingCredits -= dailyCreditsToSpend;

  if (dailyCreditsToSpend > 0) {
    entries.push({
      userId,
      creditAmount: -dailyCreditsToSpend,
      creditType: 'daily_credit_used',
      subscriptionCycleId: null,
    });
  }

  if (remainingCredits > 0) {
    // If user does not have enough plan allowance or daily credits, use extra credits
    let availableExtraCredits = await sumUpCreditsLedger(db, {
      creditType: ['extra_credit', 'extra_credit_used'],
      userId,
    });
    let extraCreditsToSpend = Math.min(remainingCredits, availableExtraCredits);
    if (extraCreditsToSpend > 0) {
      entries.push({
        userId,
        creditAmount: -extraCreditsToSpend,
        creditType: 'extra_credit_used',
        subscriptionCycleId: subscriptionCycle.id,
      });
    }
  }
  return entries;
}

export async function getPlanByName(
  dbAdapter: DBAdapter,
  planName: string,
): Promise<Plan | null> {
  let results = await query(dbAdapter, [
    `SELECT * FROM plans WHERE name = `,
    param(planName),
  ]);

  if (results.length !== 1) {
    return null;
  }

  return planRowToPlan(results[0]);
}

// Admits one billable call for `matrixUserId` unless the user already has
// `maxInFlight` unexpired calls in flight. Callers hold the user's cost lock
// around this, which is what makes the count and the insert one decision
// across replicas. Expired rows belong to calls whose replica never came back
// to delete them, so they are cleared rather than counted.
export async function reserveBillableCall(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  { maxInFlight, expiresAt }: { maxInFlight: number; expiresAt: number },
): Promise<{ reservationId: string | undefined; inFlight: number }> {
  await query(dbAdapter, [
    `DELETE FROM billable_call_reservations WHERE matrix_user_id = `,
    param(matrixUserId),
    ` AND expires_at <= `,
    param(Date.now()),
  ]);
  let [{ count }] = await query(dbAdapter, [
    `SELECT COUNT(*) AS count FROM billable_call_reservations WHERE matrix_user_id = `,
    param(matrixUserId),
  ]);
  let inFlight = Number(count);
  if (inFlight >= maxInFlight) {
    return { reservationId: undefined, inFlight };
  }
  let [{ id }] = await query(dbAdapter, [
    `INSERT INTO billable_call_reservations (matrix_user_id, expires_at) VALUES (`,
    param(matrixUserId),
    `, `,
    param(expiresAt),
    `) RETURNING id`,
  ]);
  return { reservationId: id as string, inFlight: inFlight + 1 };
}

export async function renewBillableCall(
  dbAdapter: DBAdapter,
  reservationId: string,
  expiresAt: number,
) {
  await query(dbAdapter, [
    `UPDATE billable_call_reservations SET expires_at = `,
    param(expiresAt),
    ` WHERE id = `,
    param(reservationId),
  ]);
}

export async function releaseBillableCall(
  dbAdapter: DBAdapter,
  reservationId: string,
) {
  await query(dbAdapter, [
    `DELETE FROM billable_call_reservations WHERE id = `,
    param(reservationId),
  ]);
}
