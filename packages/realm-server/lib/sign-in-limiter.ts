// Limits failed password sign-ins per account, as the Matrix server limits
// failed logins to the app (`rc_login.failed_attempts`): a leaky bucket that
// only failures fill. A successful sign-in never counts, and an attempt is
// refused only once the account's failures fill the bucket, with how long
// until the next one may be tried.
//
// The Matrix server's own failure limit doesn't cover these sign-ins: the
// password is checked by a user-interactive auth check, and a wrong password
// there is answered as an incomplete auth, which that limit doesn't count.
// So the realm server keeps the count, and its limit is never lower than the
// Matrix server's own failure limit for the app's logins.
//
// Counts are kept per process; with several realm-server processes each allows
// its own share.

export interface SignInLimits {
  // How many failures an account may have in a burst.
  burstCount: number;
  // How fast the bucket drains, in failures per second.
  perSecond: number;
}

// The Matrix server's defaults for `rc_login.failed_attempts`, which apply
// wherever it isn't configured.
export const DEFAULT_SIGN_IN_LIMITS: SignInLimits = {
  burstCount: 3,
  perSecond: 0.17,
};

export type SignInCheck =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

interface Bucket {
  // Failures in the bucket as of `startedAt`.
  count: number;
  startedAt: number;
}

export class SignInLimiter {
  private buckets = new Map<string, Bucket>();
  private limits: SignInLimits;
  private now: () => number;

  constructor(
    limits: SignInLimits = DEFAULT_SIGN_IN_LIMITS,
    opts: { now?: () => number } = {},
  ) {
    this.limits = limits;
    this.now = opts.now ?? Date.now;
  }

  // Whether the account may try a sign-in now, counting nothing.
  check(account: string): SignInCheck {
    let now = this.now();
    this.sweep(now);
    let { count } = this.level(account, now);
    if (count > this.limits.burstCount - 1) {
      // Once the bucket drains below a full burst, one more may be tried.
      return {
        allowed: false,
        retryAfterMs: Math.ceil(
          ((count - this.limits.burstCount + 1) * 1000) / this.limits.perSecond,
        ),
      };
    }
    return { allowed: true };
  }

  // Counts a failed sign-in for the account.
  recordFailure(account: string): void {
    let now = this.now();
    let { count } = this.level(account, now);
    this.buckets.set(account, { count: count + 1, startedAt: now });
  }

  // The account's failures as of `now`, after the bucket has drained.
  private level(account: string, now: number): Bucket {
    let bucket = this.buckets.get(account);
    if (!bucket) {
      return { count: 0, startedAt: now };
    }
    let count =
      bucket.count - ((now - bucket.startedAt) / 1000) * this.limits.perSecond;
    return { count: Math.max(0, count), startedAt: now };
  }

  private sweep(now: number) {
    for (let [account, bucket] of this.buckets) {
      if (
        now - bucket.startedAt >=
        (bucket.count * 1000) / this.limits.perSecond
      ) {
        this.buckets.delete(account);
      }
    }
  }
}
