// The provider's events that operators chart and alert on, each one JSON line
// on the `boxel:oauth-provider` channel. A line carries the event's fields
// and `message`, the plain sentence an operator reads, so a search for the
// sentence still finds it. The other lines on the channel stay plain text.
//
// An event names a user, a grant and a network only by pseudonym: enough to
// tell one from another in a count, never the value. A user or grant is
// named by a hash of its row ID (`pseudonym`), which is random, so an
// operator finds the row in SQL, for example
// `WHERE left(encode(sha256(id::text::bytea), 'hex'), 16) = '<user>'` on
// `users`, or the same on `oauth_provider_grants`, and nobody can work
// back from the hash. A network is named by a keyed hash
// (`networkPseudonym`): there are few enough networks to hash every one,
// so a plain hash would name it. A token, code, confirmation code, ticket
// or interaction ID never reaches an event.

// This module imports nothing else of the provider's: it is imported by
// modules early in the provider's import graph (`caller-limit.ts`), and an
// import back into that graph would leave their classes uninitialized.

import { createHash, createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  CLIENT_IP_HEADER,
  logger,
  networkRateLimitKey,
  parseIP,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type {
  OAuthCaller,
  OAuthCallerRefusal,
} from '@cardstack/runtime-common/oauth-route-admission';

export const OAUTH_PROVIDER_CHANNEL = 'boxel:oauth-provider';

const log = logger(OAUTH_PROVIDER_CHANNEL);

// 16 hex characters standing for a user, a grant or a network.
export type Pseudonym = string;

export type OAuthProviderEvent =
  // A flow refused before consent (`authorization.ts`), by Boxel's checks
  // or the library's.
  | {
      event: 'authorization-refused';
      reason: string;
      error: string;
      client: string;
      network?: Pseudonym;
    }
  | {
      event: 'consent';
      outcome: 'allowed' | 'denied';
      client: string;
      user?: Pseudonym;
      network?: Pseudonym;
      renew: boolean;
    }
  // A code exchange (`issued`) or refresh that succeeded. A code exchange by
  // a pre-registered app on the user's computer adds how its network compares
  // with the one whose browser finished the flow: `other` is the exchange
  // coming from another network than the one that consented.
  | {
      event: 'token-issued' | 'token-refreshed';
      client: string;
      grant?: Pseudonym;
      networkMatch?: 'same' | 'other' | 'other-family' | 'unknown';
    }
  // The token endpoint refused an exchange or refresh.
  | {
      event: 'token-refused';
      error: string;
      client: string;
      network?: Pseudonym;
    }
  // A spent code, or a used refresh token outside its grace, came back: its
  // grant is ended (`reuse`).
  | {
      event: 'reuse';
      what: 'authorization code' | 'refresh token';
      grant: Pseudonym;
      network?: Pseudonym;
    }
  | {
      event: 'grant-ended';
      reason: string;
      client: string;
      grant: Pseudonym;
      user: Pseudonym;
    }
  // A session revocation or password change ended a user's grants.
  | {
      event: 'grants-ended';
      reason: 'sessions-revoked';
      count: number;
      user: Pseudonym;
    }
  // A resource refused a call: the lookup's reasons (`unknown`, `expired`,
  // `revoked`, `wrong-resource`), or a token it accepted on a route no scope
  // maps (`route-not-mapped`) or without the scope the route needs
  // (`insufficient-scope`). `resource` is a resource ID, or `Boxel API` for
  // the realm server's own routes.
  | {
      event: 'resource-refused';
      reason: string;
      resource: string;
      client?: string;
      grant?: Pseudonym;
      user?: Pseudonym;
    }
  // Traffic past a limit's `alert` mark (`caller-limit.ts`).
  | { event: 'rate-limit-alert' };

// The first 16 hex characters of a random row ID's SHA-256.
export function pseudonym(value: string): Pseudonym {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

let networkKey: Buffer | undefined;

// Keys network pseudonyms with a key derived from the realm server's secret
// seed, so every replica names a network alike and only the server can.
// The provider sets it when it starts (`startOAuthProvider`).
export function setNetworkPseudonymKey(realmSecretSeed: string): void {
  networkKey = createHmac('sha256', realmSecretSeed)
    .update('boxel:oauth-provider network pseudonym')
    .digest();
}

// The pseudonym of a network, as the IPv4 /24 or IPv6 /48 the rate limits
// group a caller by. Undefined before the key is set.
export function networkPseudonym(network: string): Pseudonym | undefined {
  return networkKey
    ? createHmac('sha256', networkKey)
        .update(network, 'utf8')
        .digest('hex')
        .slice(0, 16)
    : undefined;
}

// The pseudonym of the network a request came from, or undefined when its
// address can't be read.
export function networkOf(ctxt: {
  req: IncomingMessage;
}): Pseudonym | undefined {
  let address = ctxt.req.headers[CLIENT_IP_HEADER];
  let parsed = typeof address === 'string' ? parseIP(address) : undefined;
  return parsed ? networkPseudonym(networkRateLimitKey(parsed)) : undefined;
}

// The pseudonym of a user named by Matrix ID, from their `users.id`.
// Undefined when there is no such row, or it can't be read: an event never
// holds up the request it records.
export async function userPseudonym(
  dbAdapter: DBAdapter,
  matrixUserId: string,
): Promise<Pseudonym | undefined> {
  try {
    let [row] = (await dbAdapter.execute(
      `SELECT id FROM users WHERE matrix_user_id = $1`,
      { bind: [matrixUserId] },
    )) as { id: string }[];
    return row ? pseudonym(row.id) : undefined;
  } catch {
    return undefined;
  }
}

// A verified caller refused at a route: the event names its client (as
// `clientIdForLogs` names it), grant and user, and `message` is the line's
// own sentence.
export function logCallerRefused(
  caller: OAuthCaller,
  client: string,
  reason: OAuthCallerRefusal,
  resource: string,
  message: string,
): void {
  logOAuthEvent(
    'info',
    {
      event: 'resource-refused',
      reason,
      resource,
      client,
      grant: pseudonym(caller.grantId),
      user: pseudonym(caller.userId),
    },
    message,
  );
}

// Nothing but the JSON goes on the line, so Loki's `json` stage reads it.
export function logOAuthEvent(
  level: 'info' | 'warn',
  event: OAuthProviderEvent,
  message: string,
): void {
  log[level](
    JSON.stringify({ channel: OAUTH_PROVIDER_CHANNEL, ...event, message }),
  );
}
