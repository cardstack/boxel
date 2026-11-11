// The limit on new OAuth clients, which open registration needs because it
// requires no sign-in (ADR 021 §1.4). Dynamic registration and client ID
// metadata document downloads share it, since each makes a new client: every
// registration attempt counts, and every document downloaded for a client ID
// not yet cached. A refused attempt counts too, so the registration checks
// can't be probed for free.
//
// Each attempt is counted three times, each as a token bucket: a full bucket
// admits `requests` at once, and it refills evenly over `windowSeconds`.
//
// - Per address: the caller's IPv4 address, or the IPv6 /64 it is in. The
//   address is the one the `clientAddress` middleware works out, never the
//   socket's, which in production is the load balancer's.
// - Per network: the IPv4 /24 or IPv6 /48 the address is in, so a holder of
//   many addresses is still one caller.
// - Overall: a ceiling on how many clients can be stored, sized from storage
//   rather than traffic. Reaching it refuses everyone, so it sits far above
//   what callers make, and Boxel warns well before it is reached.
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

export const OAUTH_CLIENT_RATE_LIMIT_VAR = 'BOXEL_OAUTH_CLIENT_RATE_LIMIT';

export interface NewClientLimit {
  perAddress: AnonymousRateLimit;
  perNetwork: AnonymousRateLimit;
  overall: AnonymousRateLimit;
  // How many of the overall bucket's tokens may be taken before Boxel warns.
  // Below `overall.requests`.
  alertAfter: number;
}

export const DEFAULT_NEW_CLIENT_LIMIT: NewClientLimit = Object.freeze({
  perAddress: Object.freeze({ requests: 20, windowSeconds: 3600 }),
  perNetwork: Object.freeze({ requests: 100, windowSeconds: 3600 }),
  overall: Object.freeze({ requests: 2000, windowSeconds: 3600 }),
  alertAfter: 500,
});

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
export function parseNewClientLimit(spec: string): NewClientLimit | undefined {
  let limit: NewClientLimit = { ...DEFAULT_NEW_CLIENT_LIMIT };
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

export type NewClientOutcome =
  // `busy` when more than `alertAfter` of the overall bucket's tokens are
  // taken, this one included.
  | { admitted: true; busy: boolean }
  // The caller's address couldn't be worked out, so there is nothing to
  // count it against.
  | { admitted: false; reason: 'unknown-address' }
  | { admitted: false; reason: 'limited'; retryAfterSeconds: number }
  // The store couldn't be read: refused rather than let through uncounted.
  | { admitted: false; reason: 'unavailable' };

// Takes one new client from the caller's address, network and overall
// buckets, in that order. `address` is the `CLIENT_IP_HEADER` value.
export async function takeNewClient(
  store: RateLimitStore,
  address: string | undefined,
  limit: NewClientLimit,
): Promise<NewClientOutcome> {
  let parsed = address ? parseIP(address) : undefined;
  if (!parsed) {
    return { admitted: false, reason: 'unknown-address' };
  }
  let byAddress = await store.take(
    counterKey('oauth-new-client', 'address', rateLimitKey(parsed)),
    tokenBucket(limit.perAddress),
  );
  if (!byAddress.admitted) {
    return refusal(byAddress);
  }
  let byNetwork = await store.take(
    counterKey('oauth-new-client', 'network', networkRateLimitKey(parsed)),
    tokenBucket(limit.perNetwork),
  );
  if (!byNetwork.admitted) {
    return refusal(byNetwork);
  }
  let overall = await store.take(
    counterKey('oauth-new-client', 'all'),
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

// Warns while new clients arrive faster than the alert mark, at most once a
// minute per process, so a sustained flood is noticed long before the overall
// bucket refuses anyone. The warning carries the limit's numbers only: no
// address, network or client detail.
export class NewClientAlert {
  #limit: NewClientLimit;
  #now: () => number;
  #warn: (message: string) => void;
  #lastWarnedAt: number | undefined;

  constructor(
    limit: NewClientLimit,
    {
      now = Date.now,
      warn = warnOperators,
    }: { now?: () => number; warn?: (message: string) => void } = {},
  ) {
    this.#limit = limit;
    this.#now = now;
    this.#warn = warn;
  }

  note(outcome: NewClientOutcome): void {
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
    let { overall, alertAfter } = this.#limit;
    this.#warn(
      `more than ${alertAfter} new OAuth clients within ${overall.windowSeconds} seconds; ` +
        `registration is refused for everyone at ${overall.requests}`,
    );
  }
}

function warnOperators(message: string) {
  log.warn(message);
  Sentry.captureMessage(message, 'warning');
}

function refusal(outcome: RateLimitRefusal): NewClientOutcome {
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
