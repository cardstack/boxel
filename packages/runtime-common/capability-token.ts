/**
 * A capability: what an operation's `capability` clause hands its caller once
 * its write lands, naming one card and one subject (ADR event-feed §1.7). A
 * caller who isn't signed in presents it to send an `emit` whose `audience`
 * is that subject, and to follow the card's channel with that subject's
 * messages in full. It is the only identity such a caller has, so it is
 * signed by the realm and checked on every use.
 *
 * Signed with a key of its own, derived from the realm-server's seed as the
 * capture-URL token's is: a token signed with the bare seed would verify as a
 * realm-server session, and this one travels in a URL (the feed stream's
 * query), so access logs and pasted links see it. The `scope` claim is a
 * second check for anything that does reach this key.
 */

export const CAPABILITY_SCOPE = 'boxel:capability';

// The request header an operation carries a capability in. The feed stream
// takes it as the `capability` query parameter instead, since a browser's
// EventSource can send no header.
export const CAPABILITY_HEADER = 'X-Boxel-Capability';
export const CAPABILITY_PARAM = 'capability';

export interface CapabilityClaims {
  scope: typeof CAPABILITY_SCOPE;
  realm: string;
  // The card the capability was issued for, without `.json`.
  card: string;
  subject: string;
}

export function capabilitySecret(realmSecretSeed: string): string {
  return `${realmSecretSeed}:${CAPABILITY_SCOPE}`;
}

// The card and subject a token names, when it was signed with this realm's
// capability key, is unexpired, and was issued in this realm; otherwise
// undefined. `verify` is the adapter's, which throws on a bad signature or an
// expired token.
export function readCapability(
  token: string | null | undefined,
  realmURL: string,
  realmSecretSeed: string,
  verify: (token: string, secret: string) => unknown,
): { card: string; subject: string } | undefined {
  if (!token) {
    return undefined;
  }
  let claims: Partial<CapabilityClaims>;
  try {
    claims = verify(
      token,
      capabilitySecret(realmSecretSeed),
    ) as Partial<CapabilityClaims>;
  } catch {
    return undefined;
  }
  if (
    claims.scope !== CAPABILITY_SCOPE ||
    claims.realm !== realmURL ||
    typeof claims.card !== 'string' ||
    typeof claims.subject !== 'string' ||
    claims.subject === ''
  ) {
    return undefined;
  }
  return { card: claims.card, subject: claims.subject };
}
