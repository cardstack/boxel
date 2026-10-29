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
// its owner, the share's label only to its owner and the workspace's direct
// writers, and its owner only to those writers while the share is active.
export interface SlotBound {
  rejected: boolean;
  // `kind` is the key's (`static`, `google-service-account`, `oauth-client`
  // or `oauth-connection`).
  key: { id: string; name: string; kind: string } | null;
  share?: {
    label?: string;
    suspended: boolean;
    ownedByYou: boolean;
    owner?: string;
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

// What a Google service account acts as, none of it secret: the service
// account's email, the user it acts as (null for the service account itself)
// and the scopes its tokens ask for. Never its key file.
export interface ServiceAccountDetails {
  email: string;
  subject: string | null;
  scopes: string[];
}

// One of the user's keys: its metadata, never its value. `kind` is `static`
// for a secret pasted in, `google-service-account`, `oauth-client` or
// `oauth-connection`. Only a service account has `serviceAccount`.
export interface UserKey {
  id: string;
  name: string;
  kind: KeyKind | 'oauth-client' | 'oauth-connection';
  state: string;
  createdAt: string;
  updatedAt: string;
  oauth?: OAuthKeyDescription;
  serviceAccount?: ServiceAccountDetails;
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
  grants: KeyGrant[];
  usedWith: string[];
  sharedInto: SharedWorkspace[];
}

// Where one of the user's keys may be sent: one destination its owner
// approved, which the approvals that send there use.
export interface KeyGrant {
  id: string;
  destination: string;
  state: 'active' | 'rejected';
  approvedAt: string;
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

// One of the user's own keys, with where it is used, as the listing gives it.
export async function getKey(
  config: Config,
  keyId: string,
): Promise<ListedKey> {
  return resource<ListedKey>(
    await authorizedRequest(config, `_user-keys/${encodeURIComponent(keyId)}`, {
      method: 'GET',
    }),
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
// With `reconnect`, only the client that connection signs in through.
export async function connectableClients(
  config: Config,
  {
    realm,
    destination,
    reconnect,
  }: { realm?: string; destination?: string; reconnect?: string },
): Promise<ConnectableClient[]> {
  let query = new URLSearchParams();
  if (reconnect) {
    query.set('reconnect', reconnect);
  }
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

// Finishes a sign-in the service sent back, with the `state` and `code` the
// realm server's callback handed this window in its fragment. The realm
// server finishes it only for the user who started it. Answers the
// connection's id, or why it failed.
export async function completeConnect(
  config: Config,
  { state, code }: { state: string; code: string },
): Promise<{ connected?: string; error?: string }> {
  let json = await authorizedRequest(config, '_oauth/connections/complete', {
    body: {
      data: { type: 'oauth-callback', attributes: { state, code } },
    },
  });
  return json.data.attributes;
}

// A request as an approval records it, for a person to read: where it goes,
// what it sends, and where the key goes in it. Templates keep the markers a
// value filled at invocation stands for.
export interface RequestSnapshot {
  destination: string;
  method: string;
  pathTemplate: string;
  headersTemplate: string;
  placement: string;
  placementName: string;
  transform: string | null;
  bodyTemplate: string | null;
}

// One credential slot of an operation in a batch: why it needs approving
// (`new`, never approved or no longer usable; `changed`, its request changed
// since it was approved), the request it would approve and its fingerprint,
// and what it was last approved with.
export interface BatchSlot {
  slot: string;
  key: 'userKey' | 'apiKey';
  status: 'new' | 'changed';
  snapshot: RequestSnapshot;
  fingerprint: string;
  approved?: {
    snapshot: RequestSnapshot;
    keyId: string | null;
    shareId: string | null;
  };
}

export interface BatchOperation {
  name: string;
  label: string;
  method: string;
  path: string;
  instance: string | null;
  status: 'new' | 'changed';
  slots: BatchSlot[];
}

// A key a slot can take, or a share of the user's in the realm, with the
// batch's destinations its grants already cover.
export interface BatchKey {
  id: string;
  name: string;
  kind: string;
  state: string;
  covers: string[];
}
export interface BatchShare {
  id: string;
  label: string;
  keyId: string;
  keyName: string;
  covers: string[];
}

// Every operation on one card definition, in one realm, that needs the user's
// approval, grouped by where it sends, as the realm server reads them now.
export interface ApprovalBatch {
  realm: { url: string; name: string };
  card: { name: string; module: string; exportName: string };
  instance: string | null;
  review: boolean;
  groups: { destination: DestinationDisplay; operations: BatchOperation[] }[];
  keys: BatchKey[];
  shares: BatchShare[];
}

export async function approvalBatch(
  config: Config,
  request: {
    target: NonNullable<WindowContextRequest['target']>;
    review: boolean;
  },
): Promise<ApprovalBatch> {
  let json = await authorizedRequest(config, '_key-bindings/batch', {
    body: { data: { type: 'key-binding-batch', attributes: request } },
  });
  return json.data.attributes as ApprovalBatch;
}

// One operation of a confirmation: what fills each of its slots, with the
// fingerprint of the request the user was shown, and the destination they
// were shown it going to.
export interface OperationApproval {
  codeRef: { module: string; name: string };
  operation: string;
  instance?: string;
  expectedDestination: string;
  slots: Record<
    string,
    { keyId?: string; shareId?: string; expectedFingerprint: string }
  >;
}

// One confirmation: writes any grant a chosen key lacks for where an
// operation sends, then a binding per operation and slot, in one batch. No
// ticket: approving takes the window's own session.
export async function approveOperations(
  config: Config,
  { realm, operations }: { realm: string; operations: OperationApproval[] },
): Promise<void> {
  await authorizedRequest(config, '_key-bindings', {
    body: {
      data: {
        type: 'key-binding-approval',
        attributes: { realm, operations },
      },
    },
  });
}

// One of the user's approvals: an operation in a realm, a slot it fills, and
// the grant it sends under.
export interface KeyBinding {
  id: string;
  realm: string;
  type: { module: string; name: string };
  operation: string;
  instance: string | null;
  slot: string;
  keyId: string | null;
  shareId: string | null;
  grantId: string | null;
  state: 'active' | 'needs-reapproval' | 'suspended';
}

export async function listBindings(config: Config): Promise<KeyBinding[]> {
  return resources<KeyBinding>(
    await authorizedRequest(config, '_key-bindings', { method: 'GET' }),
  );
}

// Removes one of the user's grants, revoking every approval that sends under
// it, in every realm.
export async function removeGrant(
  config: Config,
  grantId: string,
): Promise<void> {
  await authorizedRequest(
    config,
    `_user-key-grants/${encodeURIComponent(grantId)}`,
    { method: 'DELETE' },
  );
}

// The realms the user can read by a permission of their own, by name: where
// they may approve a card's requests.
export async function readableRealms(
  config: Config,
): Promise<{ url: string; name: string }[]> {
  let json = await authorizedRequest(
    config,
    '_secure-window/realms?access=read',
    { method: 'GET' },
  );
  return (json.data ?? []).map(
    ({ id, attributes }: { id: string; attributes: { name: string } }) => ({
      url: id,
      name: attributes.name,
    }),
  );
}

// The card definitions used in a realm that send a key in a request, by name.
export async function realmCardsWithRequests(
  config: Config,
  realm: string,
): Promise<{ module: string; name: string; displayName: string }[]> {
  let json = await authorizedRequest(config, '_secure-window/cards', {
    body: { data: { type: 'secure-window-cards', attributes: { realm } } },
  });
  return (json.data ?? []).map(
    ({
      attributes,
    }: {
      attributes: { module: string; name: string; displayName: string };
    }) => attributes,
  );
}
