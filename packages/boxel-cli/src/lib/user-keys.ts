import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import { realmServerRequest } from './secure-session.ts';

// The realm server's API for the signed-in user's own keys (`/_user-keys`)
// and the shares that put them into realms (`/_key-shares`). Reading takes
// any session of the user. Adding, replacing, deleting, sharing and swapping
// each take a key write ticket minted for exactly that change, and only a
// session signed in on the secure origin can mint one. No route answers with
// a key's value.

export type KeyWriteAction = 'add' | 'replace' | 'delete' | 'share' | 'swap';

// Where a key may be sent: one destination its owner approved.
export interface UserKeyGrant {
  id: string;
  destination: string;
  state: string;
  approvedAt: string;
  approvedVia: string;
}

// An OAuth client's settings, as the owner enters them. None is secret: the
// client secret is the key's value.
export interface OAuthClientSettings {
  clientId: string;
  grantType?: 'authorization_code' | 'client_credentials';
  authorizeUrl?: string;
  tokenUrl: string;
  scopes?: string;
  tokenAuth?: 'client_secret_post' | 'client_secret_basic';
  apiHosts?: string[];
}

// How the realm server names a client to connect through.
export type OAuthClientRef =
  | { kind: 'own'; keyId: string }
  | { kind: 'share'; shareId: string }
  | { kind: 'platform'; clientId: string };

// What the key listing says about an OAuth key: for a client, its settings
// and state; for a connection, the client it signs in through, the scopes
// granted, and whether it needs reconnecting or an administrator.
export interface OAuthKeyDescription {
  client?: {
    clientId: string;
    grantType: string;
    authorizeURL: string | null;
    tokenURL: string;
    scopes: string;
    tokenAuth: string;
    apiHosts: string[];
    state: string;
  };
  connection?: {
    client: { kind: string; label: string | null; ref: OAuthClientRef | null };
    scopes: string;
    status: 'active' | 'rejected' | 'needs-admin';
  };
}

// A client the user may connect through: the platform's, one shared into the
// realm asked about, or one of their own.
export interface ConnectableClient {
  ref: OAuthClientRef;
  kind: 'own' | 'share' | 'platform';
  // A share's label, the name of the user's own client key, or a platform
  // client's label for people.
  label: string;
  // A platform client's handle, such as `github`.
  name?: string;
  clientId: string;
  scopes: string;
  apiHosts: string[];
  authorizeHost: string;
}

// What a Google service account acts as: its email, the user it acts as
// (null for the service account itself) and the scopes its tokens ask for.
// Never its key file.
export interface ServiceAccountDetails {
  email: string;
  subject: string | null;
  scopes: string[];
}

export interface UserKeyMetadata {
  id: string;
  name: string;
  kind: string;
  state: string;
  // Present when the realm server records grants.
  grants?: UserKeyGrant[];
  // Present for an OAuth client or connection.
  oauth?: OAuthKeyDescription;
  // Only a google-service-account key has one.
  serviceAccount?: ServiceAccountDetails;
  // The limits in force, defaults filled in.
  limits?: KeyLimits;
  createdAt: string;
  updatedAt: string;
  // Whether its owner lets people who aren't signed in use it, wherever a
  // realm's policy lets them make the call, and the optional caps on their
  // calls a day and a month, all together, in every realm it is shared into.
  anonymous?: boolean;
  anonymousDailyCap?: number | null;
  anonymousMonthlyCap?: number | null;
}

// A key's anonymous caps as a clause that ends a sentence about people who
// aren't signed in: ", up to 100 calls a day and 1000 a month all together",
// or nothing where the key has neither.
export function anonymousCapsClause({
  anonymousDailyCap,
  anonymousMonthlyCap,
}: {
  anonymousDailyCap?: number | null;
  anonymousMonthlyCap?: number | null;
}): string {
  let daily = anonymousDailyCap ?? null;
  let monthly = anonymousMonthlyCap ?? null;
  if (daily === null && monthly === null) {
    return '';
  }
  let caps =
    daily !== null && monthly !== null
      ? `${daily} calls a day and ${monthly} a month`
      : daily !== null
        ? `${daily} calls a day`
        : `${monthly} calls a month`;
  return `, up to ${caps} all together`;
}

export interface KeyShare {
  id: string;
  realm: string;
  label: string;
  // Null in a realm's listing once no permission row in the realm names the
  // owner; the owner's own shares always carry their id.
  owner: string | null;
  // The key the share holds: given only to the share's owner, and null once
  // the key is deleted.
  keyId?: string | null;
  state: 'active' | 'suspended';
  suspensionReason: string | null;
  suspendedBy: string | null;
  suspendedAt: string | null;
  // The limits in force, defaults filled in; listed for the key's owner and
  // the realm's direct writers.
  limits?: KeyLimits;
  createdAt: string;
  updatedAt: string;
  // In a realm's listing: the operations the share is approved for there,
  // each with where it sends, as last approved.
  operations?: KeyShareOperation[];
}

// How much of a key interactive calls may spend: a token bucket per caller
// (`rateBurst` calls at once, refilled at `rateRefillPerMinute`) and the calls
// the share or key serves in a UTC day and month, across every caller.
export interface KeyLimits {
  rateBurst: number;
  rateRefillPerMinute: number;
  dailyBudget: number;
  monthlyBudget: number;
}

// A change to some of a key's limits: a limit left out keeps what it was, and
// null puts it back to the platform's default.
export type KeyLimitChanges = Partial<{
  [limit in keyof KeyLimits]: number | null;
}>;

export interface KeyShareOperation {
  bindingId: string;
  type: { module: string; name: string };
  operation: string;
  instance: string | null;
  slot: string;
  state: string;
  destination?: string;
}

// What a share or a personal key has served, as the realm server records it.
// The counts cover `since` (the start of the UTC month) until now; the
// budgets' `used` is what the limits count, interactive calls charged this
// UTC day and month.
export interface KeyUsage {
  id: string;
  limits: KeyLimits;
  budgets: {
    day: KeyBudgetUse;
    month: KeyBudgetUse;
  };
  since: string;
  calls: number;
  lastUse: {
    at: string;
    caller: string | null;
    operation: string;
    outcome: 'sent' | 'refused' | 'failed';
    // Set when the caller is someone the reader can't see in the realm.
    withheld?: boolean;
  } | null;
  // A null caller is a call with no session; one marked `withheld` is every
  // caller the reader can't see in the realm, counted together.
  topCallers: { caller: string | null; calls: number; withheld?: boolean }[];
  refusals: { code: string; count: number }[];
  vendorOutcomes: { status: number; count: number; outcome?: string }[];
  grants: {
    id: string;
    host: string;
    destination: string;
    state: 'active' | 'rejected';
    rejectedAt: string | null;
    lastForbiddenAt: string | null;
  }[];
  // Whether the reader may change the limits: only the key's owner may.
  canEditLimits: boolean;
}

export interface KeyBudgetUse {
  used: number;
  budget: number;
  resetsAt: string;
}

export interface KeyWriteTarget {
  action: KeyWriteAction;
  keyId?: string;
  realm?: string;
  shareId?: string;
}

type FetchFn = typeof fetch;

function fromResource<T>(resource: {
  id: string;
  attributes: Record<string, unknown>;
}): T {
  return { id: resource.id, ...resource.attributes } as T;
}

// A realm URL as the server stores it: parsed, with no query or fragment and
// exactly one trailing slash on the path.
export function canonicalRealmUrl(realm: string): string {
  let url: URL;
  try {
    url = new URL(realm);
  } catch {
    throw new Error(`${realm} is not a URL`);
  }
  url.search = '';
  url.hash = '';
  url.pathname = ensureTrailingSlash(url.pathname);
  return url.href;
}

// A key write ticket for one change.
export async function mintKeyWriteTicket(
  realmServerUrl: string,
  token: string,
  target: KeyWriteTarget,
  fetchFn: FetchFn = fetch,
): Promise<string> {
  let attributes: Record<string, string> = { action: target.action };
  for (let name of ['keyId', 'realm', 'shareId'] as const) {
    if (target[name]) {
      attributes[name] = target[name]!;
    }
  }
  let json = await realmServerRequest(realmServerUrl, '_key-write-tickets', {
    method: 'POST',
    token,
    fetchFn,
    body: { data: { type: 'key-write-ticket', attributes } },
  });
  return json.data.attributes.ticket;
}

export async function listUserKeys(
  realmServerUrl: string,
  token: string,
  fetchFn: FetchFn = fetch,
): Promise<UserKeyMetadata[]> {
  let json = await realmServerRequest(realmServerUrl, '_user-keys', {
    token,
    fetchFn,
  });
  return json.data.map(fromResource<UserKeyMetadata>);
}

// The user's key with this name. Names are unique among one user's keys.
export async function findUserKey(
  realmServerUrl: string,
  token: string,
  name: string,
  fetchFn: FetchFn = fetch,
): Promise<UserKeyMetadata> {
  let key = (await listUserKeys(realmServerUrl, token, fetchFn)).find(
    (candidate) => candidate.name === name,
  );
  if (!key) {
    throw new Error(`You have no key named ${name}`);
  }
  return key;
}

// A key's value as entered. A Google service account's value is its JSON key
// file, with the user to act as (optional) and the scopes its tokens ask for;
// an OAuth client's is its client secret, with its settings beside it; any
// other key's is the value alone.
export interface EnteredValue {
  value: string;
  subject?: string;
  scopes?: string[];
  oauth?: OAuthClientSettings;
}

function valueAttributes({ value, subject, scopes, oauth }: EnteredValue) {
  return {
    value,
    ...(subject ? { subject } : {}),
    ...(scopes ? { scopes } : {}),
    ...(oauth ? { oauth } : {}),
  };
}

// Adds a key. With no ticket given, mints one for the add with `token`.
export async function addUserKey(
  realmServerUrl: string,
  token: string,
  {
    name,
    kind,
    ticket,
    anonymous,
    anonymousDailyCap,
    anonymousMonthlyCap,
    ...entered
  }: {
    name: string;
    kind?: string;
    ticket?: string;
    anonymous?: boolean;
    anonymousDailyCap?: number;
    anonymousMonthlyCap?: number;
  } & EnteredValue,
  fetchFn: FetchFn = fetch,
): Promise<UserKeyMetadata> {
  ticket ??= await mintKeyWriteTicket(
    realmServerUrl,
    token,
    { action: 'add' },
    fetchFn,
  );
  let json = await realmServerRequest(realmServerUrl, '_user-keys', {
    method: 'POST',
    token,
    fetchFn,
    body: {
      data: {
        type: 'user-key',
        attributes: {
          name,
          ...(kind ? { kind } : {}),
          ...valueAttributes(entered),
          ...(anonymous ? { anonymous: true } : {}),
          ...(anonymousDailyCap !== undefined ? { anonymousDailyCap } : {}),
          ...(anonymousMonthlyCap !== undefined ? { anonymousMonthlyCap } : {}),
        },
      },
      meta: { ticket },
    },
  });
  return fromResource<UserKeyMetadata>(json.data);
}

// Whether a realm's policy lets people who aren't signed in make calls that
// send a shared key, as the realm server tells the secure window. Takes a
// secure session.
export async function realmOpensToAnonymous(
  realmServerUrl: string,
  token: string,
  realm: string,
  fetchFn: FetchFn = fetch,
): Promise<boolean> {
  let json = await realmServerRequest(
    realmServerUrl,
    '_secure-window/context',
    {
      method: 'POST',
      token,
      fetchFn,
      body: {
        data: {
          type: 'secure-window-context',
          attributes: { realm: canonicalRealmUrl(realm) },
        },
      },
    },
  );
  return json?.data?.attributes?.realm?.opensToAnonymous === true;
}

// Sets whether people who aren't signed in may use one of the user's keys,
// and the optional caps on their calls a day and a month. A cap left out is
// kept. Takes a secure session.
export async function setUserKeyAnonymousUse(
  realmServerUrl: string,
  token: string,
  {
    keyId,
    anonymous,
    anonymousDailyCap,
    anonymousMonthlyCap,
  }: {
    keyId: string;
    anonymous: boolean;
    anonymousDailyCap?: number;
    anonymousMonthlyCap?: number;
  },
  fetchFn: FetchFn = fetch,
): Promise<UserKeyMetadata> {
  let json = await realmServerRequest(
    realmServerUrl,
    `_user-keys/${encodeURIComponent(keyId)}/anonymous-use`,
    {
      method: 'PUT',
      token,
      fetchFn,
      body: {
        data: {
          type: 'anonymous-use',
          attributes: {
            anonymous,
            ...(anonymousDailyCap !== undefined ? { anonymousDailyCap } : {}),
            ...(anonymousMonthlyCap !== undefined
              ? { anonymousMonthlyCap }
              : {}),
          },
        },
      },
    },
  );
  return fromResource<UserKeyMetadata>(json.data);
}

export async function replaceUserKey(
  realmServerUrl: string,
  token: string,
  {
    keyId,
    ticket,
    ...entered
  }: { keyId: string; ticket?: string } & EnteredValue,
  fetchFn: FetchFn = fetch,
): Promise<UserKeyMetadata> {
  ticket ??= await mintKeyWriteTicket(
    realmServerUrl,
    token,
    { action: 'replace', keyId },
    fetchFn,
  );
  let json = await realmServerRequest(
    realmServerUrl,
    `_user-keys/${encodeURIComponent(keyId)}`,
    {
      method: 'PATCH',
      token,
      fetchFn,
      body: {
        data: { type: 'user-key', attributes: valueAttributes(entered) },
        meta: { ticket },
      },
    },
  );
  return fromResource<UserKeyMetadata>(json.data);
}

// Deletes a key, which suspends every share holding it.
export async function deleteUserKey(
  realmServerUrl: string,
  token: string,
  { keyId, ticket }: { keyId: string; ticket?: string },
  fetchFn: FetchFn = fetch,
): Promise<void> {
  ticket ??= await mintKeyWriteTicket(
    realmServerUrl,
    token,
    { action: 'delete', keyId },
    fetchFn,
  );
  await realmServerRequest(
    realmServerUrl,
    `_user-keys/${encodeURIComponent(keyId)}`,
    { method: 'DELETE', token, fetchFn, body: { meta: { ticket } } },
  );
}

// The user's own shares, in every realm; with `keyId`, only those holding
// that key.
export async function listOwnShares(
  realmServerUrl: string,
  token: string,
  { keyId }: { keyId?: string } = {},
  fetchFn: FetchFn = fetch,
): Promise<KeyShare[]> {
  let path = keyId
    ? `_key-shares?key=${encodeURIComponent(keyId)}`
    : '_key-shares';
  let json = await realmServerRequest(realmServerUrl, path, {
    token,
    fetchFn,
  });
  return json.data.map(fromResource<KeyShare>);
}

// A realm's shares, which only its direct writers may list.
export async function listRealmShares(
  realmServerUrl: string,
  token: string,
  realm: string,
  fetchFn: FetchFn = fetch,
): Promise<KeyShare[]> {
  let json = await realmServerRequest(
    realmServerUrl,
    `_key-shares?realm=${encodeURIComponent(canonicalRealmUrl(realm))}`,
    { token, fetchFn },
  );
  return json.data.map(fromResource<KeyShare>);
}

function findByLabel(
  shares: KeyShare[],
  realm: string,
  label: string,
): KeyShare {
  let canonical = canonicalRealmUrl(realm);
  let share = shares.find(
    (candidate) => candidate.realm === canonical && candidate.label === label,
  );
  if (!share) {
    throw new Error(`${canonical} has no share labelled ${label} you can see`);
  }
  return share;
}

export async function shareUserKey(
  realmServerUrl: string,
  token: string,
  {
    keyId,
    realm,
    label,
    ticket,
  }: { keyId: string; realm: string; label: string; ticket?: string },
  fetchFn: FetchFn = fetch,
): Promise<KeyShare> {
  let canonical = canonicalRealmUrl(realm);
  ticket ??= await mintKeyWriteTicket(
    realmServerUrl,
    token,
    { action: 'share', keyId, realm: canonical },
    fetchFn,
  );
  let json = await realmServerRequest(realmServerUrl, '_key-shares', {
    method: 'POST',
    token,
    fetchFn,
    body: {
      data: {
        type: 'key-share',
        attributes: { realm: canonical, keyId, label },
      },
      meta: { ticket },
    },
  });
  return fromResource<KeyShare>(json.data);
}

// Takes one of the user's own shares out of a realm. Unsharing needs no
// ticket: it only ever stops a key being used.
export async function unshareUserKey(
  realmServerUrl: string,
  token: string,
  { realm, label }: { realm: string; label: string },
  fetchFn: FetchFn = fetch,
): Promise<KeyShare> {
  let share = findByLabel(
    await listOwnShares(realmServerUrl, token, {}, fetchFn),
    realm,
    label,
  );
  await realmServerRequest(
    realmServerUrl,
    `_key-shares/${encodeURIComponent(share.id)}`,
    { method: 'DELETE', token, fetchFn },
  );
  return share;
}

// Puts one of the user's keys into a realm's suspended share, which then
// resumes with the user as its owner.
export async function swapKeyIntoShare(
  realmServerUrl: string,
  token: string,
  {
    realm,
    label,
    keyId,
    ticket,
  }: { realm: string; label: string; keyId: string; ticket?: string },
  fetchFn: FetchFn = fetch,
): Promise<KeyShare> {
  let share = findByLabel(
    await listRealmShares(realmServerUrl, token, realm, fetchFn),
    realm,
    label,
  );
  ticket ??= await mintKeyWriteTicket(
    realmServerUrl,
    token,
    { action: 'swap', keyId, shareId: share.id },
    fetchFn,
  );
  let json = await realmServerRequest(
    realmServerUrl,
    `_key-shares/${encodeURIComponent(share.id)}/swap`,
    {
      method: 'POST',
      token,
      fetchFn,
      body: {
        data: { type: 'key-share', attributes: { keyId } },
        meta: { ticket },
      },
    },
  );
  return fromResource<KeyShare>(json.data);
}

// The clients the user may connect through: the platform's, their own, and,
// given a realm they can read, those shared into it.
export async function listConnectableClients(
  realmServerUrl: string,
  token: string,
  { realm }: { realm?: string } = {},
  fetchFn: FetchFn = fetch,
): Promise<ConnectableClient[]> {
  let path = realm
    ? `_oauth/clients?realm=${encodeURIComponent(canonicalRealmUrl(realm))}`
    : '_oauth/clients';
  let json = await realmServerRequest(realmServerUrl, path, {
    token,
    fetchFn,
  });
  return json.data.map(
    (resource: { attributes: ConnectableClient }) => resource.attributes,
  );
}

// Starts a sign-in through a client that stores a connection named `name`.
// With no ticket given, mints one for the add with `token`, which must be a
// secure session. `cli` names the loopback listener the secure window's
// `connected` page hands the service's code to once the user has signed in
// at the service. Answers with the service's page to send the user to, and
// when the sign-in lapses.
export async function startOAuthConnect(
  realmServerUrl: string,
  token: string,
  {
    name,
    client,
    cli,
    ticket,
  }: {
    name: string;
    client: OAuthClientRef;
    cli: { port: number; state: string };
    ticket?: string;
  },
  fetchFn: FetchFn = fetch,
): Promise<{ authorizeUrl: string; expiresAt: string }> {
  ticket ??= await mintKeyWriteTicket(
    realmServerUrl,
    token,
    { action: 'add' },
    fetchFn,
  );
  let json = await realmServerRequest(realmServerUrl, '_oauth/connections', {
    method: 'POST',
    token,
    fetchFn,
    body: {
      data: { type: 'oauth-connect', attributes: { name, client, cli } },
      meta: { ticket },
    },
  });
  return json.data.attributes;
}

// How a sign-in ended: the connection made, or why none was. `expired`: no
// such sign-in in progress for this user (unknown, used, or too old).
// `denied`: the user or the service declined. `failed`: the code couldn't be
// exchanged. `name-taken`: a key of the connection's name was added
// meanwhile.
export type OAuthConnectOutcome =
  | { connected: string; reconnected: boolean }
  | { error: string };

// Finishes a sign-in with the code and state the service sent back, under
// the secure session that started it; the realm server finishes it only for
// that user. No token the service issues is in the answer.
export async function completeOAuthConnect(
  realmServerUrl: string,
  token: string,
  { code, state }: { code: string; state: string },
  fetchFn: FetchFn = fetch,
): Promise<OAuthConnectOutcome> {
  let json = await realmServerRequest(
    realmServerUrl,
    '_oauth/connections/complete',
    {
      method: 'POST',
      token,
      fetchFn,
      body: {
        data: { type: 'oauth-callback', attributes: { code, state } },
      },
    },
  );
  return json.data.attributes;
}

// The user's own share labelled `label` in `realm`, or else the realm's share
// of that label, for a direct writer of the realm to read or to be refused
// changing.
export async function findShare(
  realmServerUrl: string,
  token: string,
  { realm, label }: { realm: string; label: string },
  fetchFn: FetchFn = fetch,
): Promise<KeyShare> {
  let canonical = canonicalRealmUrl(realm);
  let own = (await listOwnShares(realmServerUrl, token, {}, fetchFn)).find(
    (share) => share.realm === canonical && share.label === label,
  );
  if (own) {
    return own;
  }
  return findByLabel(
    await listRealmShares(realmServerUrl, token, realm, fetchFn),
    realm,
    label,
  );
}

// Sets some of a share's or a personal key's limits, which only the key's
// owner may, with a session signed in on the secure origin. Answers the
// limits in force afterwards, defaults filled in.
export async function setKeyLimits(
  realmServerUrl: string,
  token: string,
  target: { shareId: string } | { keyId: string },
  changes: KeyLimitChanges,
  fetchFn: FetchFn = fetch,
): Promise<KeyLimits> {
  let path =
    'shareId' in target
      ? `_key-shares/${encodeURIComponent(target.shareId)}/limits`
      : `_user-keys/${encodeURIComponent(target.keyId)}/limits`;
  let json = await realmServerRequest(realmServerUrl, path, {
    method: 'PUT',
    token,
    fetchFn,
    body: { data: { type: 'key-limits', attributes: changes } },
  });
  return json.data.attributes as KeyLimits;
}

// What a share or a personal key has served. A share's usage is for the
// realm's direct writers, a personal key's for its owner; anyone else is
// answered 404, as for no such share or key.
export async function getKeyUsage(
  realmServerUrl: string,
  token: string,
  target: { shareId: string } | { keyId: string },
  fetchFn: FetchFn = fetch,
): Promise<KeyUsage> {
  let path =
    'shareId' in target
      ? `_key-shares/${encodeURIComponent(target.shareId)}/usage`
      : `_user-keys/${encodeURIComponent(target.keyId)}/usage`;
  let json = await realmServerRequest(realmServerUrl, path, {
    token,
    fetchFn,
  });
  return fromResource<KeyUsage>(json.data);
}
