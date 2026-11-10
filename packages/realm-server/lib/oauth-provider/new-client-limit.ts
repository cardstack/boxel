// The limit on new OAuth clients, which open registration needs because it
// requires no sign-in (ADR 021 §1.4). Dynamic registration and client ID
// metadata document downloads share it, since each makes a new client: every
// registration attempt counts, and every document downloaded for a client ID
// not yet cached. A refused attempt counts too, so the registration checks
// can't be probed for free.
//
// Callers are counted per address and all together, each as a token bucket:
// a full bucket admits `requests` at once, and it refills evenly over
// `windowSeconds`. The address is the one the `clientAddress` middleware works
// out, never the socket's, which in production is the load balancer's.

import {
  counterKey,
  isRateLimitUnavailable,
  parseIP,
  parseRateLimitSpec,
  rateLimitKey,
  type AnonymousRateLimit,
  type RateLimitRefusal,
  type RateLimitStore,
  type TokenBucketLimit,
} from '@cardstack/runtime-common';

export const OAUTH_CLIENT_RATE_LIMIT_VAR = 'BOXEL_OAUTH_CLIENT_RATE_LIMIT';

export interface NewClientLimit {
  perAddress: AnonymousRateLimit;
  overall: AnonymousRateLimit;
}

export const DEFAULT_NEW_CLIENT_LIMIT: NewClientLimit = Object.freeze({
  perAddress: Object.freeze({ requests: 20, windowSeconds: 3600 }),
  overall: Object.freeze({ requests: 500, windowSeconds: 3600 }),
});

// `<perAddress>,<overall>`, each `requests/windowSeconds` as the realm
// server's other limits are written, for example `20/3600,500/3600`.
// Undefined when the text is not two such limits.
export function parseNewClientLimit(spec: string): NewClientLimit | undefined {
  let parts = spec.split(',');
  if (parts.length !== 2) {
    return undefined;
  }
  let [perAddress, overall] = parts.map(parseRateLimitSpec);
  return perAddress && overall ? { perAddress, overall } : undefined;
}

export type NewClientOutcome =
  | { admitted: true }
  // The caller's address couldn't be worked out, so there is nothing to
  // count it against.
  | { admitted: false; reason: 'unknown-address' }
  | { admitted: false; reason: 'limited'; retryAfterSeconds: number }
  // The store couldn't be read: refused rather than let through uncounted.
  | { admitted: false; reason: 'unavailable' };

// Takes one new client from the caller's bucket and from the overall one.
// `address` is the `CLIENT_IP_HEADER` value. An IPv6 caller is counted by
// its /64, which one holder usually has whole. A caller the overall bucket
// refuses gets its own token back, so waiting out everyone else's
// registrations doesn't spend its own allowance.
export async function takeNewClient(
  store: RateLimitStore,
  address: string | undefined,
  limit: NewClientLimit,
): Promise<NewClientOutcome> {
  let parsed = address ? parseIP(address) : undefined;
  if (!parsed) {
    return { admitted: false, reason: 'unknown-address' };
  }
  let addressKey = counterKey(
    'oauth-new-client',
    'address',
    rateLimitKey(parsed),
  );
  let addressBucket = tokenBucket(limit.perAddress);
  let byAddress = await store.take(addressKey, addressBucket);
  if (!byAddress.admitted) {
    return refusal(byAddress);
  }
  let overall = await store.take(
    counterKey('oauth-new-client', 'all'),
    tokenBucket(limit.overall),
  );
  if (!overall.admitted) {
    await store.refund(addressKey, addressBucket);
    return refusal(overall);
  }
  return { admitted: true };
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
