import { createHash } from 'crypto';

import type { AffinityArgs } from '@cardstack/runtime-common';

// Whose sessions a render's auth carries. A realm rendering its own cards
// holds sessions with the `realmAuthority` claim; a render a user asks for
// holds that user's ordinary sessions; an anonymous render holds none.
// Anything else, including auth that cannot be read, is `unreadable`.
export type RenderSession =
  | { kind: 'realm-authority' }
  | { kind: 'user'; user: string }
  | { kind: 'anonymous' }
  | { kind: 'unreadable' };

export function renderSessionOf(auth: string): RenderSession {
  let tokens: Record<string, unknown>;
  try {
    tokens = JSON.parse(auth);
  } catch (_e) {
    return { kind: 'unreadable' };
  }
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) {
    return { kind: 'unreadable' };
  }
  let values = Object.values(tokens);
  if (values.length === 0) {
    return { kind: 'anonymous' };
  }
  let users = new Set<string>();
  let authorities = 0;
  for (let token of values) {
    if (typeof token !== 'string') {
      return { kind: 'unreadable' };
    }
    let claims: { user?: unknown; realmAuthority?: unknown } | null;
    try {
      claims = JSON.parse(
        Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
      );
    } catch (_e) {
      return { kind: 'unreadable' };
    }
    if (!claims || typeof claims !== 'object') {
      return { kind: 'unreadable' };
    }
    if (claims.realmAuthority) {
      authorities++;
    } else if (typeof claims.user === 'string') {
      users.add(claims.user);
    } else {
      return { kind: 'unreadable' };
    }
  }
  if (authorities === values.length) {
    return { kind: 'realm-authority' };
  }
  if (authorities === 0 && users.size === 1) {
    return { kind: 'user', user: [...users][0] };
  }
  return { kind: 'unreadable' };
}

// The tabs of one affinity share a BrowserContext, and with it the
// localStorage each render hands its sessions through, so an affinity must
// never hold two sessions. A realm affinity is therefore split by the
// sessions its render carries: the realm's own renders keep the bare
// `realm:<url>` key, and a render under anyone else's sessions gets a key of
// its own, `realm:<url>|<session>`. Auth that cannot be read gets a key no
// other auth shares. A user affinity already names one user.
//
// Callers that build a key for a render pass its `auth`. Callers that act on
// a realm's own affinity (releasing a batch, which only a realm's own render
// holds) leave it out.
export function toAffinityKey({
  affinityType,
  affinityValue,
  auth,
}: AffinityArgs & { auth?: string }): string {
  let key = `${affinityType}:${affinityValue}`;
  if (auth === undefined || affinityType !== 'realm') {
    return key;
  }
  let session = renderSessionOf(auth);
  switch (session.kind) {
    case 'realm-authority':
      return key;
    case 'user':
      return `${key}${SESSION_SEPARATOR}${session.user}`;
    case 'anonymous':
      return `${key}${SESSION_SEPARATOR}anonymous`;
    case 'unreadable':
      return `${key}${SESSION_SEPARATOR}unreadable-${createHash('sha256')
        .update(auth)
        .digest('hex')
        .slice(0, 16)}`;
  }
}

// A URL carries `|` only percent-encoded, so the first one in a realm key
// starts its session.
const SESSION_SEPARATOR = '|';

export function fromAffinityKey(
  affinityKey: string,
): (AffinityArgs & { session?: string }) | undefined {
  let separator = affinityKey.indexOf(':');
  if (separator <= 0) {
    return;
  }
  let affinityType = affinityKey.slice(0, separator);
  if (affinityType !== 'realm' && affinityType !== 'user') {
    return;
  }
  let affinityValue = affinityKey.slice(separator + 1);
  if (affinityType === 'realm') {
    let sessionStart = affinityValue.indexOf(SESSION_SEPARATOR);
    if (sessionStart >= 0) {
      return {
        affinityType,
        affinityValue: affinityValue.slice(0, sessionStart),
        session: affinityValue.slice(sessionStart + 1),
      };
    }
  }
  return { affinityType, affinityValue };
}

// Whether `affinityKey` is the realm affinity `realmKey` (a bare
// `realm:<url>` key) or one of its sessions' affinities.
export function isAffinityOfRealm(
  affinityKey: string,
  realmKey: string,
): boolean {
  return (
    affinityKey === realmKey ||
    affinityKey.startsWith(`${realmKey}${SESSION_SEPARATOR}`)
  );
}
