// The limit on new OAuth clients, which open registration needs because it
// requires no sign-in (ADR 021 §1.4). Dynamic registration and client ID
// metadata document downloads share it, since each makes a new client: every
// registration attempt counts, and every document downloaded for a client ID
// not yet cached. A refused attempt counts too, so the registration checks
// can't be probed for free.
//
// It is a caller limit (`caller-limit.ts`): per address, per network and
// overall. The overall bucket is a ceiling on how many clients can be stored,
// sized from storage rather than traffic.

import {
  CallerLimitAlert,
  parseCallerLimit,
  takeFromCallerLimit,
  type CallerLimit,
  type CallerLimitOutcome,
} from './caller-limit.ts';
import type { RateLimitStore } from '@cardstack/runtime-common';

export const OAUTH_CLIENT_RATE_LIMIT_VAR = 'BOXEL_OAUTH_CLIENT_RATE_LIMIT';

export type NewClientLimit = CallerLimit;

export const DEFAULT_NEW_CLIENT_LIMIT: NewClientLimit = Object.freeze({
  perAddress: Object.freeze({ requests: 20, windowSeconds: 3600 }),
  perNetwork: Object.freeze({ requests: 100, windowSeconds: 3600 }),
  overall: Object.freeze({ requests: 2000, windowSeconds: 3600 }),
  alertAfter: 500,
});

// `parseCallerLimit`, with this limit's defaults for any part left out.
export function parseNewClientLimit(spec: string): NewClientLimit | undefined {
  return parseCallerLimit(spec, DEFAULT_NEW_CLIENT_LIMIT);
}

export type NewClientOutcome = CallerLimitOutcome;

// Takes one new client from the caller's address, network and overall
// buckets, in that order. `address` is the `CLIENT_IP_HEADER` value.
export function takeNewClient(
  store: RateLimitStore,
  address: string | undefined,
  limit: NewClientLimit,
): Promise<NewClientOutcome> {
  return takeFromCallerLimit(store, 'oauth-new-client', address, limit);
}

export class NewClientAlert extends CallerLimitAlert {
  constructor(
    limit: NewClientLimit,
    options: { now?: () => number; warn?: (message: string) => void } = {},
  ) {
    super(
      limit,
      ({ overall, alertAfter }) =>
        `more than ${alertAfter} new OAuth clients within ${overall.windowSeconds} seconds; ` +
        `registration is refused for everyone at ${overall.requests}`,
      options,
    );
  }
}
