// What the secure window's key pages ask of the realm server, all under the
// window's own session (`authorizedRequest`). Each change to a key takes a key
// write ticket the window mints for that change alone, just before making it,
// so a ticket never outlives the one request it is for.
//
// Nothing here takes anything from the page that opened the window: that page
// names what the window is for (a realm, a card, an operation) and the window
// asks the realm server what those are (`windowContext`).

import { authorizedRequest, mintKeyWriteTicket } from './session.js';

// Where a request sends a key, as the realm server describes it.
export interface DestinationDisplay {
  href: string;
  host: string;
  path: string;
  registrableDomain: string;
}

// The realm server's description of what a key page was opened for.
export interface WindowContext {
  realm: { url: string; name: string; directWriter: boolean };
  card?: { name: string; module: string; exportName: string };
  operation?: {
    name: string;
    label: string;
    base: string;
    method?: string;
    destination?: DestinationDisplay;
    slots: { name: string; key: string; bound?: SlotBound | null }[];
  };
}

// What fills one of an operation's slots for the user, as the realm server
// says when asked with `bindings`: the key, and whether the service it is
// sent to rejected it. For a key a workspace shares, the key is named only to
// its owner, and the owner only to the workspace's direct writers.
export interface SlotBound {
  rejected: boolean;
  key: { id: string; name: string } | null;
  share?: {
    label: string;
    suspended: boolean;
    ownedByYou: boolean;
    owner?: string;
  };
}

// One of the user's keys: its metadata, never its value.
export interface UserKey {
  id: string;
  name: string;
  kind: string;
  state: string;
  createdAt: string;
  updatedAt: string;
}

// A realm that one of the user's keys is shared with, along with the key's
// shares there. `name` is null when the user can no longer read the realm, or
// before its name is indexed: the address is then all there is to show.
export interface SharedWorkspace {
  url: string;
  name: string | null;
  shares: { id: string; label: string; state: 'active' | 'suspended' }[];
}

// A key as the key listing gives it, with where it is used: the services its
// approved requests go to, by registrable domain, and the realms it is shared
// into. The answers to adding and replacing a key carry neither.
export interface ListedKey extends UserKey {
  usedWith: string[];
  sharedInto: SharedWorkspace[];
}

// A share of a key into a realm.
export interface KeyShare {
  id: string;
  realm: string;
  label: string;
  owner: string;
  keyId?: string | null;
  state: 'active' | 'suspended';
  suspensionReason: string | null;
}

type Config = ReturnType<typeof import('./session.js').readConfig>;

interface Resource {
  id: string;
  attributes: Record<string, unknown>;
}

function resources<T>(json: { data?: Resource[] }): T[] {
  return (json.data ?? []).map(
    ({ id, attributes }) => ({ id, ...attributes }) as T,
  );
}

function resource<T>(json: { data: Resource }): T {
  return { id: json.data.id, ...json.data.attributes } as T;
}

// What a page asks the realm server about what it was opened for.
export interface WindowContextRequest {
  realm?: string;
  target?:
    | { kind: 'instance'; url: string }
    | { kind: 'type'; module: string; name: string; realm: string };
  operation?: string;
  // Whether to say what is bound to each of the operation's slots.
  bindings?: boolean;
}

// The user's own keys' metadata, by name, with where each is used. No value
// is ever returned.
export async function listKeys(config: Config): Promise<ListedKey[]> {
  return resources<ListedKey>(
    await authorizedRequest(config, '_user-keys', { method: 'GET' }),
  );
}

export async function addKey(
  config: Config,
  { name, value }: { name: string; value: string },
): Promise<UserKey> {
  let { ticket } = await mintKeyWriteTicket(config, { action: 'add' });
  return resource<UserKey>(
    await authorizedRequest(config, '_user-keys', {
      body: {
        data: { type: 'user-key', attributes: { name, kind: 'static', value } },
        meta: { ticket },
      },
    }),
  );
}

export async function replaceKey(
  config: Config,
  { keyId, value }: { keyId: string; value: string },
): Promise<UserKey> {
  let { ticket } = await mintKeyWriteTicket(config, {
    action: 'replace',
    keyId,
  });
  return resource<UserKey>(
    await authorizedRequest(config, `_user-keys/${encodeURIComponent(keyId)}`, {
      method: 'PATCH',
      body: {
        data: { type: 'user-key', id: keyId, attributes: { value } },
        meta: { ticket },
      },
    }),
  );
}

export async function deleteKey(
  config: Config,
  { keyId }: { keyId: string },
): Promise<void> {
  let { ticket } = await mintKeyWriteTicket(config, {
    action: 'delete',
    keyId,
  });
  await authorizedRequest(config, `_user-keys/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
    body: { meta: { ticket } },
  });
}

// The shares holding one of the user's keys: those deleting it suspends.
export async function sharesOfKey(
  config: Config,
  keyId: string,
): Promise<KeyShare[]> {
  return resources<KeyShare>(
    await authorizedRequest(
      config,
      `_key-shares?key=${encodeURIComponent(keyId)}`,
      { method: 'GET' },
    ),
  );
}

// Takes one of the user's own shares out of its realm. Withdrawing one's own
// key needs no ticket.
export async function unshare(config: Config, shareId: string): Promise<void> {
  await authorizedRequest(
    config,
    `_key-shares/${encodeURIComponent(shareId)}`,
    {
      method: 'DELETE',
    },
  );
}

// A realm's shares, for one of its direct writers.
export async function realmShares(
  config: Config,
  realm: string,
): Promise<KeyShare[]> {
  return resources<KeyShare>(
    await authorizedRequest(
      config,
      `_key-shares?realm=${encodeURIComponent(realm)}`,
      { method: 'GET' },
    ),
  );
}

export async function shareKey(
  config: Config,
  { keyId, realm, label }: { keyId: string; realm: string; label: string },
): Promise<KeyShare> {
  let { ticket } = await mintKeyWriteTicket(config, {
    action: 'share',
    keyId,
    realm,
  });
  return resource<KeyShare>(
    await authorizedRequest(config, '_key-shares', {
      body: {
        data: { type: 'key-share', attributes: { realm, keyId, label } },
        meta: { ticket },
      },
    }),
  );
}

export async function swapKey(
  config: Config,
  { keyId, shareId }: { keyId: string; shareId: string },
): Promise<KeyShare> {
  let { ticket } = await mintKeyWriteTicket(config, {
    action: 'swap',
    keyId,
    shareId,
  });
  return resource<KeyShare>(
    await authorizedRequest(
      config,
      `_key-shares/${encodeURIComponent(shareId)}/swap`,
      {
        body: {
          data: { type: 'key-share', attributes: { keyId } },
          meta: { ticket },
        },
      },
    ),
  );
}

// What the window was opened for, as the realm server describes it: the
// realm (its name, and whether the user is one of its direct writers), and
// for a target, the card definition and the operation, with where that
// operation sends a key. `request` is `{ realm?, target?, operation?,
// bindings? }`; with `bindings`, each of the operation's slots says what is
// bound to it.
export async function windowContext(
  config: Config,
  request: WindowContextRequest,
): Promise<WindowContext> {
  let json = await authorizedRequest(config, '_secure-window/context', {
    body: { data: { type: 'secure-window-context', attributes: request } },
  });
  return json.data.attributes as WindowContext;
}

// The realms the user is a direct writer of, by name: where they may share a
// key.
export async function writableRealms(
  config: Config,
): Promise<{ url: string; name: string }[]> {
  let json = await authorizedRequest(config, '_secure-window/realms', {
    method: 'GET',
  });
  return (json.data ?? []).map(
    ({ id, attributes }: { id: string; attributes: { name: string } }) => ({
      url: id,
      name: attributes.name,
    }),
  );
}
