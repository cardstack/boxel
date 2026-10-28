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
    slots: { name: string; key: string }[];
  };
}

// `static`: a key sent as it is. `google-service-account`: a Google service
// account's JSON key file, from which the realm server mints the access tokens
// it sends.
export type KeyKind = 'static' | 'google-service-account';

// What a key is entered as. A service account's value is its JSON key file,
// with the user to act as (optional) and the scopes its tokens ask for.
export type KeyValue =
  | { kind: 'static'; value: string }
  | {
      kind: 'google-service-account';
      value: string;
      subject: string;
      scopes: string[];
    };

// The attributes a key's value is sent as.
function valueAttributes(entered: KeyValue): Record<string, unknown> {
  if (entered.kind === 'static') {
    return { value: entered.value };
  }
  return {
    value: entered.value,
    ...(entered.subject ? { subject: entered.subject } : {}),
    scopes: entered.scopes,
  };
}

// Whom an OAuth client belongs to, as a connection or connect mode names it:
// the platform's own (`platform`), one shared into a realm (`share`), or one
// of the user's own keys (`own`).
export type OAuthClientKind = 'own' | 'share' | 'platform';

// What the key listing says about an OAuth key. A client's settings and
// whether its token endpoint still takes its secret; a connection's client,
// the scopes it was granted, and whether it needs its owner to sign in again
// (`rejected`) or its client needs an administrator (`needs-admin`).
export interface OAuthKeyDescription {
  client?: {
    clientId: string;
    grantType: 'authorization_code' | 'client_credentials';
    authorizeURL: string | null;
    tokenURL: string;
    scopes: string;
    tokenAuth: 'client_secret_post' | 'client_secret_basic';
    apiHosts: string[];
    state: 'active' | 'broken';
  };
  connection?: {
    client: {
      kind: OAuthClientKind;
      label: string | null;
      ref: OAuthClientRef | null;
    };
    scopes: string;
    status: 'active' | 'rejected' | 'needs-admin';
  };
}

// One of the user's keys: its metadata, never its value. `kind` is `static`
// for a secret pasted in, `google-service-account`, `oauth-client` or
// `oauth-connection`.
export interface UserKey {
  id: string;
  name: string;
  kind: KeyKind | 'oauth-client' | 'oauth-connection';
  state: string;
  createdAt: string;
  updatedAt: string;
  oauth?: OAuthKeyDescription;
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
  { name, entered }: { name: string; entered: KeyValue },
): Promise<UserKey> {
  let { ticket } = await mintKeyWriteTicket(config, { action: 'add' });
  return resource<UserKey>(
    await authorizedRequest(config, '_user-keys', {
      body: {
        data: {
          type: 'user-key',
          attributes: { name, kind: entered.kind, ...valueAttributes(entered) },
        },
        meta: { ticket },
      },
    }),
  );
}

// What an OAuth client is added with beside its secret, as the realm server
// takes it. A `client_credentials` client has no authorization URL.
export interface OAuthClientSettings {
  clientId: string;
  grantType: 'authorization_code' | 'client_credentials';
  authorizeUrl?: string;
  tokenUrl: string;
  scopes?: string;
  tokenAuth: 'client_secret_post' | 'client_secret_basic';
  apiHosts?: string[];
}

// Adds an OAuth client the user registered with a service: its secret is the
// key's value, and its settings go beside it.
export async function addOAuthClient(
  config: Config,
  {
    name,
    secret,
    oauth,
  }: { name: string; secret: string; oauth: OAuthClientSettings },
): Promise<UserKey> {
  let { ticket } = await mintKeyWriteTicket(config, { action: 'add' });
  return resource<UserKey>(
    await authorizedRequest(config, '_user-keys', {
      body: {
        data: {
          type: 'user-key',
          attributes: { name, kind: 'oauth-client', value: secret, oauth },
        },
        meta: { ticket },
      },
    }),
  );
}

// One of the user's keys, as the key listing gives it.
export async function showKey(
  config: Config,
  keyId: string,
): Promise<ListedKey> {
  return resource<ListedKey>(
    await authorizedRequest(config, `_user-keys/${encodeURIComponent(keyId)}`, {
      method: 'GET',
    }),
  );
}

// A key is replaced with a value of its own kind.
export async function replaceKey(
  config: Config,
  { keyId, entered }: { keyId: string; entered: KeyValue },
): Promise<UserKey> {
  let { ticket } = await mintKeyWriteTicket(config, {
    action: 'replace',
    keyId,
  });
  return resource<UserKey>(
    await authorizedRequest(config, `_user-keys/${encodeURIComponent(keyId)}`, {
      method: 'PATCH',
      body: {
        data: {
          type: 'user-key',
          id: keyId,
          attributes: valueAttributes(entered),
        },
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
// operation sends a key. `request` is `{ realm?, target?, operation? }`.
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

// How connect mode names a client back to the realm server.
export type OAuthClientRef =
  | { kind: 'own'; keyId: string }
  | { kind: 'share'; shareId: string }
  | { kind: 'platform'; clientId: string };

// A client the user may connect an account through: whose it is, its label,
// the host its sign-in page is on, and the permissions (scopes, space
// separated) it asks for. Never its secret or its owner.
export interface ConnectableClient {
  ref: OAuthClientRef;
  kind: OAuthClientKind;
  label: string;
  clientId: string;
  scopes: string;
  apiHosts: string[];
  authorizeHost: string;
}

// The clients the user may connect through: the platform's, those shared into
// `realm` and their own, only those serving `destination` when it is given.
export async function connectableClients(
  config: Config,
  { realm, destination }: { realm?: string; destination?: string },
): Promise<ConnectableClient[]> {
  let query = new URLSearchParams();
  if (realm) {
    query.set('realm', realm);
  }
  if (destination) {
    query.set('destination', destination);
  }
  let search = query.size > 0 ? `?${query}` : '';
  let json = await authorizedRequest(config, `_oauth/clients${search}`, {
    method: 'GET',
  });
  return (json.data ?? []).map(
    ({ attributes }: { attributes: ConnectableClient }) => attributes,
  );
}

// Starts signing in to a service through `client`: a new connection under
// `name`, with a ticket to add a key, or `reconnect`, an existing connection
// signed in again, with a ticket to replace that key. Answers with the
// service's authorization page to send the window to.
export async function startConnect(
  config: Config,
  request:
    | { client: OAuthClientRef; name: string }
    | { client: OAuthClientRef; reconnect: string },
): Promise<{ authorizeUrl: string; expiresAt: string }> {
  let { ticket } = await mintKeyWriteTicket(
    config,
    'reconnect' in request
      ? { action: 'replace', keyId: request.reconnect }
      : { action: 'add' },
  );
  let json = await authorizedRequest(config, '_oauth/connections', {
    body: {
      data: { type: 'oauth-connect', attributes: request },
      meta: { ticket },
    },
  });
  return json.data.attributes;
}
