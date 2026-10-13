import { createHash } from 'crypto';

import type { AffinityArgs } from '@cardstack/runtime-common';

// Whose sessions a render's auth carries. A realm rendering cards under
// realm authority holds sessions with the `realmAuthority` claim, all minted
// for one user; a render a user asks for holds that user's ordinary sessions;
// an anonymous render holds none. Anything else, including auth that cannot
// be read, is `unreadable`.
export type RenderSession =
  | { kind: 'realm-authority'; user: string }
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
    if (typeof claims.user !== 'string') {
      return { kind: 'unreadable' };
    }
    users.add(claims.user);
    if (claims.realmAuthority) {
      authorities++;
    }
  }
  if (users.size !== 1) {
    return { kind: 'unreadable' };
  }
  let [user] = users;
  if (authorities === values.length) {
    return { kind: 'realm-authority', user };
  }
  if (authorities === 0) {
    return { kind: 'user', user };
  }
  return { kind: 'unreadable' };
}

// A render hands its tab its sessions through localStorage, which belongs
// to the tab's BrowserContext, and an affinity's contexts serve render after
// render: a tab is reused, a released affinity's context is kept for its next
// visit, and a context can hold more than one of the affinity's tabs. So an
// affinity must never hold two sessions. A realm affinity is therefore split
// by the sessions its render carries, `realm:<url>#<session>`: realm-authority
// sessions are keyed by the user they were minted for, ordinary sessions by
// their user, and an anonymous render has a key of its own. Auth that cannot
// be read gets a key no other auth shares. A user affinity already names one
// user.
//
// Callers that build a key for a render pass its `auth`. Without it the key
// is the bare `realm:<url>` key the prerender manager routes by, which no
// render runs on and which `isAffinityOfRealm` matches every session of.
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
      return `${key}${SESSION_SEPARATOR}${AUTHORITY_SESSION_PREFIX}${session.user}`;
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

// A realm URL has no fragment, and neither a user id nor the other session
// names contain `#`, so the first `#` in a realm key starts its session.
const SESSION_SEPARATOR = '#';
const AUTHORITY_SESSION_PREFIX = 'authority:';

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

// The realm affinity a session affinity belongs to: its key without the
// session. Every other key is returned as it is. The prerender manager routes
// by realm, so this is the key a render server reports to it, and the key a
// render's realm-wide settings (profiling targets) are matched against.
export function realmAffinityKeyOf(affinityKey: string): string {
  if (!affinityKey.startsWith('realm:')) {
    return affinityKey;
  }
  let sessionStart = affinityKey.indexOf(SESSION_SEPARATOR);
  return sessionStart >= 0 ? affinityKey.slice(0, sessionStart) : affinityKey;
}

// Whether `affinityKey` is the bare realm key `realmKey` or the affinity of
// one of that realm's sessions.
export function isAffinityOfRealm(
  affinityKey: string,
  realmKey: string,
): boolean {
  return realmAffinityKeyOf(affinityKey) === realmKey;
}

// Whether `affinityKey` renders under realm authority: the renders a realm
// makes of its own cards, which indexing and the HTML it serves come from.
// A key without a session (one built without auth) counts as well.
export function isRealmAuthorityAffinityKey(affinityKey: string): boolean {
  let session = fromAffinityKey(affinityKey)?.session;
  return session === undefined || session.startsWith(AUTHORITY_SESSION_PREFIX);
}
