import {
  counterKey,
  DBRateLimitStore,
  fetchDirectWriters,
  isDirectWriter,
  isRateLimitUnavailable,
  logger,
  param,
  query,
  type BudgetOutcome,
  type BudgetPeriod,
  type DBAdapter,
  type RateLimitStore,
  type TokenBucketOutcome,
} from '@cardstack/runtime-common';
import {
  OperationFailure,
  type AnonymousCallApiCaller,
} from '@cardstack/runtime-common/card-operations';
import {
  KEY_LIMIT_COLUMNS,
  keyLimitDefaults,
  limitsOf,
  MAX_KEY_LIMIT,
  type KeyLimits,
} from './key-limit-settings.ts';
import { UserKeyError } from './user-keys.ts';

// Limits: how much of a key anyone spends, set by the key's owner. No credits
// change hands for a user's key, so a caller's balance limits nothing; these
// do the whole job.
//
// - **Where they live.** On the share an `{{apiKey}}` slot is filled from, or
//   on the personal key a `{{userKey}}` slot is filled with. A binding
//   authorizes a call and carries no limits. A share or key whose owner set
//   none gets the platform's defaults (`key-limit-settings.ts`), so no key a
//   browser can reach is unlimited by accident.
// - **What they bound.** A token bucket per caller of each share or key, and a
//   daily and a monthly budget of calls per share or key, across every caller.
// - **Interactive calls only.** A call carrying a user's session — a card in
//   the browser, the AI assistant, the CLI — counts. A pipeline is bounded by
//   its schedule's payer, cap and limits, so a nightly sync never fails
//   because a card got popular, and its calls never spend a budget.
// - **Counted before anything is sent**, and only once every slot has passed
//   its other checks. The budgets are read first, then the caller's bucket is
//   taken from, then the budgets are spent. A call refused at any step is
//   counted against nothing: what it already took or spent is put back.
// - **Fail closed.** A counter that can't be read or written refuses the call
//   `rate-limit-unavailable` (503) and nothing is sent.
// - **Notices.** When a period's use reaches the high-water mark, and when it
//   reaches the budget, the key's owner and, for a share, the realm's direct
//   writers each get one notice for that period (`key_limit_notices`).
// - **Every refusal is logged** on the `boxel:key-limits` channel with the
//   share or key, the caller and the limit that refused it.
// - **Callers who aren't signed in**, served by a share whose owner allows
//   anonymous use, have a bucket per address (the rate the share sets for each
//   person, counted for each address instead), and spend the share's daily
//   and monthly budgets as everyone does. Where the owner set the share's
//   optional anonymous cap, they also draw together from it: a daily budget
//   of calls inside the share's own, so they can't use up what signed-in
//   readers rely on.
//
// Only the key's owner changes a share's or a key's limits, from the secure
// window or the CLI. A realm's other direct writers can't raise them; they
// can suspend a share they think is being abused.

const log = logger('realm:key-limits');

export const KEY_LIMITS_CHANNEL = 'boxel:key-limits';

// What a call is counted against: the share filling an `{{apiKey}}` slot, or
// the personal key filling a `{{userKey}}` slot.
export type LimitSubject =
  | { kind: 'share'; id: string }
  | { kind: 'key'; id: string };

// The subject as the database holds it, with the limits in force and what a
// notice names.
interface LimitedSubject {
  subject: LimitSubject;
  limits: KeyLimits;
  // A share's anonymous cap: calls a UTC day across everyone who isn't
  // signed in. Null where its owner set none.
  anonymousDailyCap: number | null;
  owner: string;
  label: string;
  // The share's realm; absent for a personal key.
  realmURL?: string;
}

// One JSON line per event on the `boxel:key-limits` channel: ids and numbers,
// never a key's value or a request.
export type KeyLimitEvent =
  | {
      event: 'refused';
      code: 'rate-limited' | 'over-budget' | 'rate-limit-unavailable';
      share: string | null;
      key: string | null;
      // The signed-in caller, or `"anonymous"` for a caller who isn't
      // signed in. Their address is never logged here.
      caller: string;
      realm: string;
      operation: string;
      // The limit that refused the call; absent when the counters couldn't
      // be read. `anonymousCap` marks the share's anonymous cap.
      limit?: Limit;
      retryAfterSeconds: number;
    }
  | {
      event: 'threshold';
      threshold: 'high-water' | 'budget';
      share: string | null;
      key: string | null;
      period: BudgetPeriod;
      budget: number;
      used: number;
    };

let sink: ((event: KeyLimitEvent) => void) | undefined;

export function setKeyLimitSink(
  next: ((event: KeyLimitEvent) => void) | undefined,
): void {
  sink = next;
}

let channelLog: ReturnType<typeof logger> | undefined;

function emit(event: KeyLimitEvent): void {
  try {
    if (sink) {
      sink(event);
      return;
    }
    (channelLog ??= logger(KEY_LIMITS_CHANNEL)).info(
      JSON.stringify({ channel: KEY_LIMITS_CHANNEL, ...event }),
    );
  } catch (error) {
    log.warn(
      `could not record a key limit event: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// How long a caller refused because the counters couldn't be read waits
// before asking again.
const UNAVAILABLE_RETRY_SECONDS = 5;

// The counters behind every limit. A test swaps in its own clock, or a store
// that fails, with `setKeyLimitStore`.
let storeFor: (dbAdapter: DBAdapter) => RateLimitStore = (dbAdapter) =>
  new DBRateLimitStore(dbAdapter);
let stores = new WeakMap<DBAdapter, RateLimitStore>();

export function setKeyLimitStore(
  next?: (dbAdapter: DBAdapter) => RateLimitStore,
): void {
  storeFor = next ?? ((dbAdapter) => new DBRateLimitStore(dbAdapter));
  stores = new WeakMap();
}

// One store per database, so its sweep counter spans every call.
function storeOf(dbAdapter: DBAdapter): RateLimitStore {
  let store = stores.get(dbAdapter);
  if (!store) {
    store = storeFor(dbAdapter);
    stores.set(dbAdapter, store);
  }
  return store;
}

type Limit =
  | { rateBurst: number; rateRefillPerMinute: number }
  | { period: BudgetPeriod; budget: number; anonymousCap?: true };

// A caller who isn't signed in is counted by the address the realm admitted
// them from, in a bucket of its own that no signed-in caller's id can name.
function bucketKey(
  subject: LimitSubject,
  caller: string,
  anonymous?: AnonymousCallApiCaller,
): string {
  return anonymous
    ? counterKey(
        'key-limit',
        subject.kind,
        subject.id,
        'anonymous',
        anonymous.address,
      )
    : counterKey('key-limit', subject.kind, subject.id, caller);
}

function budgetKey(subject: LimitSubject): string {
  return counterKey('key-limit', subject.kind, subject.id);
}

function anonymousCapKey(subject: LimitSubject): string {
  return counterKey('key-limit', subject.kind, subject.id, 'anonymous');
}

function bucketOf(limits: KeyLimits) {
  return {
    burst: limits.rateBurst,
    refillPerMinute: limits.rateRefillPerMinute,
  };
}

interface CountedBudget {
  key: string;
  period: BudgetPeriod;
  limit: number;
  anonymousCap?: true;
}

// The budgets a call spends: the share's or key's daily and monthly budgets,
// and for a caller who isn't signed in, the share's anonymous cap too, where
// it has one.
function budgetsOf(
  limited: LimitedSubject,
  anonymous?: AnonymousCallApiCaller,
): CountedBudget[] {
  let key = budgetKey(limited.subject);
  let budgets: CountedBudget[] = [
    { key, period: 'day', limit: limited.limits.dailyBudget },
    { key, period: 'month', limit: limited.limits.monthlyBudget },
  ];
  if (anonymous && limited.anonymousDailyCap != null) {
    budgets.push({
      key: anonymousCapKey(limited.subject),
      period: 'day',
      // No daily budget below the cap is accepted, so it fits inside the
      // budget; a platform default lowered under a share's cap holds the cap
      // to it.
      limit: Math.min(limited.anonymousDailyCap, limited.limits.dailyBudget),
      anonymousCap: true,
    });
  }
  return budgets;
}

function limitOf(budget: CountedBudget): Limit {
  return {
    period: budget.period,
    budget: budget.limit,
    ...(budget.anonymousCap ? { anonymousCap: true as const } : {}),
  };
}

// The subjects as the database holds them now, each once. One that is gone
// (a share unshared since its slot was checked) is left out: the slot check
// that found it is what refuses a call through it.
async function limitedSubjects(
  dbAdapter: DBAdapter,
  subjects: LimitSubject[],
): Promise<LimitedSubject[]> {
  let seen = new Set<string>();
  let found: LimitedSubject[] = [];
  for (let subject of subjects) {
    let id = `${subject.kind}:${subject.id}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    let [row] = await query(
      dbAdapter,
      subject.kind === 'share'
        ? [
            `SELECT owner, label, realm_url, anonymous_daily_cap, ${KEY_LIMIT_COLUMNS} FROM key_shares WHERE id = `,
            param(subject.id),
          ]
        : [
            `SELECT owner, name AS label, ${KEY_LIMIT_COLUMNS} FROM user_keys WHERE id = `,
            param(subject.id),
          ],
    );
    if (!row) {
      continue;
    }
    found.push({
      subject,
      limits: limitsOf(row),
      anonymousDailyCap:
        row.anonymous_daily_cap == null
          ? null
          : Number(row.anonymous_daily_cap),
      owner: row.owner as string,
      label: row.label as string,
      ...(subject.kind === 'share'
        ? { realmURL: row.realm_url as string }
        : {}),
    });
  }
  return found;
}

export interface LimitedCall {
  realmURL: string;
  operation: string;
  caller: string;
  // Set for a caller who isn't signed in: only shares serve one.
  anonymous?: AnonymousCallApiCaller;
  subjects: LimitSubject[];
}

// Counts an interactive call against every share and key filling its slots,
// or throws the refusal for the first limit it is over. A call refused at any
// share or key is counted against none of them: what an earlier one took or
// spent is put back before the refusal is thrown, so a call whose second
// share is over its limit can't wear down the first one's.
export async function chargeInteractiveCall(
  dbAdapter: DBAdapter,
  call: LimitedCall,
): Promise<void> {
  let subjects = await limitedSubjects(dbAdapter, call.subjects);
  if (subjects.length === 0) {
    return;
  }
  let store = storeOf(dbAdapter);

  // Reading every budget first refuses a call that is plainly over one
  // without taking anything at all.
  for (let limited of subjects) {
    for (let budget of budgetsOf(limited, call.anonymous)) {
      let outcome = await store.budget(budget.key, budget);
      if (!outcome.admitted) {
        throw refuse(call, limited, outcome, limitOf(budget));
      }
    }
  }

  // What this call has taken and spent so far, to put back if a later share
  // or key refuses it.
  let taken: { key: string; bucket: ReturnType<typeof bucketOf> }[] = [];
  let spent: {
    key: string;
    period: BudgetPeriod;
    resetsAt: number;
  }[] = [];
  let giveBack = async () => {
    for (let { key, bucket } of taken) {
      await store.refund(key, bucket);
    }
    for (let { key, period, resetsAt } of spent) {
      await store.unspend(key, { period, resetsAt });
    }
  };

  for (let limited of subjects) {
    let bucket = bucketOf(limited.limits);
    let key = bucketKey(limited.subject, call.caller, call.anonymous);
    let outcome = await store.take(key, bucket);
    if (!outcome.admitted) {
      await giveBack();
      throw refuse(call, limited, outcome, {
        rateBurst: bucket.burst,
        rateRefillPerMinute: bucket.refillPerMinute,
      });
    }
    taken.push({ key, bucket });
  }

  // A budget spent by another call between the read above and here refuses
  // this one; the spends are kept until every one has gone through, so the
  // notices below are sent only for a call that was counted.
  let reached: {
    limited: LimitedSubject;
    budget: CountedBudget;
    outcome: Extract<BudgetOutcome, { admitted: true }>;
  }[] = [];
  for (let limited of subjects) {
    for (let budget of budgetsOf(limited, call.anonymous)) {
      let { key } = budget;
      let outcome = await store.spend(key, budget);
      if (!outcome.admitted) {
        await giveBack();
        throw refuse(call, limited, outcome, limitOf(budget));
      }
      spent.push({ key, period: budget.period, resetsAt: outcome.resetsAt });
      // The anonymous cap sends no notice of its own: reaching it refuses
      // only callers who aren't signed in, and the share's budgets, which
      // their calls spend too, notify as they always do.
      if (!budget.anonymousCap) {
        reached.push({ limited, budget, outcome });
      }
    }
  }
  for (let { limited, budget, outcome } of reached) {
    await noticeThresholds(dbAdapter, limited, budget, outcome);
  }
}

// What readiness answers for the limits of the shares and keys that would
// fill a call's slots: `over-budget` when a budget is used up, `rate-limited`
// when the caller's bucket is empty, and `ready` otherwise. Nothing is taken
// or spent. Counters that can't be read answer `ready`: readiness is advisory,
// and the call refuses `rate-limit-unavailable` itself.
export async function limitReadiness(
  dbAdapter: DBAdapter,
  {
    caller,
    anonymous,
    subjects,
  }: {
    caller: string;
    anonymous?: AnonymousCallApiCaller;
    subjects: LimitSubject[];
  },
): Promise<'ready' | 'rate-limited' | 'over-budget'> {
  let limited = await limitedSubjects(dbAdapter, subjects);
  let store = storeOf(dbAdapter);
  let answer: 'ready' | 'rate-limited' = 'ready';
  for (let one of limited) {
    for (let budget of budgetsOf(one, anonymous)) {
      let outcome = await store.budget(budget.key, budget);
      if (!outcome.admitted && !isRateLimitUnavailable(outcome)) {
        return 'over-budget';
      }
    }
    let outcome = await store.peek(
      bucketKey(one.subject, caller, anonymous),
      bucketOf(one.limits),
    );
    if (!outcome.admitted && !isRateLimitUnavailable(outcome)) {
      answer = 'rate-limited';
    }
  }
  return answer;
}

function refuse(
  call: LimitedCall,
  limited: LimitedSubject,
  outcome: Exclude<TokenBucketOutcome | BudgetOutcome, { admitted: true }>,
  limit: Limit,
): OperationFailure {
  let { subject } = limited;
  let ids = {
    share: subject.kind === 'share' ? subject.id : null,
    key: subject.kind === 'key' ? subject.id : null,
  };
  let whose = subject.kind === 'share' ? "this realm's shared key" : 'your key';
  if (isRateLimitUnavailable(outcome)) {
    emit({
      event: 'refused',
      code: 'rate-limit-unavailable',
      ...ids,
      caller: call.caller,
      realm: call.realmURL,
      operation: call.operation,
      retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS,
    });
    return new OperationFailure({
      status: 503,
      code: 'rate-limit-unavailable',
      title: 'Service unavailable',
      detail: `operation "${call.operation}" wasn't sent: the use of ${whose} couldn't be counted. Try again in ${UNAVAILABLE_RETRY_SECONDS} seconds.`,
      meta: { retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS },
    });
  }
  let { retryAfterSeconds } = outcome;
  let budget = 'period' in limit;
  emit({
    event: 'refused',
    code: budget ? 'over-budget' : 'rate-limited',
    ...ids,
    caller: call.caller,
    realm: call.realmURL,
    operation: call.operation,
    limit,
    retryAfterSeconds,
  });
  let wait = `${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}`;
  // A share's budget and its numbers are its owner's business; a reader is
  // told only that the realm's limit is reached, and when it resets.
  return budget
    ? new OperationFailure({
        status: 429,
        code: 'over-budget',
        title: 'Over budget',
        detail:
          'anonymousCap' in limit
            ? `operation "${call.operation}" wasn't sent: this realm's limit for its shared key, for people who aren't signed in, is reached. It resets in ${wait}, and signing in may let you use it now.`
            : subject.kind === 'share'
              ? `operation "${call.operation}" wasn't sent: this realm's limit for its shared key is reached. It resets in ${wait}.`
              : `operation "${call.operation}" wasn't sent: the ${(limit as { period: BudgetPeriod }).period === 'day' ? 'daily' : 'monthly'} budget you set for your key is used up. It resets in ${wait}.`,
        meta: { retryAfterSeconds },
      })
    : new OperationFailure({
        status: 429,
        code: 'rate-limited',
        title: 'Too many requests',
        detail: `operation "${call.operation}" wasn't sent: you have made as many calls with ${whose} as its limit allows for now. Try again in ${wait}.`,
        meta: { retryAfterSeconds },
      });
}

// Records the notices a spend owes: one when the period's use reaches the
// high-water mark and one when it reaches the budget, each to the key's owner
// and, for a share, the realm's direct writers. A spend moves the count by
// one call, so exactly one spend crosses each threshold; the unique index on
// `key_limit_notices` keeps a recipient to one notice per threshold and
// period even so. A notice that can't be recorded is logged and costs the
// call nothing.
async function noticeThresholds(
  dbAdapter: DBAdapter,
  limited: LimitedSubject,
  { period, limit }: { period: BudgetPeriod; limit: number },
  outcome: Extract<BudgetOutcome, { admitted: true }>,
  cost = 1,
): Promise<void> {
  let { used, resetsAt } = outcome;
  let highWater = Math.ceil(
    (limit * keyLimitDefaults().highWaterPercent) / 100,
  );
  let crossed = (threshold: number) =>
    used >= threshold && used - cost < threshold;
  let thresholds: ('high-water' | 'budget')[] = [];
  if (highWater < limit && crossed(highWater)) {
    thresholds.push('high-water');
  }
  if (crossed(limit)) {
    thresholds.push('budget');
  }
  if (thresholds.length === 0) {
    return;
  }
  let { subject } = limited;
  try {
    let recipients = new Set([limited.owner]);
    if (limited.realmURL) {
      for (let writer of await fetchDirectWriters(
        dbAdapter,
        new URL(limited.realmURL),
      )) {
        recipients.add(writer);
      }
    }
    for (let threshold of thresholds) {
      emit({
        event: 'threshold',
        threshold,
        share: subject.kind === 'share' ? subject.id : null,
        key: subject.kind === 'key' ? subject.id : null,
        period,
        budget: limit,
        used,
      });
      for (let recipient of recipients) {
        await query(dbAdapter, [
          `INSERT INTO key_limit_notices (share_id, key_id, realm_url, label, recipient, owner, period, period_ends_at, threshold, budget) VALUES (`,
          param(subject.kind === 'share' ? subject.id : null),
          `, `,
          param(subject.kind === 'key' ? subject.id : null),
          `, `,
          param(limited.realmURL ?? null),
          `, `,
          param(limited.label),
          `, `,
          param(recipient),
          `, `,
          param(limited.owner),
          `, `,
          param(period),
          `, to_timestamp(`,
          param(resetsAt),
          `), `,
          param(threshold),
          `, `,
          param(limit),
          `) ON CONFLICT DO NOTHING`,
        ]);
      }
    }
  } catch (error) {
    log.warn(
      `could not record the ${thresholds.join(' and ')} notice for ${subject.kind} ${subject.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Limits as an owner sets them: each a number, or null for the platform's
// default. A limit left out keeps what it was.
export interface KeyLimitChanges {
  rateBurst?: number | null;
  rateRefillPerMinute?: number | null;
  dailyBudget?: number | null;
  monthlyBudget?: number | null;
}

const LIMIT_ATTRIBUTES: Record<
  keyof KeyLimitChanges,
  { column: string; whole: boolean }
> = {
  rateBurst: { column: 'rate_burst', whole: true },
  rateRefillPerMinute: { column: 'rate_refill_per_minute', whole: false },
  dailyBudget: { column: 'daily_budget', whole: true },
  monthlyBudget: { column: 'monthly_budget', whole: true },
};

export function validateLimitChanges(
  attributes: Record<string, unknown>,
): KeyLimitChanges {
  let changes: KeyLimitChanges = {};
  for (let [name, value] of Object.entries(attributes)) {
    let attribute = LIMIT_ATTRIBUTES[name as keyof KeyLimitChanges];
    if (!attribute) {
      throw new UserKeyError(400, `'${name}' can't be set here`);
    }
    if (value === null) {
      changes[name as keyof KeyLimitChanges] = null;
      continue;
    }
    let valid =
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value <= MAX_KEY_LIMIT &&
      (attribute.whole ? Number.isInteger(value) && value >= 1 : value > 0);
    if (!valid) {
      throw new UserKeyError(
        400,
        `'${name}' is ${attribute.whole ? 'a whole number of at least one' : 'a positive number'} up to ${MAX_KEY_LIMIT}, or null for the platform's default`,
      );
    }
    changes[name as keyof KeyLimitChanges] = value as number;
  }
  if (Object.keys(changes).length === 0) {
    throw new UserKeyError(400, 'no limit to change');
  }
  return changes;
}

function assignments(changes: KeyLimitChanges) {
  let parts: unknown[] = [];
  for (let [name, value] of Object.entries(changes)) {
    let { column } = LIMIT_ATTRIBUTES[name as keyof KeyLimitChanges];
    parts.push(parts.length === 0 ? `${column} = ` : `, ${column} = `);
    parts.push(param(value));
  }
  return parts;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sets a share's limits. Only the share's owner, the owner of the key it
// holds, may: a direct writer of its realm who isn't is refused 403, and
// anyone who can't see the share is told it doesn't exist.
export async function setShareLimits(
  dbAdapter: DBAdapter,
  {
    user,
    shareId,
    changes,
  }: {
    user: string;
    shareId: string;
    changes: KeyLimitChanges;
  },
): Promise<KeyLimits> {
  let noSuchShare = () => new UserKeyError(404, 'no such share');
  if (!UUID.test(shareId)) {
    throw noSuchShare();
  }
  // The anonymous cap sits inside the daily budget, keeping the rest of it
  // for signed-in readers, so the budget never goes below it.
  if (changes.dailyBudget !== undefined) {
    let [share] = await query(dbAdapter, [
      `SELECT anonymous_daily_cap FROM key_shares WHERE id = `,
      param(shareId),
      ` AND owner = `,
      param(user),
    ]);
    assertBudgetHoldsCap(
      share?.anonymous_daily_cap,
      changes.dailyBudget ?? keyLimitDefaults().dailyBudget,
    );
  }
  let [row] = await query(dbAdapter, [
    `UPDATE key_shares SET `,
    ...assignments(changes),
    `, updated_at = NOW() WHERE id = `,
    param(shareId),
    ` AND owner = `,
    param(user),
    ` RETURNING ${KEY_LIMIT_COLUMNS}`,
  ] as Parameters<typeof query>[1]);
  if (row) {
    return limitsOf(row);
  }
  let [share] = await query(dbAdapter, [
    `SELECT realm_url FROM key_shares WHERE id = `,
    param(shareId),
  ]);
  if (
    share &&
    (await isDirectWriter(dbAdapter, new URL(share.realm_url as string), user))
  ) {
    throw new UserKeyError(
      403,
      "only the share's owner changes its limits; a direct writer can suspend it",
    );
  }
  throw noSuchShare();
}

// Refuses a daily budget below the share's anonymous cap.
export function assertBudgetHoldsCap(cap: unknown, dailyBudget: number): void {
  if (cap != null && Number(cap) > dailyBudget) {
    throw new UserKeyError(
      400,
      `the daily budget is at least the share's anonymous cap of ${Number(cap)} calls, which people who aren't signed in share`,
    );
  }
}

// Sets one of the user's own keys' limits. Another user's key answers as one
// that doesn't exist.
export async function setUserKeyLimits(
  dbAdapter: DBAdapter,
  {
    owner,
    keyId,
    changes,
  }: {
    owner: string;
    keyId: string;
    changes: KeyLimitChanges;
  },
): Promise<KeyLimits> {
  if (!UUID.test(keyId)) {
    throw new UserKeyError(404, 'no such key');
  }
  let [row] = await query(dbAdapter, [
    `UPDATE user_keys SET `,
    ...assignments(changes),
    ` WHERE id = `,
    param(keyId),
    ` AND owner = `,
    param(owner),
    ` RETURNING ${KEY_LIMIT_COLUMNS}`,
  ] as Parameters<typeof query>[1]);
  if (!row) {
    throw new UserKeyError(404, 'no such key');
  }
  return limitsOf(row);
}
