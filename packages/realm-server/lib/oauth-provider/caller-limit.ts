// A limit on one of the provider's endpoints that need no sign-in (ADR 021
// §1.4). Each request is counted three times, each as a token bucket: a full
// bucket admits `requests` at once, and it refills evenly over
// `windowSeconds`.
//
// - Per address: the caller's IPv4 address, or the IPv6 /64 it is in. The
//   address is the one the `clientAddress` middleware works out, never the
//   socket's, which in production is the load balancer's.
// - Per network: the IPv4 /24 or IPv6 /48 the address is in, so a holder of
//   many addresses is still one caller.
// - Overall: a ceiling over every caller together. Reaching it refuses
//   everyone, so it sits far above what callers make, and Boxel warns well
//   before it is reached (`CallerLimitAlert`).
//
// The buckets are taken in that order, and a refusal at any of them stops
// there with nothing given back. A caller retrying against a full bucket
// further on spends its own allowance, so it can't hold the overall bucket
// empty for free.

import * as Sentry from '@sentry/node';
import {
  counterKey,
  isRateLimitUnavailable,
  logger,
  networkRateLimitKey,
  parseIP,
  parseRateLimitSpec,
  rateLimitKey,
  type AnonymousRateLimit,
  type RateLimitRefusal,
  type RateLimitStore,
  type TokenBucketLimit,
} from '@cardstack/runtime-common';

const log = logger('boxel:oauth-provider');

export interface CallerLimit {
  perAddress: AnonymousRateLimit;
  perNetwork: AnonymousRateLimit;
  overall: AnonymousRateLimit;
  // How many of the overall bucket's tokens may be taken before Boxel warns.
  // Below `overall.requests`.
  alertAfter: number;
}

const BUCKET_PARTS = {
  address: 'perAddress',
  network: 'perNetwork',
  all: 'overall',
} as const;
const WHOLE_NUMBER = /^\d+$/;

// Comma-separated named parts, each optional, with the default for any left
// out: `address`, `network` and `all` as `requests/windowSeconds`, the way the
// realm server's other limits are written, and `alert` as a count, for example
// `address=20/3600,network=100/3600,all=2000/3600,alert=500`. Undefined when a
// part is unknown, repeated or malformed, or `alert` isn't below `all`.
export function parseCallerLimit(
  spec: string,
  defaults: CallerLimit,
): CallerLimit | undefined {
  let limit: CallerLimit = { ...defaults };
  let seen = new Set<string>();
  for (let part of spec.split(',')) {
    let [name, value, ...rest] = part.split('=').map((text) => text.trim());
    if (!name || value === undefined || rest.length > 0 || seen.has(name)) {
      return undefined;
    }
    seen.add(name);
    if (name === 'alert') {
      if (!WHOLE_NUMBER.test(value) || Number(value) < 1) {
        return undefined;
      }
      limit.alertAfter = Number(value);
      continue;
    }
    if (!(name in BUCKET_PARTS)) {
      return undefined;
    }
    let bucket = parseRateLimitSpec(value);
    if (!bucket) {
      return undefined;
    }
    limit[BUCKET_PARTS[name as keyof typeof BUCKET_PARTS]] = bucket;
  }
  return limit.alertAfter < limit.overall.requests ? limit : undefined;
}

// The format `parseCallerLimit` reads, for a configuration error to name.
export function callerLimitFormat(example: CallerLimit): string {
  let bucket = ({ requests, windowSeconds }: AnonymousRateLimit) =>
    `${requests}/${windowSeconds}`;
  return (
    `named parts, each optional: address, network and all as requests/windowSeconds, ` +
    `and alert as a count below all's requests, for example ` +
    `address=${bucket(example.perAddress)},network=${bucket(example.perNetwork)},` +
    `all=${bucket(example.overall)},alert=${example.alertAfter}`
  );
}

export type CallerLimitOutcome =
  // `busy` when more than `alertAfter` of the overall bucket's tokens are
  // taken, this one included.
  | { admitted: true; busy: boolean }
  // The caller's address couldn't be worked out, so there is nothing to
  // count it against.
  | { admitted: false; reason: 'unknown-address' }
  | { admitted: false; reason: 'limited'; retryAfterSeconds: number }
  // The store couldn't be read: refused rather than let through uncounted.
  | { admitted: false; reason: 'unavailable' };

// Takes one from the caller's address, network and overall buckets, in that
// order, each kept under `counter`. `address` is the `CLIENT_IP_HEADER`
// value. With `overall: false` the overall bucket is left alone, for a request
// that shares a caller's allowance but none of the ceiling over everyone.
export async function takeFromCallerLimit(
  store: RateLimitStore,
  counter: string,
  address: string | undefined,
  limit: CallerLimit,
  { overall: takeOverall = true }: { overall?: boolean } = {},
): Promise<CallerLimitOutcome> {
  let parsed = address ? parseIP(address) : undefined;
  if (!parsed) {
    return { admitted: false, reason: 'unknown-address' };
  }
  let byAddress = await store.take(
    counterKey(counter, 'address', rateLimitKey(parsed)),
    tokenBucket(limit.perAddress),
  );
  if (!byAddress.admitted) {
    return refusal(byAddress);
  }
  let byNetwork = await store.take(
    counterKey(counter, 'network', networkRateLimitKey(parsed)),
    tokenBucket(limit.perNetwork),
  );
  if (!byNetwork.admitted) {
    return refusal(byNetwork);
  }
  if (!takeOverall) {
    return { admitted: true, busy: false };
  }
  let overall = await store.take(
    counterKey(counter, 'all'),
    tokenBucket(limit.overall),
  );
  if (!overall.admitted) {
    return refusal(overall);
  }
  return {
    admitted: true,
    busy: limit.overall.requests - overall.remaining > limit.alertAfter,
  };
}

const ALERT_INTERVAL_MS = 60_000;

// Warns while requests arrive faster than the alert mark, at most once a
// minute per process, so a sustained flood is noticed long before the overall
// bucket refuses anyone. `describe` words the warning from the limit's
// numbers only: no address, network or client detail.
export class CallerLimitAlert {
  #limit: CallerLimit;
  #describe: (limit: CallerLimit) => string;
  #now: () => number;
  #warn: (message: string) => void;
  #lastWarnedAt: number | undefined;

  constructor(
    limit: CallerLimit,
    describe: (limit: CallerLimit) => string,
    {
      now = Date.now,
      warn = warnOperators,
    }: { now?: () => number; warn?: (message: string) => void } = {},
  ) {
    this.#limit = limit;
    this.#describe = describe;
    this.#now = now;
    this.#warn = warn;
  }

  note(outcome: CallerLimitOutcome): void {
    if (!outcome.admitted || !outcome.busy) {
      return;
    }
    let now = this.#now();
    if (
      this.#lastWarnedAt !== undefined &&
      now - this.#lastWarnedAt < ALERT_INTERVAL_MS
    ) {
      return;
    }
    this.#lastWarnedAt = now;
    this.#warn(this.#describe(this.#limit));
  }
}

function warnOperators(message: string) {
  log.warn(message);
  Sentry.captureMessage(message, 'warning');
}

function refusal(outcome: RateLimitRefusal): CallerLimitOutcome {
  return isRateLimitUnavailable(outcome)
    ? { admitted: false, reason: 'unavailable' }
    : {
        admitted: false,
        reason: 'limited',
        retryAfterSeconds: outcome.retryAfterSeconds,
      };
}

function tokenBucket({
  requests,
  windowSeconds,
}: AnonymousRateLimit): TokenBucketLimit {
  return { burst: requests, refillPerMinute: (requests * 60) / windowSeconds };
}
