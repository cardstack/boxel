import { createHash } from 'crypto';

import type { AffinityArgs } from '@cardstack/runtime-common';

// Whose sessions a render's auth carries. A realm rendering cards under
// realm authority holds sessions with the `realmAuthority` claim, all minted
// for one user; a render a user asks for holds that user's ordinary sessions;
// an anonymous render holds none. Anything else, including auth that cannot
// be read, is `unreadable`. An automation run holds one run token, for its
// automation's realm, minted for the run's identity (ADR 026 §1.2). A command
// or capture an OAuth app starts holds tab tokens, all minted for one user and
// one grant (`oauth-tab-token.ts`), and nothing else.
export type RenderSession =
  | { kind: 'realm-authority'; user: string }
  | { kind: 'run'; user: string }
  | { kind: 'oauth-tab'; user: string; grant: string }
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
  let grants = new Set<string>();
  let authorities = 0;
  let runs = 0;
  let tabTokens = 0;
  for (let token of values) {
    if (typeof token !== 'string') {
      return { kind: 'unreadable' };
    }
    let claims: {
      user?: unknown;
      realmAuthority?: unknown;
      run?: unknown;
      oauthTab?: { grant?: unknown } | null;
    } | null;
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
    if (claims.run !== undefined) {
      runs++;
    }
    if (claims.oauthTab !== undefined) {
      if (typeof claims.oauthTab?.grant !== 'string') {
        return { kind: 'unreadable' };
      }
      grants.add(claims.oauthTab.grant);
      tabTokens++;
    }
  }
  if (users.size !== 1) {
    return { kind: 'unreadable' };
  }
  let [user] = users;
  // A run's tab holds its run token and nothing else, so its sessions never
  // mix with another kind's in one affinity.
  if (runs > 0) {
    return runs === 1 &&
      values.length === 1 &&
      authorities === 0 &&
      tabTokens === 0
      ? { kind: 'run', user }
      : { kind: 'unreadable' };
  }
  // An OAuth app's tab holds its tab tokens and nothing else, all for one
  // grant, so they never mix with the user's sessions in one affinity.
  if (tabTokens > 0) {
    return tabTokens === values.length && authorities === 0 && grants.size === 1
      ? { kind: 'oauth-tab', user, grant: [...grants][0] }
      : { kind: 'unreadable' };
  }
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
// user. An automation run's tab is keyed `realm:<url>#run:<user>`: the
// automation's realm and the run's identity, so its context serves runs of
// one realm and one identity (ADR 025 §1.2), and never an interactive or index
// render, whose sessions are of another kind.
//
// Callers that build a key for a render pass its `auth`. Without it the key
// is the bare `realm:<url>` key the prerender manager routes by, which no
// render runs on and which `isAffinityOfRealm` matches every session of.
//
// An OAuth app's tab holds tab tokens for one user and grant, and is keyed
// `<key>#oauth:<user>:<grant>` on a realm affinity, and `user:<id>#oauth:<grant>`
// on a user affinity (a command's), so its context never serves a render or
// command that holds the user's own sessions, or another grant's tokens.
export function toAffinityKey({
  affinityType,
  affinityValue,
  auth,
}: AffinityArgs & { auth?: string }): string {
  let key = `${affinityType}:${affinityValue}`;
  if (auth === undefined) {
    return key;
  }
  if (affinityType !== 'realm') {
    let session = renderSessionOf(auth);
    return session.kind === 'oauth-tab'
      ? `${key}${SESSION_SEPARATOR}${OAUTH_TAB_SESSION_PREFIX}${session.grant}`
      : key;
  }
  let session = renderSessionOf(auth);
  switch (session.kind) {
    case 'realm-authority':
      return `${key}${SESSION_SEPARATOR}${AUTHORITY_SESSION_PREFIX}${session.user}`;
    case 'run':
      return `${key}${SESSION_SEPARATOR}${RUN_SESSION_PREFIX}${session.user}`;
    case 'oauth-tab':
      return `${key}${SESSION_SEPARATOR}${OAUTH_TAB_SESSION_PREFIX}${session.user}:${session.grant}`;
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
// names contain `#`, so the first `#` in a realm or user key starts its
// session. An OAuth grant id is base64url, with no `#` either.
const SESSION_SEPARATOR = '#';
const AUTHORITY_SESSION_PREFIX = 'authority:';
const RUN_SESSION_PREFIX = 'run:';
const OAUTH_TAB_SESSION_PREFIX = 'oauth:';

// Whether an affinity key is an automation run's. The pool holds a run
// affinity to one tab, and its runs take turns on it: a run can hold its tab
// for up to `MAX_RUN_SECONDS`, so runs of one realm and identity never take
// more than one of the tabs index renders also draw on. A run's token reaches
// its tab in the page's memory, never in the BrowserContext's storage, so the
// tabs of a context share no run's token.
export function isRunAffinityKey(affinityKey: string): boolean {
  return (
    fromAffinityKey(affinityKey)?.session?.startsWith(RUN_SESSION_PREFIX) ===
    true
  );
}

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
  let sessionStart = affinityValue.indexOf(SESSION_SEPARATOR);
  if (sessionStart >= 0) {
    return {
      affinityType,
      affinityValue: affinityValue.slice(0, sessionStart),
      session: affinityValue.slice(sessionStart + 1),
    };
  }
  return { affinityType, affinityValue };
}

// The realm or user affinity a session affinity belongs to: its key without
// the session. Every other key is returned as it is. The prerender manager
// routes by realm or user, so this is the key a render server reports to it,
// and the key a render's realm-wide settings (profiling targets) are matched
// against.
export function realmAffinityKeyOf(affinityKey: string): string {
  if (!affinityKey.startsWith('realm:') && !affinityKey.startsWith('user:')) {
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
