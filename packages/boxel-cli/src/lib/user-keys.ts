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

export interface UserKeyMetadata {
  id: string;
  name: string;
  kind: string;
  state: string;
  // Present when the realm server records grants.
  grants?: UserKeyGrant[];
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
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
// any other key's is the value alone.
export interface EnteredValue {
  value: string;
  subject?: string;
  scopes?: string[];
}

function valueAttributes({ value, subject, scopes }: EnteredValue) {
  return {
    value,
    ...(subject ? { subject } : {}),
    ...(scopes ? { scopes } : {}),
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
    ...entered
  }: { name: string; kind?: string; ticket?: string } & EnteredValue,
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
        },
      },
      meta: { ticket },
    },
  });
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
