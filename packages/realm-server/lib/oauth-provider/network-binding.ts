// Whether a code was exchanged from the network whose browser finished its
// flow, for a pre-registered app on the user's computer (ADR 021 §1.7).
//
// Such an app redirects to loopback, so its code reaches only the computer
// whose browser finished the flow, and that computer's app exchanges it. In
// the paste attack, someone else starts the flow as the app, so holds its
// PKCE verifier, and talks the user into pasting back the loopback address
// their browser landed on, code included: the exchange then comes from the
// attacker's network. The finish step records the browser's network, and the
// code exchange compares its own with it.
//
// A network is grouped as the rate limits group a caller
// (`networkRateLimitKey`): the IPv4 /24 or IPv6 /48 the address is in. A
// browser and a command-line app on one computer can still leave by
// different routes, so the outcome tells apart a different network of the
// same address family from one of the other family, which says nothing
// either way.
//
// The outcome is logged with the exchange (`token issued`), never the
// address or network themselves; nothing is refused by it.

import type { IncomingMessage } from 'http';
import { networkRateLimitKey, parseIP } from '@cardstack/runtime-common';

// `same`: the exchange came from the network that finished the flow.
// `other`: from another network of the same address family. `other-family`:
// one is IPv4 and the other IPv6. `unknown`: the finish recorded no network,
// or either address couldn't be read.
export type NetworkMatch = 'same' | 'other' | 'other-family' | 'unknown';

export interface CallerNetwork {
  family: 4 | 6;
  // The `networkRateLimitKey` of the caller's address.
  network: string;
}

// The network of a `CLIENT_IP_HEADER` value, or undefined when there is no
// address to read.
export function callerNetwork(
  address: string | string[] | undefined,
): CallerNetwork | undefined {
  let parsed = typeof address === 'string' ? parseIP(address) : undefined;
  return parsed
    ? { family: parsed.family, network: networkRateLimitKey(parsed) }
    : undefined;
}

export function compareNetworks(
  finished: CallerNetwork | undefined,
  exchanged: CallerNetwork | undefined,
): NetworkMatch {
  if (!finished || !exchanged) {
    return 'unknown';
  }
  if (finished.family !== exchanged.family) {
    return 'other-family';
  }
  return finished.network === exchanged.network ? 'same' : 'other';
}

// The outcome for a code exchange, kept from Boxel's check of the token
// request until the library reports the exchange's success, by the request
// both see.
const outcomes = new WeakMap<IncomingMessage, NetworkMatch>();

export function noteNetworkMatch(
  req: IncomingMessage,
  match: NetworkMatch,
): void {
  outcomes.set(req, match);
}

export function networkMatchOf(
  req: IncomingMessage | undefined,
): NetworkMatch | undefined {
  return req ? outcomes.get(req) : undefined;
}
