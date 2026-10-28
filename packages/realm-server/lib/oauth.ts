import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  logger,
  param,
  query,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { Querier } from '@cardstack/runtime-common/expression';
import { destinationCovers } from '@cardstack/runtime-common/card-operations';
import {
  PLATFORM_SECRET_OWNER,
  sealedColumnsSelect,
  sealedFromColumns,
  type SecretBinding,
  type SecretsKeyring,
} from './secrets-at-rest/index.ts';
import {
  isOutboundDevAllowlisted,
  OutboundRefusedError,
  OutboundTimeoutError,
  outboundFetch,
} from './outbound/client.ts';
import { CredentialScrubber } from './outbound/scrubber.ts';
import { normalizeGrantDestination } from './user-key-grants.ts';
import {
  consumeKeyWriteTicket,
  insertUserKeyIn,
  SEALED_COLUMN_VALUES,
  UserKeyError,
  userKeyBinding,
  validateUserKeyName,
  validateUserKeyValue,
  type UserKeyMetadata,
} from './user-keys.ts';

// OAuth clients and connections: two kinds of key.
//
// An **OAuth client** (`oauth-client`) is an app its owner registered with a
// vendor. The key's value is the client secret; `oauth_clients` holds what
// isn't secret: the client id, its grant, its endpoints, the scopes it asks
// for and the API hosts it serves. A client is shared into a realm like any
// key, so a realm's writer registers an app once and each teammate connects
// their own account through it; the client secret is stored once and nobody
// else sees it. Boxel registers clients of its own, the platform clients
// (`platform_oauth_clients`), managed by operators.
//
// An **OAuth connection** (`oauth-connection`) is one person's sign-in
// through a client. It is a personal key like any other: its owner approves
// operations to use it, and its access tokens are sent only under its own
// grants. Its value is the token that mints the rest: the refresh token, or
// for a vendor that issues none, the long-lived access token itself.
//
// **Connecting.** The secure window asks for a sign-in (`startConnect`) with
// its own session and a key write ticket, and is sent to the vendor's
// authorization page. The vendor sends the user back to the realm server
// (`completeConnect`), never to the app page, and the realm server exchanges
// the code for tokens at the client's token endpoint. No token passes through
// a browser. The `state` that ties the two together is stored only as its
// SHA-256, and the PKCE verifier is derived from it with the server's secret,
// so a sign-in in progress stores nothing that could complete it.
//
// **Minting.** Access tokens live only in this process's memory
// (`OAuthTokens`), keyed by the connection (or by the `client_credentials`
// client), and are refreshed ahead of expiry. One refresh runs per key at a
// time in a process, and the refresh holds the key's row locked, so two
// processes never spend a rotating refresh token twice. A refresh that
// rotates the refresh token seals the new one in the same transaction.
//
// **What a refresh error means.** `invalid_grant`: the vendor has revoked the
// connection, which is marked `rejected` until its owner signs in again.
// `invalid_client` (or `unauthorized_client`): the client is broken, marked so
// until its secret is replaced, and every connection through it needs an
// administrator. A 5xx, a timeout, a dropped connection or
// `temporarily_unavailable` is retried with backoff, and is `unavailable`
// once the retries run out.
//
// **Connections follow their client.** A connection names its client; it
// never holds a copy of the client secret. Replacing a client's secret
// reaches every connection at once. A share of a client is followed through
// the share: a key a writer swaps in serves the connections already made, and
// a suspended or deleted share stops them refreshing until it is restored.
//
// **Grants.** What a connection's grant seals is a marker, not a token: a
// refresh token rotates on every refresh, and is only ever sent to a token
// endpoint, never to the grant's destination. Opening the marker under the
// grant's destination is what proves the grant was made by the realm server
// before an access token is attached (`createOrReuseGrantIn`).
//
// **API hosts.** A client may record the API hosts it serves, as
// destinations. They decide only where the secure window's connect mode
// offers it; where a connection's tokens may go is its grants alone.

const log = logger('realm:oauth');

export type OAuthGrantType = 'authorization_code' | 'client_credentials';
export type OAuthTokenAuth = 'client_secret_post' | 'client_secret_basic';
export type OAuthClientState = 'active' | 'broken';
export type OAuthClientKind = 'own' | 'share' | 'platform';

export const CONNECT_REQUEST_TTL_MS = 10 * 60 * 1000;
export const OAUTH_CALLBACK_PATH = '/_oauth/callback';
export const PLATFORM_CLIENT_SECRET_FIELD = 'platform_oauth_clients.secret';

export interface OAuthClientSettings {
  clientId: string;
  grantType: OAuthGrantType;
  authorizeURL: string | null;
  tokenURL: string;
  scopes: string;
  tokenAuth: OAuthTokenAuth;
  apiHosts: string[];
}

// A client a person may connect through, as connect mode offers it. `ref`
// names it back to `startConnect`.
export interface ConnectableClient {
  ref: ClientRef;
  kind: OAuthClientKind;
  label: string;
  clientId: string;
  scopes: string;
  apiHosts: string[];
  authorizeHost: string;
}

export type ClientRef =
  | { kind: 'own'; keyId: string }
  | { kind: 'share'; shareId: string }
  | { kind: 'platform'; clientId: string };

// --- Settings -----------------------------------------------------------

const MAX_SETTING_LENGTH = 2048;

// An endpoint the realm server sends a client's secret to, or the user to:
// `https:`, or `http:` for a host on the outbound guard's development
// allowlist, with no user info or fragment.
function validEndpoint(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length > MAX_SETTING_LENGTH) {
    throw new UserKeyError(400, `a client's ${what} is an absolute URL`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UserKeyError(400, `a client's ${what} is an absolute URL`);
  }
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && isOutboundDevAllowlisted(url.hostname))
  ) {
    throw new UserKeyError(400, `a client's ${what} is an https URL`);
  }
  if (url.username || url.password || url.hash) {
    throw new UserKeyError(
      400,
      `a client's ${what} carries no user info or fragment`,
    );
  }
  return url.href;
}

function validText(value: unknown, what: string, required: boolean): string {
  if (value === undefined || value === null) {
    if (required) {
      throw new UserKeyError(400, `a client needs its ${what}`);
    }
    return '';
  }
  if (typeof value !== 'string' || value.length > MAX_SETTING_LENGTH) {
    throw new UserKeyError(
      400,
      `a client's ${what} is text of at most ${MAX_SETTING_LENGTH} characters`,
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new UserKeyError(
      400,
      `a client's ${what} can't contain control characters`,
    );
  }
  let trimmed = value.trim();
  if (required && trimmed.length === 0) {
    throw new UserKeyError(400, `a client needs its ${what}`);
  }
  return trimmed;
}

// A client's settings, as an owner or an operator writes them. A
// `client_credentials` client has no authorization page; an
// `authorization_code` client needs one.
export function validateOAuthClientSettings(raw: unknown): OAuthClientSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new UserKeyError(
      400,
      'an OAuth client names its client id and endpoints as `oauth`',
    );
  }
  let settings = raw as Record<string, unknown>;
  let allowed = new Set([
    'clientId',
    'grantType',
    'authorizeUrl',
    'tokenUrl',
    'scopes',
    'tokenAuth',
    'apiHosts',
  ]);
  for (let name of Object.keys(settings)) {
    if (!allowed.has(name)) {
      throw new UserKeyError(400, `'oauth.${name}' can't be set`);
    }
  }
  let grantType = settings.grantType ?? 'authorization_code';
  if (
    grantType !== 'authorization_code' &&
    grantType !== 'client_credentials'
  ) {
    throw new UserKeyError(
      400,
      `a client's grant is authorization_code or client_credentials`,
    );
  }
  let tokenAuth = settings.tokenAuth ?? 'client_secret_post';
  if (
    tokenAuth !== 'client_secret_post' &&
    tokenAuth !== 'client_secret_basic'
  ) {
    throw new UserKeyError(
      400,
      `a client authenticates with client_secret_post or client_secret_basic`,
    );
  }
  let authorizeURL: string | null = null;
  if (grantType === 'authorization_code') {
    authorizeURL = validEndpoint(settings.authorizeUrl, 'authorization URL');
  } else if (settings.authorizeUrl != null) {
    throw new UserKeyError(
      400,
      'a client_credentials client has no authorization URL',
    );
  }
  let apiHosts = settings.apiHosts ?? [];
  if (!Array.isArray(apiHosts) || apiHosts.length > 50) {
    throw new UserKeyError(
      400,
      `a client's API hosts are a list of at most 50 destinations`,
    );
  }
  return {
    clientId: validText(settings.clientId, 'client id', true),
    grantType,
    authorizeURL,
    tokenURL: validEndpoint(settings.tokenUrl, 'token URL'),
    scopes: validText(settings.scopes, 'scopes', false),
    tokenAuth,
    apiHosts: [...new Set(apiHosts.map((h) => normalizeGrantDestination(h)))],
  };
}

const CLIENT_COLUMNS = `client_id, grant_type, authorize_url, token_url, scopes, token_auth, api_hosts, state`;

function settingsOf(row: Record<string, unknown>): OAuthClientSettings {
  return {
    clientId: row.client_id as string,
    grantType: row.grant_type as OAuthGrantType,
    authorizeURL: (row.authorize_url as string | null) ?? null,
    tokenURL: row.token_url as string,
    scopes: row.scopes as string,
    tokenAuth: row.token_auth as OAuthTokenAuth,
    apiHosts: (row.api_hosts as string[] | null) ?? [],
  };
}

// --- Clients a person owns --------------------------------------------

// Adds an OAuth client to the owner's keys: its secret as the key's value and
// its settings beside it, with a ticket to `add`, as any key.
export async function addOAuthClient(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  {
    owner,
    name,
    value,
    oauth,
    ticket,
  }: {
    owner: string;
    name: unknown;
    value: unknown;
    oauth: unknown;
    ticket: unknown;
  },
): Promise<UserKeyMetadata> {
  let validName = validateUserKeyName(name);
  let secret = validateUserKeyValue(value);
  let settings = validateOAuthClientSettings(oauth);
  return await dbAdapter.withTransaction(async (txQuery) => {
    await consumeKeyWriteTicket(txQuery, owner, ticket, {
      action: 'add',
      keyId: null,
      realmURL: null,
      shareId: null,
    });
    let key = await insertUserKeyIn(txQuery, keyring, {
      id: randomUUID(),
      owner,
      name: validName,
      kind: 'oauth-client',
      value: secret,
    });
    await txQuery([
      `INSERT INTO oauth_clients (key_id, client_id, grant_type, authorize_url, token_url, scopes, token_auth, api_hosts) VALUES (`,
      param(key.id),
      `, `,
      param(settings.clientId),
      `, `,
      param(settings.grantType),
      `, `,
      param(settings.authorizeURL),
      `, `,
      param(settings.tokenURL),
      `, `,
      param(settings.scopes),
      `, `,
      param(settings.tokenAuth),
      `, ARRAY(SELECT jsonb_array_elements_text(`,
      param(JSON.stringify(settings.apiHosts)),
      `::jsonb)))`,
    ]);
    return key;
  });
}

// What the key listing says about an OAuth key, beside its metadata: for a
// client, its settings and state; for a connection, the client it was made
// through, the scopes granted, and whether it needs reconnecting
// (`rejected`) or an administrator (`needs-admin`).
export interface OAuthKeyDescription {
  client?: OAuthClientSettings & { state: OAuthClientState };
  connection?: {
    client: { kind: OAuthClientKind; label: string | null };
    scopes: string;
    status: 'active' | 'rejected' | 'needs-admin';
  };
}

export async function describeOAuthKeys(
  dbAdapter: DBAdapter,
  owner: string,
  keys: UserKeyMetadata[],
): Promise<Map<string, OAuthKeyDescription>> {
  let described = new Map<string, OAuthKeyDescription>();
  let clientIds = keys
    .filter((k) => k.kind === 'oauth-client')
    .map((k) => k.id);
  let connectionIds = keys
    .filter((k) => k.kind === 'oauth-connection')
    .map((k) => k.id);
  if (clientIds.length > 0) {
    let rows = await query(dbAdapter, [
      `SELECT c.key_id, ${CLIENT_COLUMNS.split(', ')
        .map((c) => `c.${c}`)
        .join(
          ', ',
        )} FROM oauth_clients c JOIN user_keys k ON k.id = c.key_id WHERE k.owner = `,
      param(owner),
    ]);
    for (let row of rows) {
      described.set(row.key_id as string, {
        client: {
          ...settingsOf(row),
          state: row.state as OAuthClientState,
        },
      });
    }
  }
  if (connectionIds.length > 0) {
    let rows = await query(dbAdapter, [
      `SELECT k.id, k.state AS key_state, n.client_kind, n.scopes, ${CLIENT_RESOLUTION_COLUMNS}
         FROM oauth_connections n JOIN user_keys k ON k.id = n.key_id
         ${CLIENT_RESOLUTION_JOINS}
        WHERE k.owner = `,
      param(owner),
    ]);
    for (let row of rows) {
      let client = resolvedClientOf(row);
      described.set(row.id as string, {
        connection: {
          client: {
            kind: row.client_kind as OAuthClientKind,
            label: client.label,
          },
          scopes: row.scopes as string,
          status:
            row.key_state === 'rejected'
              ? 'rejected'
              : client.usable
                ? 'active'
                : 'needs-admin',
        },
      });
    }
  }
  return described;
}

// --- Platform clients ---------------------------------------------------

export function platformClientBinding(
  id: string,
  tokenURL: string,
): SecretBinding {
  return {
    field: PLATFORM_CLIENT_SECRET_FIELD,
    owner: PLATFORM_SECRET_OWNER,
    id,
    destination: tokenURL,
  };
}

export interface PlatformOAuthClient extends OAuthClientSettings {
  id: string;
  name: string;
  label: string;
  state: OAuthClientState;
  createdAt: string;
  updatedAt: string;
}

const PLATFORM_COLUMNS = `id, name, label, ${CLIENT_COLUMNS}, created_at, updated_at`;

function toPlatformClient(row: Record<string, unknown>): PlatformOAuthClient {
  return {
    id: row.id as string,
    name: row.name as string,
    label: row.label as string,
    ...settingsOf(row),
    state: row.state as OAuthClientState,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

const PLATFORM_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export async function listPlatformClients(
  dbAdapter: DBAdapter,
): Promise<PlatformOAuthClient[]> {
  let rows = await query(dbAdapter, [
    `SELECT ${PLATFORM_COLUMNS} FROM platform_oauth_clients ORDER BY name`,
  ]);
  return rows.map(toPlatformClient);
}

// Adds a client Boxel registered with a vendor. Only an authorization-code
// client is a platform client: people connect through it.
export async function addPlatformClient(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  {
    name,
    label,
    secret,
    oauth,
  }: { name: unknown; label: unknown; secret: unknown; oauth: unknown },
): Promise<PlatformOAuthClient> {
  if (typeof name !== 'string' || !PLATFORM_NAME.test(name)) {
    throw new UserKeyError(
      400,
      'a platform client is named by lower-case letters, digits and dashes',
    );
  }
  let validLabel = validText(label, 'label', true);
  let validSecret = validateUserKeyValue(secret);
  let settings = validateOAuthClientSettings(oauth);
  if (settings.grantType !== 'authorization_code') {
    throw new UserKeyError(
      400,
      'a platform client is one people connect through: authorization_code',
    );
  }
  let id = randomUUID();
  let sealed = keyring.seal(
    validSecret,
    platformClientBinding(id, settings.tokenURL),
  );
  let rows = await query(dbAdapter, [
    `INSERT INTO platform_oauth_clients (id, name, label, client_id, grant_type, authorize_url, token_url, scopes, token_auth, api_hosts, secret_ciphertext, secret_nonce, secret_tag, secret_key_id) VALUES (`,
    param(id),
    `, `,
    param(name),
    `, `,
    param(validLabel),
    `, `,
    param(settings.clientId),
    `, 'authorization_code', `,
    param(settings.authorizeURL),
    `, `,
    param(settings.tokenURL),
    `, `,
    param(settings.scopes),
    `, `,
    param(settings.tokenAuth),
    `, ARRAY(SELECT jsonb_array_elements_text(`,
    param(JSON.stringify(settings.apiHosts)),
    `::jsonb)), `,
    ...SEALED_COLUMN_VALUES(sealed),
    `) ON CONFLICT (name) DO NOTHING RETURNING ${PLATFORM_COLUMNS}`,
  ]);
  if (rows.length === 0) {
    throw new UserKeyError(409, `a platform client named ${name} exists`);
  }
  return toPlatformClient(rows[0]);
}

// Replaces a platform client's secret, which also clears a broken state.
export async function replacePlatformClientSecret(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  { name, secret }: { name: string; secret: unknown },
): Promise<PlatformOAuthClient> {
  let validSecret = validateUserKeyValue(secret);
  return await dbAdapter.withTransaction(async (txQuery) => {
    let [row] = await txQuery([
      `SELECT id, token_url FROM platform_oauth_clients WHERE name = `,
      param(name),
      ` FOR UPDATE`,
    ]);
    if (!row) {
      throw new UserKeyError(404, 'no such platform client');
    }
    let sealed = keyring.seal(
      validSecret,
      platformClientBinding(row.id as string, row.token_url as string),
    );
    let [updated] = await txQuery([
      `UPDATE platform_oauth_clients SET (secret_ciphertext, secret_nonce, secret_tag, secret_key_id, state, broken_at, updated_at) = (`,
      ...SEALED_COLUMN_VALUES(sealed),
      `, 'active', NULL, NOW()) WHERE id = `,
      param(row.id as string),
      ` RETURNING ${PLATFORM_COLUMNS}`,
    ]);
    return toPlatformClient(updated);
  });
}

// Deletes a platform client. Its connections stay, needing an administrator,
// and a client added again under the same name doesn't take them back.
export async function deletePlatformClient(
  dbAdapter: DBAdapter,
  name: string,
): Promise<void> {
  let rows = await query(dbAdapter, [
    `DELETE FROM platform_oauth_clients WHERE name = `,
    param(name),
    ` RETURNING id`,
  ]);
  if (rows.length === 0) {
    throw new UserKeyError(404, 'no such platform client');
  }
}

// --- Which clients connect mode offers --------------------------------

// The clients a person may connect through: the platform's, the
// authorization-code clients shared into `realmURL` (whose shares are
// active), and their own. With a destination, only clients that name an API
// host covering it, so connect mode offers what serves the operation. A
// client's secret and its owner are never part of the answer.
export async function listConnectableClients(
  dbAdapter: DBAdapter,
  {
    owner,
    realmURL,
    destination,
  }: { owner: string; realmURL?: string; destination?: string },
): Promise<ConnectableClient[]> {
  let serves = (apiHosts: string[]) =>
    destination === undefined ||
    apiHosts.some((host) => destinationCovers(host, destination));
  let offered: ConnectableClient[] = [];
  let describe = (
    row: Record<string, unknown>,
    ref: ClientRef,
    kind: OAuthClientKind,
    label: string,
  ): ConnectableClient => ({
    ref,
    kind,
    label,
    clientId: row.client_id as string,
    scopes: row.scopes as string,
    apiHosts: (row.api_hosts as string[]) ?? [],
    authorizeHost: new URL(row.authorize_url as string).host,
  });
  for (let row of await query(dbAdapter, [
    `SELECT id, label, ${CLIENT_COLUMNS} FROM platform_oauth_clients WHERE state = 'active' ORDER BY label`,
  ])) {
    if (serves(row.api_hosts as string[])) {
      offered.push(
        describe(
          row,
          { kind: 'platform', clientId: row.id as string },
          'platform',
          row.label as string,
        ),
      );
    }
  }
  if (realmURL) {
    for (let row of await query(dbAdapter, [
      `SELECT s.id AS share_id, s.label, ${CLIENT_COLUMNS.split(', ')
        .map((c) => `c.${c}`)
        .join(', ')}
         FROM key_shares s JOIN oauth_clients c ON c.key_id = s.key_id
        WHERE s.realm_url = `,
      param(realmURL),
      ` AND s.state = 'active' AND c.state = 'active' AND c.grant_type = 'authorization_code' ORDER BY s.label`,
    ])) {
      if (serves(row.api_hosts as string[])) {
        offered.push(
          describe(
            row,
            { kind: 'share', shareId: row.share_id as string },
            'share',
            row.label as string,
          ),
        );
      }
    }
  }
  for (let row of await query(dbAdapter, [
    `SELECT k.id, k.name, ${CLIENT_COLUMNS.split(', ')
      .map((c) => `c.${c}`)
      .join(', ')}
       FROM oauth_clients c JOIN user_keys k ON k.id = c.key_id
      WHERE k.owner = `,
    param(owner),
    ` AND c.state = 'active' AND c.grant_type = 'authorization_code' ORDER BY k.name`,
  ])) {
    if (serves(row.api_hosts as string[])) {
      offered.push(
        describe(
          row,
          { kind: 'own', keyId: row.id as string },
          'own',
          row.name as string,
        ),
      );
    }
  }
  return offered;
}

export function validateClientRef(raw: unknown): ClientRef {
  let uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let ref = raw as Record<string, unknown> | null;
  let id = (value: unknown) => {
    if (typeof value !== 'string' || !uuid.test(value)) {
      throw new UserKeyError(404, 'no such client');
    }
    return value;
  };
  if (ref && typeof ref === 'object') {
    if (ref.kind === 'own') {
      return { kind: 'own', keyId: id(ref.keyId) };
    }
    if (ref.kind === 'share') {
      return { kind: 'share', shareId: id(ref.shareId) };
    }
    if (ref.kind === 'platform') {
      return { kind: 'platform', clientId: id(ref.clientId) };
    }
  }
  throw new UserKeyError(
    400,
    `a client is named as {kind: 'own', keyId}, {kind: 'share', shareId} or {kind: 'platform', clientId}`,
  );
}

// --- Resolving the client a connection mints through ------------------

// The columns and joins that resolve a connection's client however it is
// named. A share is followed to the key it holds now, so a key a writer
// swaps into it serves the connections made through it.
const CLIENT_RESOLUTION_COLUMNS = `
  n.client_key_id, n.client_share_id, n.platform_client_id,
  s.state AS share_state, s.label AS share_label,
  own.key_id AS own_key_id, own.state AS own_state, own.grant_type AS own_grant_type,
  own.client_id AS own_client_id, own.token_url AS own_token_url, own.token_auth AS own_token_auth, own.authorize_url AS own_authorize_url,
  ok.owner AS own_owner, ok.name AS own_name,
  shared.key_id AS shared_key_id, shared.state AS shared_state, shared.grant_type AS shared_grant_type,
  shared.client_id AS shared_client_id, shared.token_url AS shared_token_url, shared.token_auth AS shared_token_auth, shared.authorize_url AS shared_authorize_url,
  sk.owner AS shared_owner,
  p.id AS platform_id, p.label AS platform_label, p.state AS platform_state,
  p.client_id AS platform_client, p.token_url AS platform_token_url, p.token_auth AS platform_token_auth, p.authorize_url AS platform_authorize_url`;

const CLIENT_RESOLUTION_JOINS = `
  LEFT JOIN oauth_clients own ON own.key_id = n.client_key_id
  LEFT JOIN user_keys ok ON ok.id = own.key_id
  LEFT JOIN key_shares s ON s.id = n.client_share_id
  LEFT JOIN oauth_clients shared ON shared.key_id = s.key_id
  LEFT JOIN user_keys sk ON sk.id = shared.key_id
  LEFT JOIN platform_oauth_clients p ON p.id = n.platform_client_id`;

interface ResolvedClient {
  usable: boolean;
  label: string | null;
  // Where its secret is and how it opens, when usable.
  secretFrom?:
    | { kind: 'key'; keyId: string; owner: string }
    | { kind: 'platform'; id: string };
  clientId?: string;
  tokenURL?: string;
  authorizeURL?: string | null;
  tokenAuth?: OAuthTokenAuth;
}

function resolvedClientOf(row: Record<string, unknown>): ResolvedClient {
  if (row.client_key_id) {
    return {
      usable: row.own_state === 'active',
      label: (row.own_name as string) ?? null,
      secretFrom: {
        kind: 'key',
        keyId: row.own_key_id as string,
        owner: row.own_owner as string,
      },
      clientId: row.own_client_id as string,
      tokenURL: row.own_token_url as string,
      authorizeURL: row.own_authorize_url as string | null,
      tokenAuth: row.own_token_auth as OAuthTokenAuth,
    };
  }
  if (row.client_share_id) {
    return {
      usable:
        row.share_state === 'active' &&
        row.shared_key_id != null &&
        row.shared_state === 'active' &&
        row.shared_grant_type === 'authorization_code',
      label: (row.share_label as string) ?? null,
      ...(row.shared_key_id
        ? {
            secretFrom: {
              kind: 'key' as const,
              keyId: row.shared_key_id as string,
              owner: row.shared_owner as string,
            },
            clientId: row.shared_client_id as string,
            tokenURL: row.shared_token_url as string,
            authorizeURL: row.shared_authorize_url as string | null,
            tokenAuth: row.shared_token_auth as OAuthTokenAuth,
          }
        : {}),
    };
  }
  if (row.platform_client_id) {
    return {
      usable: row.platform_state === 'active',
      label: (row.platform_label as string) ?? null,
      secretFrom: { kind: 'platform', id: row.platform_id as string },
      clientId: row.platform_client as string,
      tokenURL: row.platform_token_url as string,
      authorizeURL: row.platform_authorize_url as string | null,
      tokenAuth: row.platform_token_auth as OAuthTokenAuth,
    };
  }
  return { usable: false, label: null };
}

// The client a connect request or a connection names, with its secret
// opened, read in the caller's transaction. Throws `needs-admin` when it is
// gone, broken, or behind a share that is suspended.
async function openClientIn(
  txQuery: Querier,
  keyring: SecretsKeyring,
  ref: {
    client_key_id?: unknown;
    client_share_id?: unknown;
    platform_client_id?: unknown;
  },
): Promise<MintingClient> {
  let [row] = await txQuery([
    `SELECT ${CLIENT_RESOLUTION_COLUMNS} FROM (SELECT `,
    param((ref.client_key_id as string | null) ?? null),
    `::uuid AS client_key_id, `,
    param((ref.client_share_id as string | null) ?? null),
    `::uuid AS client_share_id, `,
    param((ref.platform_client_id as string | null) ?? null),
    `::uuid AS platform_client_id) n ${CLIENT_RESOLUTION_JOINS}`,
  ]);
  let resolved = row ? resolvedClientOf(row) : { usable: false, label: null };
  if (!resolved.usable || !resolved.secretFrom) {
    throw new OAuthTokenError('needs-admin', 'the OAuth client is unavailable');
  }
  let secret: string;
  if (resolved.secretFrom.kind === 'key') {
    let [key] = await txQuery([
      `SELECT ${sealedColumnsSelect('value')} FROM user_keys WHERE id = `,
      param(resolved.secretFrom.keyId),
    ]);
    let sealed = key ? sealedFromColumns(key, 'value') : undefined;
    if (!sealed) {
      throw new OAuthTokenError(
        'needs-admin',
        'the OAuth client is unavailable',
      );
    }
    secret = keyring.open(
      sealed,
      userKeyBinding(resolved.secretFrom.owner, resolved.secretFrom.keyId),
    );
  } else {
    let [platform] = await txQuery([
      `SELECT ${sealedColumnsSelect('secret')} FROM platform_oauth_clients WHERE id = `,
      param(resolved.secretFrom.id),
    ]);
    let sealed = platform ? sealedFromColumns(platform, 'secret') : undefined;
    if (!sealed) {
      throw new OAuthTokenError(
        'needs-admin',
        'the OAuth client is unavailable',
      );
    }
    secret = keyring.open(
      sealed,
      platformClientBinding(resolved.secretFrom.id, resolved.tokenURL!),
    );
  }
  return {
    secretFrom: resolved.secretFrom,
    clientId: resolved.clientId!,
    clientSecret: secret,
    tokenURL: resolved.tokenURL!,
    authorizeURL: resolved.authorizeURL ?? null,
    tokenAuth: resolved.tokenAuth!,
  };
}

interface MintingClient {
  secretFrom: NonNullable<ResolvedClient['secretFrom']>;
  clientId: string;
  clientSecret: string;
  tokenURL: string;
  authorizeURL: string | null;
  tokenAuth: OAuthTokenAuth;
}

// Marks a client broken after its token endpoint refused its credentials, so
// every connection through it reads as needing an administrator until its
// secret is replaced.
async function markClientBroken(
  dbAdapter: DBAdapter,
  client: MintingClient,
): Promise<void> {
  if (client.secretFrom.kind === 'key') {
    await query(dbAdapter, [
      `UPDATE oauth_clients SET state = 'broken', broken_at = NOW() WHERE key_id = `,
      param(client.secretFrom.keyId),
      ` AND state = 'active'`,
    ]);
  } else {
    await query(dbAdapter, [
      `UPDATE platform_oauth_clients SET state = 'broken', broken_at = NOW() WHERE id = `,
      param(client.secretFrom.id),
      ` AND state = 'active'`,
    ]);
  }
  log.warn(
    `an OAuth client (${client.secretFrom.kind === 'key' ? `key ${client.secretFrom.keyId}` : `platform ${client.secretFrom.id}`}) was refused by its token endpoint as invalid_client; its connections need an administrator`,
  );
}

// --- The token endpoint ---------------------------------------------------

export type OAuthTokenFailure = 'rejected' | 'needs-admin' | 'unavailable';

// Why a key couldn't mint an access token. The message never carries a
// token, a secret or the vendor's own description.
export class OAuthTokenError extends Error {
  readonly reason: OAuthTokenFailure;
  constructor(reason: OAuthTokenFailure, message: string) {
    super(message);
    this.name = 'OAuthTokenError';
    this.reason = reason;
  }
}

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
}

interface OAuthSettings {
  // The pause before each retry of a token request that failed in a way that
  // may pass: a 5xx, a timeout, a dropped connection or
  // `temporarily_unavailable`.
  retryDelaysMs: number[];
  // How long before an access token expires it is refreshed, at most; a
  // short-lived token is refreshed halfway through its life.
  refreshLeadMs: number;
  now: () => number;
}

const DEFAULT_OAUTH_SETTINGS: OAuthSettings = {
  retryDelaysMs: [500, 2000],
  refreshLeadMs: 60_000,
  now: () => Date.now(),
};

let oauthSettings: OAuthSettings = { ...DEFAULT_OAUTH_SETTINGS };

export function configureOAuth(overrides: Partial<OAuthSettings>): void {
  oauthSettings = { ...oauthSettings, ...overrides };
}

export function resetOAuth(): void {
  oauthSettings = { ...DEFAULT_OAUTH_SETTINGS };
  tokenCache.clear();
}

class TokenEndpointError extends Error {
  readonly oauthError: string | null;
  readonly status: number | null;
  constructor(oauthError: string | null, status: number | null) {
    super(
      `token endpoint answered ${status ?? 'nothing'}${oauthError ? ` ${oauthError}` : ''}`,
    );
    this.oauthError = oauthError;
    this.status = status;
  }
  get retryable(): boolean {
    return (
      this.status === null ||
      this.status >= 500 ||
      this.oauthError === 'temporarily_unavailable'
    );
  }
}

async function postToTokenEndpoint(
  client: MintingClient,
  fields: Record<string, string>,
): Promise<TokenResponse> {
  let body = new URLSearchParams(fields);
  let headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (client.tokenAuth === 'client_secret_basic') {
    headers.authorization = `Basic ${Buffer.from(
      `${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`,
    ).toString('base64')}`;
  } else {
    body.set('client_id', client.clientId);
    body.set('client_secret', client.clientSecret);
  }
  // Only the client secret is registered: a vendor that answers with the
  // refresh token it was sent, unrotated, must hand it back intact.
  let scrubber = new CredentialScrubber();
  scrubber.register(client.clientSecret);
  let response: Response;
  try {
    response = await outboundFetch({
      url: client.tokenURL,
      method: 'POST',
      headers,
      body: body.toString(),
      sizePath: 'system-key',
      scrubber,
    });
  } catch (error) {
    if (error instanceof OutboundRefusedError) {
      // Never retried: the destination itself is refused.
      throw new TokenEndpointError('refused', 0);
    }
    if (error instanceof OutboundTimeoutError) {
      throw new TokenEndpointError(null, null);
    }
    throw new TokenEndpointError(null, null);
  }
  let text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = Object.fromEntries(new URLSearchParams(text));
  }
  // GitHub answers a refused grant with 200 and an `error`.
  if (!response.ok || typeof parsed.error === 'string') {
    throw new TokenEndpointError(
      typeof parsed.error === 'string' ? parsed.error : null,
      response.status,
    );
  }
  if (typeof parsed.access_token !== 'string' || !parsed.access_token) {
    throw new TokenEndpointError('no_access_token', response.status);
  }
  let expiresIn = Number(parsed.expires_in);
  return {
    accessToken: parsed.access_token,
    ...(typeof parsed.refresh_token === 'string' && parsed.refresh_token
      ? { refreshToken: parsed.refresh_token }
      : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresIn } : {}),
    ...(typeof parsed.scope === 'string' ? { scope: parsed.scope } : {}),
  };
}

// Sends a token request, retrying what may pass, and classifies what doesn't:
// `invalid_grant` is the grant's fault, `invalid_client` and
// `unauthorized_client` the client's.
async function requestTokens(
  dbAdapter: DBAdapter,
  client: MintingClient,
  fields: Record<string, string>,
): Promise<TokenResponse> {
  let delays = oauthSettings.retryDelaysMs;
  for (let attempt = 0; ; attempt++) {
    try {
      return await postToTokenEndpoint(client, fields);
    } catch (error) {
      if (!(error instanceof TokenEndpointError)) {
        throw error;
      }
      if (error.oauthError === 'invalid_grant') {
        throw new OAuthTokenError(
          'rejected',
          'the vendor no longer accepts this connection; its owner signs in again',
        );
      }
      if (
        error.oauthError === 'invalid_client' ||
        error.oauthError === 'unauthorized_client' ||
        (error.status === 401 && error.oauthError === null)
      ) {
        await markClientBroken(dbAdapter, client);
        throw new OAuthTokenError(
          'needs-admin',
          'the OAuth client was refused by its token endpoint; an administrator of the client replaces its secret',
        );
      }
      if (!error.retryable || attempt >= delays.length) {
        log.warn(`token request failed: ${error.message}`);
        throw new OAuthTokenError(
          'unavailable',
          'the token endpoint could not be reached; try again later',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

// --- Connecting -----------------------------------------------------------

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// The PKCE verifier for a sign-in, derived from its `state` with the server's
// secret, so nothing that would complete the sign-in is stored.
function codeVerifierFor(serverSecret: string, state: string): string {
  return createHmac('sha256', serverSecret)
    .update(`oauth-pkce\0${state}`)
    .digest('base64url');
}

export function oauthRedirectURI(serverURL: string): string {
  return new URL(OAUTH_CALLBACK_PATH, serverURL).href;
}

// Starts a sign-in through a client: spends the ticket (to `add` a key, or to
// `replace` the connection a reconnect names), records the request, and
// answers with the vendor's authorization URL to send the user to.
export async function startConnect(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  {
    owner,
    name,
    reconnect,
    client,
    ticket,
    serverURL,
    serverSecret,
    mayUseShare,
  }: {
    owner: string;
    name?: unknown;
    reconnect?: unknown;
    client: ClientRef;
    ticket: unknown;
    serverURL: string;
    serverSecret: string;
    // Whether the owner may connect through a share in its realm: they read it.
    mayUseShare: (realmURL: string) => Promise<boolean>;
  },
): Promise<{ authorizeURL: string; expiresAt: string }> {
  let reconnects: string | null = null;
  let validName: string;
  if (reconnect !== undefined) {
    if (typeof reconnect !== 'string') {
      throw new UserKeyError(400, 'a reconnect names the connection');
    }
    let [key] = await query(dbAdapter, [
      `SELECT name, kind FROM user_keys WHERE id = `,
      param(reconnect),
      ` AND owner = `,
      param(owner),
    ]);
    if (!key || key.kind !== 'oauth-connection') {
      throw new UserKeyError(404, 'no such connection');
    }
    reconnects = reconnect;
    validName = key.name as string;
  } else {
    validName = validateUserKeyName(name);
    let [taken] = await query(dbAdapter, [
      `SELECT 1 FROM user_keys WHERE owner = `,
      param(owner),
      ` AND name = `,
      param(validName),
    ]);
    if (taken) {
      throw new UserKeyError(409, `you already have a key named ${validName}`);
    }
  }
  let refColumns = {
    client_key_id: client.kind === 'own' ? client.keyId : null,
    client_share_id: client.kind === 'share' ? client.shareId : null,
    platform_client_id: client.kind === 'platform' ? client.clientId : null,
  };
  if (client.kind === 'own') {
    let [own] = await query(dbAdapter, [
      `SELECT 1 FROM user_keys WHERE id = `,
      param(client.keyId),
      ` AND owner = `,
      param(owner),
    ]);
    if (!own) {
      throw new UserKeyError(404, 'no such client');
    }
  }
  if (client.kind === 'share') {
    let [share] = await query(dbAdapter, [
      `SELECT realm_url FROM key_shares WHERE id = `,
      param(client.shareId),
    ]);
    if (!share || !(await mayUseShare(share.realm_url as string))) {
      throw new UserKeyError(404, 'no such client');
    }
  }
  let state = randomBytes(32).toString('base64url');
  let expiresAt = new Date(Date.now() + CONNECT_REQUEST_TTL_MS);
  let opened = await dbAdapter.withTransaction(async (txQuery) => {
    await consumeKeyWriteTicket(
      txQuery,
      owner,
      ticket,
      reconnects
        ? {
            action: 'replace',
            keyId: reconnects,
            realmURL: null,
            shareId: null,
          }
        : { action: 'add', keyId: null, realmURL: null, shareId: null },
    );
    let opened: MintingClient;
    try {
      opened = await openClientIn(txQuery, keyring, refColumns);
    } catch (error) {
      if (error instanceof OAuthTokenError) {
        throw new UserKeyError(404, 'no such client');
      }
      throw error;
    }
    if (!opened.authorizeURL) {
      throw new UserKeyError(
        400,
        'a client_credentials client has no sign-in to connect through',
      );
    }
    await txQuery([
      `DELETE FROM oauth_connect_requests WHERE expires_at <= NOW()`,
    ]);
    await txQuery([
      `INSERT INTO oauth_connect_requests (state_sha256, owner, name, client_kind, client_key_id, client_share_id, platform_client_id, reconnects_key_id, expires_at) VALUES (`,
      param(sha256(state)),
      `, `,
      param(owner),
      `, `,
      param(validName),
      `, `,
      param(client.kind),
      `, `,
      param(refColumns.client_key_id),
      `, `,
      param(refColumns.client_share_id),
      `, `,
      param(refColumns.platform_client_id),
      `, `,
      param(reconnects),
      `, `,
      param(expiresAt.toISOString()),
      `)`,
    ]);
    return opened;
  });
  let scopes = await clientScopes(dbAdapter, client);
  let authorize = new URL(opened.authorizeURL!);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', opened.clientId);
  authorize.searchParams.set('redirect_uri', oauthRedirectURI(serverURL));
  authorize.searchParams.set('state', state);
  if (scopes) {
    authorize.searchParams.set('scope', scopes);
  }
  authorize.searchParams.set(
    'code_challenge',
    createHash('sha256')
      .update(codeVerifierFor(serverSecret, state))
      .digest('base64url'),
  );
  authorize.searchParams.set('code_challenge_method', 'S256');
  return { authorizeURL: authorize.href, expiresAt: expiresAt.toISOString() };
}

async function clientScopes(
  dbAdapter: DBAdapter,
  client: ClientRef,
): Promise<string> {
  let rows =
    client.kind === 'platform'
      ? await query(dbAdapter, [
          `SELECT scopes FROM platform_oauth_clients WHERE id = `,
          param(client.clientId),
        ])
      : client.kind === 'own'
        ? await query(dbAdapter, [
            `SELECT scopes FROM oauth_clients WHERE key_id = `,
            param(client.keyId),
          ])
        : await query(dbAdapter, [
            `SELECT c.scopes FROM key_shares s JOIN oauth_clients c ON c.key_id = s.key_id WHERE s.id = `,
            param(client.shareId),
          ]);
  return (rows[0]?.scopes as string) ?? '';
}

export type ConnectOutcome =
  | { ok: true; keyId: string; reconnected: boolean }
  | {
      ok: false;
      // `expired`: no such sign-in in progress (unknown, used or too old).
      // `denied`: the user or the vendor declined. `failed`: the code
      // couldn't be exchanged. `name-taken`: the owner added a key of the
      // connection's name meanwhile.
      error: 'expired' | 'denied' | 'failed' | 'name-taken';
    };

// Finishes a sign-in the vendor sent back to the realm server: spends the
// request its `state` names (once, and only before it expires), exchanges the
// code at the client's token endpoint with the derived PKCE verifier, and
// stores the connection. A reconnect replaces the connection's token and
// clears its rejection.
export async function completeConnect(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  {
    state,
    code,
    vendorError,
    serverURL,
    serverSecret,
  }: {
    state: unknown;
    code: unknown;
    vendorError: unknown;
    serverURL: string;
    serverSecret: string;
  },
): Promise<ConnectOutcome> {
  if (typeof state !== 'string' || state.length === 0) {
    return { ok: false, error: 'expired' };
  }
  let [request] = await query(dbAdapter, [
    `DELETE FROM oauth_connect_requests WHERE state_sha256 = `,
    param(sha256(state)),
    ` AND expires_at > NOW() RETURNING *`,
  ]);
  if (!request) {
    return { ok: false, error: 'expired' };
  }
  if (vendorError !== undefined || typeof code !== 'string' || !code) {
    return { ok: false, error: 'denied' };
  }
  let client: MintingClient;
  try {
    client = await openClientIn(
      (expression) => query(dbAdapter, expression),
      keyring,
      request,
    );
  } catch (error) {
    if (error instanceof OAuthTokenError) {
      return { ok: false, error: 'failed' };
    }
    throw error;
  }
  let tokens: TokenResponse;
  try {
    tokens = await requestTokens(dbAdapter, client, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: oauthRedirectURI(serverURL),
      code_verifier: codeVerifierFor(serverSecret, state),
    });
  } catch (error) {
    if (error instanceof OAuthTokenError) {
      return { ok: false, error: 'failed' };
    }
    throw error;
  }
  let owner = request.owner as string;
  let tokenKind = tokens.refreshToken ? 'refresh' : 'access';
  let value = tokens.refreshToken ?? tokens.accessToken;
  let clientColumns = {
    client_kind: request.client_kind as OAuthClientKind,
    client_key_id: (request.client_key_id as string | null) ?? null,
    client_share_id: (request.client_share_id as string | null) ?? null,
    platform_client_id: (request.platform_client_id as string | null) ?? null,
  };
  let reconnects = request.reconnects_key_id as string | null;
  let keyId: string;
  try {
    keyId = await dbAdapter.withTransaction(async (txQuery) => {
      if (reconnects) {
        let sealed = keyring.seal(value, userKeyBinding(owner, reconnects));
        let [updated] = await txQuery([
          `UPDATE user_keys SET (value_ciphertext, value_nonce, value_tag, value_key_id, state, updated_at) = (`,
          ...SEALED_COLUMN_VALUES(sealed),
          `, 'active', NOW()) WHERE id = `,
          param(reconnects),
          ` AND owner = `,
          param(owner),
          ` AND kind = 'oauth-connection' RETURNING id`,
        ]);
        if (!updated) {
          throw new UserKeyError(404, 'no such connection');
        }
        await txQuery([
          `UPDATE oauth_connections SET (client_kind, client_key_id, client_share_id, platform_client_id, token_kind, scopes, rejected_at) = (`,
          param(clientColumns.client_kind),
          `, `,
          param(clientColumns.client_key_id),
          `, `,
          param(clientColumns.client_share_id),
          `, `,
          param(clientColumns.platform_client_id),
          `, `,
          param(tokenKind),
          `, `,
          param(tokens.scope ?? ''),
          `, NULL) WHERE key_id = `,
          param(reconnects),
        ]);
        return reconnects;
      }
      let key = await insertUserKeyIn(txQuery, keyring, {
        id: randomUUID(),
        owner,
        name: request.name as string,
        kind: 'oauth-connection',
        value,
      });
      await txQuery([
        `INSERT INTO oauth_connections (key_id, client_kind, client_key_id, client_share_id, platform_client_id, token_kind, scopes) VALUES (`,
        param(key.id),
        `, `,
        param(clientColumns.client_kind),
        `, `,
        param(clientColumns.client_key_id),
        `, `,
        param(clientColumns.client_share_id),
        `, `,
        param(clientColumns.platform_client_id),
        `, `,
        param(tokenKind),
        `, `,
        param(tokens.scope ?? ''),
        `)`,
      ]);
      return key.id;
    });
  } catch (error) {
    if (error instanceof UserKeyError && error.status === 409) {
      return { ok: false, error: 'name-taken' };
    }
    if (error instanceof UserKeyError && error.status === 404) {
      return { ok: false, error: 'expired' };
    }
    throw error;
  }
  tokenCache.forget(keyId);
  if (tokens.refreshToken) {
    tokenCache.remember(keyId, tokens);
  }
  return { ok: true, keyId, reconnected: reconnects !== null };
}

// --- Minting access tokens -----------------------------------------------

interface CachedToken {
  accessToken: string;
  // When to refresh it; null for a token the vendor gave no lifetime.
  refreshAt: number | null;
}

class OAuthTokens {
  #cache = new Map<string, CachedToken>();
  #inflight = new Map<string, Promise<string>>();

  clear() {
    this.#cache.clear();
    this.#inflight.clear();
  }

  forget(keyId: string) {
    this.#cache.delete(keyId);
  }

  remember(keyId: string, tokens: TokenResponse) {
    let now = oauthSettings.now();
    let refreshAt: number | null = null;
    if (tokens.expiresIn !== undefined) {
      let lifetime = tokens.expiresIn * 1000;
      refreshAt =
        now + lifetime - Math.min(oauthSettings.refreshLeadMs, lifetime / 2);
    }
    this.#cache.set(keyId, { accessToken: tokens.accessToken, refreshAt });
  }

  // The current access token of a key that mints them: a connection, or a
  // `client_credentials` client. A cached token is used until it is due for
  // refresh; one refresh at a time runs per key, and callers that arrive
  // meanwhile wait for it.
  async accessToken(
    dbAdapter: DBAdapter,
    keyring: SecretsKeyring,
    keyId: string,
  ): Promise<string> {
    let cached = this.#cache.get(keyId);
    if (
      cached &&
      (cached.refreshAt === null || oauthSettings.now() < cached.refreshAt)
    ) {
      return cached.accessToken;
    }
    let inflight = this.#inflight.get(keyId);
    if (inflight) {
      return await inflight;
    }
    let minting = this.#mint(dbAdapter, keyring, keyId).finally(() => {
      this.#inflight.delete(keyId);
    });
    this.#inflight.set(keyId, minting);
    return await minting;
  }

  async #mint(
    dbAdapter: DBAdapter,
    keyring: SecretsKeyring,
    keyId: string,
  ): Promise<string> {
    // The key's row stays locked through the token request, so another
    // process refreshing the same connection waits, then reads the refresh
    // token this one stored.
    let outcome = await dbAdapter.withTransaction(async (txQuery) => {
      let [key] = await txQuery([
        `SELECT k.id, k.owner, k.kind, k.state, n.token_kind, n.client_key_id, n.client_share_id, n.platform_client_id, ${sealedColumnsSelect('value')}
           FROM user_keys k LEFT JOIN oauth_connections n ON n.key_id = k.id
          WHERE k.id = `,
        param(keyId),
        ` FOR UPDATE OF k`,
      ]);
      if (!key) {
        throw new OAuthTokenError('rejected', 'the key no longer exists');
      }
      let sealed = sealedFromColumns(key, 'value');
      if (!sealed) {
        throw new Error(`key ${keyId} holds no sealed value`);
      }
      let owner = key.owner as string;
      let stored = () => keyring.open(sealed!, userKeyBinding(owner, keyId));
      if (key.kind === 'oauth-client') {
        let client = await openClientIn(txQuery, keyring, {
          client_key_id: keyId,
        });
        return {
          tokens: await requestTokens(dbAdapter, client, {
            grant_type: 'client_credentials',
          }),
          rotated: undefined,
        };
      }
      if (key.kind !== 'oauth-connection') {
        throw new Error(`key ${keyId} doesn't mint tokens`);
      }
      if (key.state === 'rejected') {
        throw new OAuthTokenError(
          'rejected',
          'the vendor no longer accepts this connection; its owner signs in again',
        );
      }
      if (key.token_kind === 'access') {
        // A vendor that issues no refresh token issues an access token that
        // doesn't expire; it is the stored value, sent as it is.
        await openClientIn(txQuery, keyring, key);
        return {
          tokens: { accessToken: stored() } as TokenResponse,
          rotated: undefined,
        };
      }
      let client = await openClientIn(txQuery, keyring, key);
      let tokens: TokenResponse;
      try {
        tokens = await requestTokens(dbAdapter, client, {
          grant_type: 'refresh_token',
          refresh_token: stored(),
        });
      } catch (error) {
        if (error instanceof OAuthTokenError && error.reason === 'rejected') {
          await txQuery([
            `UPDATE user_keys SET state = 'rejected', updated_at = NOW() WHERE id = `,
            param(keyId),
          ]);
          await txQuery([
            `UPDATE oauth_connections SET rejected_at = NOW() WHERE key_id = `,
            param(keyId),
          ]);
          return { rejected: error };
        }
        throw error;
      }
      if (tokens.refreshToken) {
        let resealed = keyring.seal(
          tokens.refreshToken,
          userKeyBinding(owner, keyId),
        );
        await txQuery([
          `UPDATE user_keys SET (value_ciphertext, value_nonce, value_tag, value_key_id) = (`,
          ...SEALED_COLUMN_VALUES(resealed),
          `) WHERE id = `,
          param(keyId),
        ]);
      }
      return { tokens, rotated: tokens.refreshToken };
    });
    if ('rejected' in outcome && outcome.rejected) {
      this.#cache.delete(keyId);
      log.warn(`OAuth connection ${keyId} was refused as invalid_grant`);
      throw outcome.rejected;
    }
    let { tokens } = outcome as { tokens: TokenResponse };
    this.remember(keyId, tokens);
    return tokens.accessToken;
  }
}

const tokenCache = new OAuthTokens();

export function oauthAccessToken(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  keyId: string,
): Promise<string> {
  return tokenCache.accessToken(dbAdapter, keyring, keyId);
}
