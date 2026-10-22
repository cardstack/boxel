// Limits failed password sign-ins per account, as the Matrix server limits
// failed logins to the app (`rc_login.failed_attempts`): a leaky bucket that
// only failures fill. A successful sign-in never counts, and an attempt is
// refused only once the account's failures fill the bucket, with how long
// until the next one may be tried. The bucket never holds more than a burst,
// so failures that land together can't push the wait past what the Matrix
// server would ask for.
//
// The Matrix server's own failure limit doesn't cover these sign-ins: the
// password is checked by a user-interactive auth check, and a wrong password
// there is answered as an incomplete auth, which that limit doesn't count.
// So the realm server keeps the count, with the Matrix server's default
// failure limit for the app's logins.
//
// Failures are counted as each attempt finishes, so attempts in flight could
// otherwise all be checked before any of them counted. Once an account has
// failures, its attempts in flight count against the burst as if they will
// fail too, so guesses can't be batched past the failure rate. An account
// with no failures may have several sign-ins in flight, up to a cap; no one
// signing in by hand has that many.
//
// Counts are kept per process; with several realm-server processes each allows
// its own share.

export interface SignInLimits {
  // How many failures an account may have in a burst.
  burstCount: number;
  // How fast the bucket drains, in failures per second.
  perSecond: number;
  // How many sign-ins an account may have in flight at once.
  inFlight: number;
}

// The Matrix server's defaults for `rc_login.failed_attempts`, which apply
// wherever it isn't configured.
export const DEFAULT_SIGN_IN_LIMITS: SignInLimits = {
  burstCount: 3,
  perSecond: 0.17,
  inFlight: 10,
};

// `retryAfterMs` is undefined when the wait isn't known, as when an account
// is refused for its sign-ins in flight.
export type SignInCheck =
  | { allowed: true }
  | { allowed: false; retryAfterMs?: number };

interface Bucket {
  // Failures in the bucket as of `startedAt`.
  count: number;
  startedAt: number;
}

export class SignInLimiter {
  private buckets = new Map<string, Bucket>();
  private inFlight = new Map<string, number>();
  private limits: SignInLimits;
  private now: () => number;

  constructor(
    limits: SignInLimits = DEFAULT_SIGN_IN_LIMITS,
    opts: { now?: () => number } = {},
  ) {
    this.limits = limits;
    this.now = opts.now ?? Date.now;
  }

  // Starts a sign-in for the account when its limits allow one. Every allowed
  // start is matched by one `finish`.
  start(account: string): SignInCheck {
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
    let inFlight = this.inFlight.get(account) ?? 0;
    if (
      (count > 0 && count + inFlight > this.limits.burstCount - 1) ||
      inFlight >= this.limits.inFlight
    ) {
      return { allowed: false };
    }
    this.inFlight.set(account, inFlight + 1);
    return { allowed: true };
  }

  // Ends a sign-in `start` allowed, counting it when it failed. A failure
  // that would overfill the bucket isn't counted, as the Matrix server counts
  // only what fits.
  finish(account: string, { failed }: { failed: boolean }): void {
    let inFlight = (this.inFlight.get(account) ?? 1) - 1;
    if (inFlight > 0) {
      this.inFlight.set(account, inFlight);
    } else {
      this.inFlight.delete(account);
    }
    if (!failed) {
      return;
    }
    let now = this.now();
    let { count } = this.level(account, now);
    if (count + 1 <= this.limits.burstCount) {
      this.buckets.set(account, { count: count + 1, startedAt: now });
    }
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
