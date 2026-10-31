import { param, query, type DBAdapter, type Expression } from './index.ts';
import { logger } from './log.ts';

// A refusal for want of capacity: nothing was taken, and when to try again.
// The anonymous limiter refuses in the same shape.
export interface RateLimited {
  admitted: false;
  retryAfterSeconds: number;
}

// A refusal because the store couldn't be read or updated. Nothing was taken,
// and the caller is refused rather than let through uncounted; callers answer
// it as `rate-limit-unavailable` (503).
export interface RateLimitUnavailable {
  admitted: false;
  unavailable: true;
}

export type RateLimitRefusal = RateLimited | RateLimitUnavailable;

export function isRateLimitUnavailable(
  outcome: { admitted: boolean } | RateLimitRefusal,
): outcome is RateLimitUnavailable {
  return !outcome.admitted && 'unavailable' in outcome;
}

// A burst of `burst` invocations, then a steady `refillPerMinute`. A key no
// invocation has taken from is a full bucket.
export interface TokenBucketLimit {
  // A whole number of at least one.
  burst: number;
  // Positive; need not be whole.
  refillPerMinute: number;
}

export type TokenBucketOutcome =
  | {
      admitted: true;
      // Whole tokens left in the bucket once this take is included.
      remaining: number;
    }
  | RateLimitRefusal;

// A calendar period in UTC: a budget resets at midnight UTC, or at midnight
// UTC on the first of the month.
export type BudgetPeriod = 'day' | 'month';

export interface BudgetLimit {
  period: BudgetPeriod;
  // Units a key may spend in one period, a whole number of at least one.
  limit: number;
}

export type BudgetOutcome =
  | {
      admitted: true;
      // Units spent in the current period, this spend included.
      used: number;
      // Epoch seconds at which the period ends and the count starts over.
      resetsAt: number;
    }
  | RateLimitRefusal;

// Rate limits and budgets under keys the caller composes (see `counterKey`),
// shared by every realm-server process through the database. Every answer
// fails closed: a store that can't be read refuses, as unavailable.
export interface RateLimitStore {
  // Takes `cost` tokens from the key's bucket, all of them or none.
  take(
    key: string,
    limit: TokenBucketLimit,
    cost?: number,
  ): Promise<TokenBucketOutcome>;
  // Whether a take of `cost` tokens would be admitted now, without taking
  // any. `remaining` is the whole tokens in the bucket.
  peek(
    key: string,
    limit: TokenBucketLimit,
    cost?: number,
  ): Promise<TokenBucketOutcome>;
  // Spends `cost` units of the key's budget for the current period, all of
  // them or none.
  spend(key: string, limit: BudgetLimit, cost?: number): Promise<BudgetOutcome>;
  // Whether the key has budget left in the current period, without spending
  // any. `used` is what has been spent so far.
  budget(key: string, limit: BudgetLimit): Promise<BudgetOutcome>;
  // Puts back `cost` tokens an admitted take took, never past a full bucket,
  // for a caller that took them and then didn't do the work. Answers whether
  // they went back; a store that can't be written logs and answers false.
  refund(key: string, limit: TokenBucketLimit, cost?: number): Promise<boolean>;
  // Takes back `cost` units an admitted spend spent, in the period it spent
  // them in (the spend's `resetsAt`), never below zero. A period that has
  // turned since is left alone. Answers as `refund` does.
  unspend(
    key: string,
    period: { period: BudgetPeriod; resetsAt: number },
    cost?: number,
  ): Promise<boolean>;
}

// A key made of its parts, so that no two different lists of parts make the
// same key whatever characters a part holds.
export function counterKey(...parts: string[]): string {
  return JSON.stringify(parts);
}

const MS_PER_MINUTE = 60_000;

// Each statement is the same on Postgres and SQLite. A take or a spend is one
// upsert that takes only what fits, so concurrent callers in any process never
// take more than the limit between them, and a refused one leaves the count
// where it was.
export class DBRateLimitStore implements RateLimitStore {
  #dbAdapter: DBAdapter;
  #now: () => number;
  #operations = 0;
  #log = logger('rate-limit-store');

  // Expired rows are cleared on roughly one take or spend in this many, which
  // keeps the tables to about one live row per active key without a scheduled
  // job.
  static readonly SWEEP_EVERY = 200;

  constructor(dbAdapter: DBAdapter, opts?: { now?: () => number }) {
    this.#dbAdapter = dbAdapter;
    this.#now = opts?.now ?? Date.now;
  }

  async take(
    key: string,
    limit: TokenBucketLimit,
    cost = 1,
  ): Promise<TokenBucketOutcome> {
    assertTokenBucket(limit, cost);
    let nowMs = this.#now();
    let { burst, refillPerMinute } = limit;
    if (cost > burst) {
      // More than a full bucket holds is never admitted; the soonest the
      // caller can be told is when the bucket is full.
      return {
        admitted: false,
        retryAfterSeconds: refillSeconds(burst, refillPerMinute),
      };
    }
    // Once the bucket would be full from empty, the row says nothing a
    // missing row doesn't.
    let expiresAt = Math.ceil(
      (nowMs + (burst * MS_PER_MINUTE) / refillPerMinute) / 1000,
    );

    let rows;
    try {
      // A take that doesn't fit matches the conflict but not the `WHERE`, so
      // it updates nothing and returns no row.
      rows = await query(this.#dbAdapter, [
        `INSERT INTO rate_limit_buckets (bucket_key, tokens, refilled_at, expires_at) VALUES (`,
        param(key),
        ', CAST(',
        param(burst - cost),
        ' AS DOUBLE PRECISION),',
        param(nowMs),
        ',',
        param(expiresAt),
        `) ON CONFLICT (bucket_key) DO UPDATE SET tokens =`,
        ...bucketLevel(nowMs, limit),
        '-',
        param(cost),
        `, refilled_at = CASE WHEN`,
        param(nowMs),
        '> rate_limit_buckets.refilled_at THEN',
        param(nowMs),
        'ELSE rate_limit_buckets.refilled_at END,',
        // A clock behind the row's would move the expiry earlier, and a sweep
        // would then delete a bucket that isn't full yet.
        'expires_at = CASE WHEN',
        param(expiresAt),
        '> rate_limit_buckets.expires_at THEN',
        param(expiresAt),
        'ELSE rate_limit_buckets.expires_at END',
        'WHERE',
        ...bucketLevel(nowMs, limit),
        '>=',
        param(cost),
        'RETURNING tokens',
      ] as Expression);
    } catch (e: unknown) {
      return this.#unavailable('take from token bucket', key, e);
    } finally {
      this.#maybeSweep(nowMs);
    }
    if (rows.length > 0) {
      return {
        admitted: true,
        remaining: Math.floor(Number(rows[0].tokens)),
      };
    }

    // Refused. The bucket is read again only to say when the caller can come
    // back; it may have moved since, so the answer is a hint.
    let level = await this.#level(key, limit, nowMs);
    if (typeof level !== 'number') {
      return level;
    }
    return {
      admitted: false,
      retryAfterSeconds: refillSeconds(cost - level, refillPerMinute),
    };
  }

  async peek(
    key: string,
    limit: TokenBucketLimit,
    cost = 1,
  ): Promise<TokenBucketOutcome> {
    assertTokenBucket(limit, cost);
    let { burst, refillPerMinute } = limit;
    if (cost > burst) {
      return {
        admitted: false,
        retryAfterSeconds: refillSeconds(burst, refillPerMinute),
      };
    }
    let level = await this.#level(key, limit, this.#now());
    if (typeof level !== 'number') {
      return level;
    }
    return level >= cost
      ? { admitted: true, remaining: Math.floor(level) }
      : {
          admitted: false,
          retryAfterSeconds: refillSeconds(cost - level, refillPerMinute),
        };
  }

  // The bucket's level at `nowMs`, as `take` computes it. A key nothing has
  // taken from is a full bucket.
  async #level(
    key: string,
    { burst, refillPerMinute }: TokenBucketLimit,
    nowMs: number,
  ): Promise<number | RateLimitUnavailable> {
    try {
      let current = await query(this.#dbAdapter, [
        'SELECT tokens, refilled_at FROM rate_limit_buckets WHERE bucket_key =',
        param(key),
      ] as Expression);
      return current.length === 0
        ? burst
        : Math.min(
            burst,
            Number(current[0].tokens) +
              (Math.max(0, nowMs - Number(current[0].refilled_at)) *
                refillPerMinute) /
                MS_PER_MINUTE,
          );
    } catch (e: unknown) {
      return this.#unavailable('read token bucket', key, e);
    }
  }

  async spend(
    key: string,
    limit: BudgetLimit,
    cost = 1,
  ): Promise<BudgetOutcome> {
    assertWholeCount('budget limit', limit.limit);
    assertWholeCount('budget spend', cost);
    let nowMs = this.#now();
    let { periodStart, resetsAt } = budgetPeriod(limit.period, nowMs);
    let retryAfterSeconds = Math.max(1, resetsAt - Math.floor(nowMs / 1000));
    if (cost > limit.limit) {
      return { admitted: false, retryAfterSeconds };
    }

    let rows;
    try {
      rows = await query(this.#dbAdapter, [
        `INSERT INTO rate_limit_budgets (budget_key, period, period_start, count, expires_at) VALUES (`,
        param(key),
        ',',
        param(limit.period),
        ',',
        param(periodStart),
        ',',
        param(cost),
        ',',
        param(resetsAt),
        `) ON CONFLICT (budget_key, period, period_start)
         DO UPDATE SET count = rate_limit_budgets.count + EXCLUDED.count
         WHERE rate_limit_budgets.count + EXCLUDED.count <=`,
        param(limit.limit),
        'RETURNING count',
      ] as Expression);
    } catch (e: unknown) {
      return this.#unavailable('spend budget', key, e);
    } finally {
      this.#maybeSweep(nowMs);
    }
    if (rows.length === 0) {
      return { admitted: false, retryAfterSeconds };
    }
    return { admitted: true, used: Number(rows[0].count), resetsAt };
  }

  async budget(key: string, limit: BudgetLimit): Promise<BudgetOutcome> {
    assertWholeCount('budget limit', limit.limit);
    let nowMs = this.#now();
    let { periodStart, resetsAt } = budgetPeriod(limit.period, nowMs);
    let rows;
    try {
      rows = await query(this.#dbAdapter, [
        'SELECT count FROM rate_limit_budgets WHERE budget_key =',
        param(key),
        'AND period =',
        param(limit.period),
        'AND period_start =',
        param(periodStart),
      ] as Expression);
    } catch (e: unknown) {
      return this.#unavailable('read budget', key, e);
    }
    let used = rows.length === 0 ? 0 : Number(rows[0].count);
    return used < limit.limit
      ? { admitted: true, used, resetsAt }
      : {
          admitted: false,
          retryAfterSeconds: Math.max(1, resetsAt - Math.floor(nowMs / 1000)),
        };
  }

  async refund(
    key: string,
    limit: TokenBucketLimit,
    cost = 1,
  ): Promise<boolean> {
    assertTokenBucket(limit, cost);
    try {
      await query(this.#dbAdapter, [
        'UPDATE rate_limit_buckets SET tokens = CASE WHEN tokens +',
        param(cost),
        '> CAST(',
        param(limit.burst),
        'AS DOUBLE PRECISION) THEN CAST(',
        param(limit.burst),
        'AS DOUBLE PRECISION) ELSE tokens +',
        param(cost),
        'END WHERE bucket_key =',
        param(key),
      ] as Expression);
      return true;
    } catch (e: unknown) {
      this.#unavailable('refund token bucket', key, e);
      return false;
    }
  }

  async unspend(
    key: string,
    { period, resetsAt }: { period: BudgetPeriod; resetsAt: number },
    cost = 1,
  ): Promise<boolean> {
    assertWholeCount('budget refund', cost);
    try {
      await query(this.#dbAdapter, [
        'UPDATE rate_limit_budgets SET count = CASE WHEN count >',
        param(cost),
        'THEN count -',
        param(cost),
        'ELSE 0 END WHERE budget_key =',
        param(key),
        'AND period =',
        param(period),
        'AND expires_at =',
        param(resetsAt),
      ] as Expression);
      return true;
    } catch (e: unknown) {
      this.#unavailable('refund budget', key, e);
      return false;
    }
  }

  #unavailable(action: string, key: string, e: unknown): RateLimitUnavailable {
    this.#log.warn(
      `couldn't ${action} for ${key}, refusing: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return { admitted: false, unavailable: true };
  }

  #maybeSweep(nowMs: number) {
    if (++this.#operations % DBRateLimitStore.SWEEP_EVERY === 0) {
      void this.#sweep(Math.floor(nowMs / 1000));
    }
  }

  async #sweep(nowSeconds: number) {
    for (let table of ['rate_limit_buckets', 'rate_limit_budgets']) {
      try {
        await query(this.#dbAdapter, [
          `DELETE FROM ${table} WHERE expires_at <=`,
          param(nowSeconds),
        ] as Expression);
      } catch {
        // A missed sweep leaves expired rows for the next one. An expired
        // bucket reads as full, which is what a missing row means, and an
        // expired budget names a period no spend asks about again.
      }
    }
  }
}

// The bucket's level at `nowMs`: what it held, plus what it has refilled
// since, up to a full bucket. A clock behind the row's refills nothing.
function bucketLevel(nowMs: number, limit: TokenBucketLimit): Expression {
  let refilled = () => [
    '(rate_limit_buckets.tokens + (CASE WHEN',
    param(nowMs),
    '> rate_limit_buckets.refilled_at THEN',
    param(nowMs),
    '- rate_limit_buckets.refilled_at ELSE 0 END) * CAST(',
    param(limit.refillPerMinute),
    ` AS DOUBLE PRECISION) / ${MS_PER_MINUTE})`,
  ];
  return [
    '(CASE WHEN',
    ...refilled(),
    '>= CAST(',
    param(limit.burst),
    'AS DOUBLE PRECISION) THEN CAST(',
    param(limit.burst),
    'AS DOUBLE PRECISION) ELSE',
    ...refilled(),
    'END)',
  ] as Expression;
}

// Whole seconds until `tokens` more have refilled, at least one.
function refillSeconds(tokens: number, refillPerMinute: number): number {
  return Math.max(1, Math.ceil((tokens * 60) / refillPerMinute));
}

// The UTC period `nowMs` falls in, as epoch seconds.
function budgetPeriod(
  period: BudgetPeriod,
  nowMs: number,
): { periodStart: number; resetsAt: number } {
  let now = new Date(nowMs);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let start: number;
  let end: number;
  switch (period) {
    case 'day': {
      let day = now.getUTCDate();
      start = Date.UTC(year, month, day);
      end = Date.UTC(year, month, day + 1);
      break;
    }
    case 'month':
      start = Date.UTC(year, month, 1);
      end = Date.UTC(year, month + 1, 1);
      break;
    default:
      throw new Error(`unknown budget period ${period satisfies never}`);
  }
  return { periodStart: start / 1000, resetsAt: end / 1000 };
}

function assertTokenBucket(limit: TokenBucketLimit, cost: number) {
  assertWholeCount('token-bucket burst', limit.burst);
  assertWholeCount('token-bucket take', cost);
  if (!Number.isFinite(limit.refillPerMinute) || limit.refillPerMinute <= 0) {
    throw new Error(
      `a token bucket refills at a positive rate, not ${limit.refillPerMinute} per minute`,
    );
  }
}

function assertWholeCount(what: string, value: number) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `a ${what} is a whole number of at least one, not ${value}`,
    );
  }
}
