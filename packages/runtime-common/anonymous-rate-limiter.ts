import { param, query, type DBAdapter, type Expression } from './index.ts';
import type { AnonymousRateLimit } from './anonymous-access.ts';

// One anonymous invocation's charge against its realm's budget.
export interface AnonymousRateCharge {
  realmURL: string;
  // What the caller is counted under (`rateLimitKey`).
  clientIP: string;
  limit: AnonymousRateLimit;
  // How many invocations this is, a whole number of at least one. A batch is
  // one charge for all its entries, so it is admitted or refused whole.
  cost: number;
}

export type AnonymousRateOutcome =
  | {
      admitted: true;
      // The window's count once this charge is included.
      count: number;
    }
  | {
      admitted: false;
      retryAfterSeconds: number;
    };

// Counts anonymous invocations per realm and client address, in fixed windows.
// Realms never share a count: a visitor's calls to one realm cost them nothing
// in another, and a federated search charges each realm it reaches on its own.
export interface AnonymousRateLimiter {
  charge(charge: AnonymousRateCharge): Promise<AnonymousRateOutcome>;
  // Whether the caller has already used up the current window, without
  // counting anything. Asked before an invocation runs, so a caller over the
  // limit is turned away before the realm does the work, and charged only
  // once the invocation has served them.
  remaining(
    probe: Omit<AnonymousRateCharge, 'cost'>,
  ): Promise<AnonymousRateOutcome>;
}

// Kept in the database so every realm-server process, and a restarted one,
// sees the same count. The upsert takes the charge only when it fits: a
// refused invocation leaves the count where it was, so a visitor over the
// limit is let back in as soon as the window turns rather than when they stop
// retrying. The statement is the same on Postgres and SQLite.
export class DBAnonymousRateLimiter implements AnonymousRateLimiter {
  #dbAdapter: DBAdapter;
  #now: () => number;
  #charges = 0;

  // Expired windows are cleared on roughly one charge in this many, which
  // keeps the table to about one live row per active caller and realm without
  // a scheduled job.
  static readonly SWEEP_EVERY = 200;

  constructor(dbAdapter: DBAdapter, opts?: { now?: () => number }) {
    this.#dbAdapter = dbAdapter;
    this.#now = opts?.now ?? Date.now;
  }

  #window(limit: AnonymousRateLimit) {
    let nowSeconds = Math.floor(this.#now() / 1000);
    let windowStart =
      Math.floor(nowSeconds / limit.windowSeconds) * limit.windowSeconds;
    let expiresAt = windowStart + limit.windowSeconds;
    let retryAfterSeconds = Math.max(1, expiresAt - nowSeconds);
    return { nowSeconds, windowStart, expiresAt, retryAfterSeconds };
  }

  async remaining({
    realmURL,
    clientIP,
    limit,
  }: Omit<AnonymousRateCharge, 'cost'>): Promise<AnonymousRateOutcome> {
    let { windowStart, retryAfterSeconds } = this.#window(limit);
    let rows = await query(this.#dbAdapter, [
      `SELECT count FROM anonymous_rate_limits WHERE realm_url =`,
      param(realmURL),
      'AND client_ip =',
      param(clientIP),
      'AND window_start =',
      param(windowStart),
      'AND window_seconds =',
      param(limit.windowSeconds),
    ] as Expression);
    let count = rows.length === 0 ? 0 : Number(rows[0].count);
    return count < limit.requests
      ? { admitted: true, count }
      : { admitted: false, retryAfterSeconds };
  }

  async charge({
    realmURL,
    clientIP,
    limit,
    cost,
  }: AnonymousRateCharge): Promise<AnonymousRateOutcome> {
    let { nowSeconds, windowStart, expiresAt, retryAfterSeconds } =
      this.#window(limit);

    if (!Number.isInteger(cost) || cost < 1) {
      throw new Error(
        `an anonymous rate-limit charge is a whole number of invocations of at least one, not ${cost}`,
      );
    }
    if (cost > limit.requests) {
      return { admitted: false, retryAfterSeconds };
    }

    // A charge that doesn't fit matches the conflict but not the `WHERE`, so
    // it updates nothing and returns no row.
    let rows = await query(this.#dbAdapter, [
      `INSERT INTO anonymous_rate_limits
         (realm_url, client_ip, window_start, window_seconds, count, expires_at)
       VALUES (`,
      param(realmURL),
      ',',
      param(clientIP),
      ',',
      param(windowStart),
      ',',
      param(limit.windowSeconds),
      ',',
      param(cost),
      ',',
      param(expiresAt),
      `) ON CONFLICT (realm_url, client_ip, window_start, window_seconds)
       DO UPDATE SET count = anonymous_rate_limits.count + EXCLUDED.count
       WHERE anonymous_rate_limits.count + EXCLUDED.count <=`,
      param(limit.requests),
      'RETURNING count',
    ] as Expression);

    if (++this.#charges % DBAnonymousRateLimiter.SWEEP_EVERY === 0) {
      void this.#sweep(nowSeconds);
    }

    // A refusal is one statement, like an admission: a caller flooding the
    // realm costs it no more than one who keeps under the limit.
    if (rows.length === 0) {
      return { admitted: false, retryAfterSeconds };
    }
    return { admitted: true, count: Number(rows[0].count) };
  }

  async #sweep(nowSeconds: number) {
    try {
      await query(this.#dbAdapter, [
        'DELETE FROM anonymous_rate_limits WHERE expires_at <=',
        param(nowSeconds),
      ] as Expression);
    } catch {
      // A missed sweep leaves expired rows for the next one; nothing reads
      // them, since every charge names its own window.
    }
  }
}
