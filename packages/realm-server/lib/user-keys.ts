import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { param, query, type DBAdapter } from '@cardstack/runtime-common';
import type { Expression, Querier } from '@cardstack/runtime-common/expression';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import {
  SecretDecryptionError,
  type SealedSecret,
  type SecretBinding,
  type SecretsKeyring,
} from './secrets-at-rest/envelope.ts';
import {
  sealedColumnsSelect,
  sealedFromColumns,
} from './secrets-at-rest/sealed-columns.ts';
import { revokeBindingsIn } from './key-binding-revocation.ts';

// Keys that belong to people. Every key has one owner, the user who created
// it, and only that owner lists, shows, replaces or deletes it. A key's value
// is sealed by the secrets-at-rest helper before it reaches the database and
// is never returned by anything here: what callers get back is metadata.
//
// A key is only its secret. It records no destination, and its value, the
// master copy, is sealed to the key alone. Where a key may be sent is a grant
// (`lib/user-key-grants.ts`): each holds its own copy of the value, sealed to
// the grant, the key and the grant's destination. Replacing a key re-seals the
// master copy and every grant's copy together.
//
// A key is added, replaced, deleted, shared into a realm or swapped into a
// share, and a share suspended by a writer is resumed, only with a key write
// ticket: short-lived, single-use, minted for the signed-in user and for one
// change (an add; a replace or delete of one key; a share of one key into one
// realm; a swap of one key into one share; or a resume of one share), and
// consumed in the same transaction as that change. The routes mint tickets only for requests from
// the secure origin and for clients that send no `Origin`, as the CLI does, so
// card code in the app page can't change a key from inside the browser.

export const USER_KEY_VALUE_FIELD = 'user_keys.value';
export const USER_KEY_GRANT_VALUE_FIELD = 'user_key_grants.value';

// `static` is a secret sent as it is. `oauth-client` is an app registered with
// a vendor, whose value is the client secret; `oauth-connection` is a person's
// sign-in through one, whose value is the token that mints its access tokens
// (see `lib/oauth.ts`). Only a static key or a client is added with a value; a
// connection is made by signing in through a client.
export const USER_KEY_KINDS = [
  'static',
  'oauth-client',
  'oauth-connection',
] as const;
export type UserKeyKind = (typeof USER_KEY_KINDS)[number];

// The kinds whose value is never what reaches a vendor: it only mints the
// access token that does, at a token endpoint the platform alone calls. A
// grant of such a key holds no copy of the value, only a marker that proves
// the grant was made by the realm server (see `createOrReuseGrantIn`).
export const MINTING_KINDS: ReadonlySet<UserKeyKind> = new Set([
  'oauth-client',
  'oauth-connection',
]);

// `rejected` is an OAuth connection its vendor refused to refresh
// (`invalid_grant`); signing in through its client again makes it `active`.
export type UserKeyState = 'active' | 'rejected';

export const KEY_WRITE_ACTIONS = [
  'add',
  'replace',
  'delete',
  'share',
  'swap',
  'resume',
] as const;
export type KeyWriteAction = (typeof KEY_WRITE_ACTIONS)[number];

export const KEY_WRITE_TICKET_TTL_MS = 10 * 60 * 1000;

export const MAX_USER_KEY_NAME_LENGTH = 100;
export const MAX_USER_KEY_VALUE_LENGTH = 16 * 1024;

export interface UserKeyMetadata {
  id: string;
  name: string;
  kind: UserKeyKind;
  state: UserKeyState;
  createdAt: string;
  updatedAt: string;
}

// A refusal the caller can act on. `status` is the HTTP status the routes
// answer with; `message` never carries a key's value or a ticket.
export class UserKeyError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 413;

  constructor(status: 400 | 403 | 404 | 409 | 413, message: string) {
    super(message);
    this.name = 'UserKeyError';
    this.status = status;
  }
}

const INVALID_TICKET_MESSAGE =
  'a valid key write ticket is required: tickets are single-use, expire, and are minted for one user and one change';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// The change a key write ticket is minted for: an add; a replace or delete of
// one key; a share of one key into one realm; a swap of one key into one
// share; or a resume of one share.
export interface KeyWriteTarget {
  action: KeyWriteAction;
  // The key a replace, delete, share or swap uses; an add or a resume names
  // none.
  keyId: string | null;
  // The realm a share puts the key into; only a share names one.
  realmURL: string | null;
  // The share a swap puts the key into, or a resume resumes; only those name
  // one.
  shareId: string | null;
}

export function validateKeyWriteTarget({
  action,
  keyId,
  realm,
  shareId,
}: {
  action: unknown;
  keyId?: unknown;
  realm?: unknown;
  shareId?: unknown;
}): KeyWriteTarget {
  if (!KEY_WRITE_ACTIONS.includes(action as KeyWriteAction)) {
    throw new UserKeyError(
      400,
      `a ticket's action is one of: ${KEY_WRITE_ACTIONS.join(', ')}`,
    );
  }
  let named = (value: unknown) => value !== undefined && value !== null;
  if (named(realm) && action !== 'share') {
    throw new UserKeyError(400, `a ticket to ${action} names no realm`);
  }
  if (named(shareId) && action !== 'swap' && action !== 'resume') {
    throw new UserKeyError(400, `a ticket to ${action} names no share`);
  }
  if (action === 'add' || action === 'resume') {
    if (named(keyId)) {
      throw new UserKeyError(400, `a ticket to ${action} names no key`);
    }
    if (action === 'add') {
      return { action, keyId: null, realmURL: null, shareId: null };
    }
    return {
      action,
      keyId: null,
      realmURL: null,
      shareId: validShareId(shareId, action),
    };
  }
  if (typeof keyId !== 'string') {
    throw new UserKeyError(400, `a ticket to ${action} a key names the key`);
  }
  if (action === 'share') {
    let realmURL = typeof realm === 'string' ? normalizeRealmURL(realm) : null;
    if (!realmURL) {
      throw new UserKeyError(400, 'a ticket to share a key names the realm');
    }
    return { action, keyId, realmURL: realmURL.href, shareId: null };
  }
  if (action === 'swap') {
    return {
      action,
      keyId,
      realmURL: null,
      shareId: validShareId(shareId, action),
    };
  }
  return {
    action: action as KeyWriteAction,
    keyId,
    realmURL: null,
    shareId: null,
  };
}

// Mints a ticket for `owner` and one change. A ticket that names a key is
// minted only for a key the owner has; another user's key answers as one that
// doesn't exist. Only the ticket's SHA-256 is stored, so the ticket
// itself exists only in the response that carries it to the caller. Expired
// tickets are swept on the way.
export async function mintKeyWriteTicket(
  dbAdapter: DBAdapter,
  owner: string,
  { action, keyId, realmURL, shareId }: KeyWriteTarget,
): Promise<{ ticket: string; expiresAt: string }> {
  if (keyId !== null) {
    await getUserKey(dbAdapter, owner, keyId);
  }
  let ticket = randomBytes(32).toString('base64url');
  let expiresAt = new Date(Date.now() + KEY_WRITE_TICKET_TTL_MS);
  await query(dbAdapter, [
    `DELETE FROM key_write_tickets WHERE expires_at <= NOW()`,
  ]);
  await query(dbAdapter, [
    `INSERT INTO key_write_tickets (ticket_sha256, owner, action, key_id, realm_url, share_id, expires_at) VALUES (`,
    param(sha256(ticket)),
    `, `,
    param(owner),
    `, `,
    param(action),
    `, `,
    param(keyId),
    `, `,
    param(realmURL),
    `, `,
    param(shareId),
    `, `,
    param(expiresAt.toISOString()),
    `)`,
  ]);
  return { ticket, expiresAt: expiresAt.toISOString() };
}

// Consumes `ticket` inside the caller's transaction, so a write that fails
// afterwards leaves the ticket unused. A ticket spends only on the change it
// was minted for: its owner, its action and whatever that action names (its
// key, realm or share). Deleting the row is what makes a ticket single-use: a
// concurrent second use waits on the row and then finds it gone.
export async function consumeKeyWriteTicket(
  txQuery: Querier,
  owner: string,
  ticket: unknown,
  { action, keyId, realmURL, shareId }: KeyWriteTarget,
): Promise<void> {
  if (typeof ticket !== 'string' || ticket.length === 0) {
    throw new UserKeyError(403, INVALID_TICKET_MESSAGE);
  }
  let rows = await txQuery([
    `DELETE FROM key_write_tickets WHERE ticket_sha256 = `,
    param(sha256(ticket)),
    ` AND owner = `,
    param(owner),
    ` AND action = `,
    param(action),
    ...matches('key_id', keyId),
    ...matches('realm_url', realmURL),
    ...matches('share_id', shareId),
    ` AND expires_at > NOW() RETURNING ticket_sha256`,
  ]);
  if (rows.length === 0) {
    throw new UserKeyError(403, INVALID_TICKET_MESSAGE);
  }
}

// A share's id is a UUID; anything else names no share.
function validShareId(shareId: unknown, action: KeyWriteAction): string {
  if (typeof shareId !== 'string') {
    throw new UserKeyError(400, `a ticket to ${action} names the share`);
  }
  if (!UUID.test(shareId)) {
    throw new UserKeyError(404, 'no such share');
  }
  return shareId;
}

function matches(column: string, value: string | null): Expression {
  return value === null
    ? [` AND ${column} IS NULL`]
    : [` AND ${column} = `, param(value)];
}

export function validateUserKeyName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new UserKeyError(400, 'a key needs a name');
  }
  let trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new UserKeyError(400, 'a key needs a name');
  }
  if (trimmed.length > MAX_USER_KEY_NAME_LENGTH) {
    throw new UserKeyError(
      400,
      `a key's name is at most ${MAX_USER_KEY_NAME_LENGTH} characters`,
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new UserKeyError(
      400,
      `a key's name can't contain control characters`,
    );
  }
  return trimmed;
}

export function validateUserKeyKind(kind: unknown): UserKeyKind {
  if (kind === undefined) {
    return 'static';
  }
  if (!USER_KEY_KINDS.includes(kind as UserKeyKind)) {
    throw new UserKeyError(
      400,
      `a key's kind is one of: ${USER_KEY_KINDS.join(', ')}`,
    );
  }
  if (kind === 'oauth-connection') {
    throw new UserKeyError(
      400,
      'an OAuth connection is made by signing in through a client, not added with a value',
    );
  }
  return kind as UserKeyKind;
}

export function validateUserKeyValue(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new UserKeyError(400, 'a key needs a value');
  }
  if (value.length > MAX_USER_KEY_VALUE_LENGTH) {
    throw new UserKeyError(
      400,
      `a key's value is at most ${MAX_USER_KEY_VALUE_LENGTH} characters`,
    );
  }
  return value;
}

// A key's master copy is bound to its field, its owner and its row, so a value
// moved to another row or owner doesn't open.
export function userKeyBinding(owner: string, id: string): SecretBinding {
  return { field: USER_KEY_VALUE_FIELD, owner, id };
}

// A grant's copy of a key's value is bound to its field, the owner, the
// grant's row, the key it copies (as the binding's parent) and the grant's
// destination. So a copy moved to another grant or key, a grant pointed at
// another key or destination, or a grant row written outside the realm
// server, has no copy that opens.
export function grantCopyBinding({
  owner,
  keyId,
  grantId,
  destination,
}: {
  owner: string;
  keyId: string;
  grantId: string;
  destination: string;
}): SecretBinding {
  return {
    field: USER_KEY_GRANT_VALUE_FIELD,
    owner,
    id: grantId,
    parentId: keyId,
    destination,
  };
}

const METADATA_COLUMNS = `id, name, kind, state, created_at, updated_at`;

function toMetadata(row: Record<string, unknown>): UserKeyMetadata {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as UserKeyKind,
    state: row.state as UserKeyState,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export async function listUserKeys(
  dbAdapter: DBAdapter,
  owner: string,
): Promise<UserKeyMetadata[]> {
  let rows = await query(dbAdapter, [
    `SELECT ${METADATA_COLUMNS} FROM user_keys WHERE owner = `,
    param(owner),
    ` ORDER BY name`,
  ]);
  return rows.map(toMetadata);
}

// Another user's key answers exactly as a key that doesn't exist.
export async function getUserKey(
  dbAdapter: DBAdapter,
  owner: string,
  id: string,
): Promise<UserKeyMetadata> {
  assertKeyId(id);
  let rows = await query(dbAdapter, [
    `SELECT ${METADATA_COLUMNS} FROM user_keys WHERE id = `,
    param(id),
    ` AND owner = `,
    param(owner),
  ]);
  if (rows.length === 0) {
    throw notFound();
  }
  return toMetadata(rows[0]);
}

function notFound() {
  return new UserKeyError(404, 'no such key');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A key's id is a UUID; anything else names no key.
function assertKeyId(id: string): void {
  if (!UUID.test(id)) {
    throw notFound();
  }
}

export const SEALED_COLUMN_VALUES = (sealed: SealedSecret): Expression => [
  `decode(`,
  param(sealed.ciphertext.toString('base64')),
  `, 'base64'), decode(`,
  param(sealed.nonce.toString('base64')),
  `, 'base64'), decode(`,
  param(sealed.tag.toString('base64')),
  `, 'base64'), `,
  param(sealed.keyId),
];

export async function addUserKey(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  {
    owner,
    name,
    kind,
    value,
    ticket,
  }: {
    owner: string;
    name: unknown;
    kind?: unknown;
    value: unknown;
    ticket: unknown;
  },
): Promise<UserKeyMetadata> {
  let validName = validateUserKeyName(name);
  let validKind = validateUserKeyKind(kind);
  if (validKind !== 'static') {
    throw new UserKeyError(
      400,
      'an OAuth client is added with its client id and endpoints (`oauth`)',
    );
  }
  let validValue = validateUserKeyValue(value);
  return await dbAdapter.withTransaction(async (txQuery) => {
    await consumeKeyWriteTicket(txQuery, owner, ticket, {
      action: 'add',
      keyId: null,
      realmURL: null,
      shareId: null,
    });
    return await insertUserKeyIn(txQuery, keyring, {
      id: randomUUID(),
      owner,
      name: validName,
      kind: validKind,
      value: validValue,
    });
  });
}

// Inserts a key, its value sealed as its master copy, in the caller's
// transaction. The caller has validated the name and value and spent the
// ticket for the change; a name the owner already uses is refused 409.
export async function insertUserKeyIn(
  txQuery: Querier,
  keyring: SecretsKeyring,
  {
    id,
    owner,
    name,
    kind,
    value,
  }: {
    id: string;
    owner: string;
    name: string;
    kind: UserKeyKind;
    value: string;
  },
): Promise<UserKeyMetadata> {
  let sealed = keyring.seal(value, userKeyBinding(owner, id));
  let rows = await txQuery([
    `INSERT INTO user_keys (id, owner, name, kind, state, value_ciphertext, value_nonce, value_tag, value_key_id) VALUES (`,
    param(id),
    `, `,
    param(owner),
    `, `,
    param(name),
    `, `,
    param(kind),
    `, 'active', `,
    ...SEALED_COLUMN_VALUES(sealed),
    `) ON CONFLICT (owner, name) DO NOTHING RETURNING ${METADATA_COLUMNS}`,
  ]);
  if (rows.length === 0) {
    throw new UserKeyError(409, `you already have a key named ${name}`);
  }
  return toMetadata(rows[0]);
}

// Whether `sealed` opens under `binding`. Only a copy that doesn't open
// answers false; any other failure is thrown.
export function opensUnder(
  keyring: SecretsKeyring,
  sealed: SealedSecret | undefined,
  binding: SecretBinding,
): boolean {
  if (!sealed) {
    return false;
  }
  try {
    keyring.open(sealed, binding);
    return true;
  } catch (e) {
    if (e instanceof SecretDecryptionError) {
      return false;
    }
    throw e;
  }
}

// Replaces a key's value, keeping its name and kind. The master copy and every
// grant's copy are sealed again in the same transaction, so the old value
// opens nowhere afterwards and no grant asks for approval again. A grant is
// sealed again only when its current copy opens under its own binding: the
// binding is read from the row, so sealing one whose copy doesn't open would
// make a row written or edited outside the realm server a real grant. Such a
// row is left as it is, and still sends nothing.
export async function replaceUserKeyValue(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  {
    owner,
    id,
    value,
    ticket,
  }: { owner: string; id: string; value: unknown; ticket: unknown },
): Promise<UserKeyMetadata> {
  assertKeyId(id);
  let validValue = validateUserKeyValue(value);
  return await dbAdapter.withTransaction(async (txQuery) => {
    await consumeKeyWriteTicket(txQuery, owner, ticket, {
      action: 'replace',
      keyId: id,
      realmURL: null,
      shareId: null,
    });
    let [current] = await txQuery([
      `SELECT kind FROM user_keys WHERE id = `,
      param(id),
      ` AND owner = `,
      param(owner),
      ` FOR UPDATE`,
    ]);
    if (!current) {
      throw notFound();
    }
    if (current.kind === 'oauth-connection') {
      throw new UserKeyError(
        400,
        'an OAuth connection is replaced by signing in through its client again',
      );
    }
    let sealed = keyring.seal(validValue, userKeyBinding(owner, id));
    let [updated] = await txQuery([
      `UPDATE user_keys SET (value_ciphertext, value_nonce, value_tag, value_key_id, updated_at) = (`,
      ...SEALED_COLUMN_VALUES(sealed),
      `, NOW()) WHERE id = `,
      param(id),
      ` AND owner = `,
      param(owner),
      ` RETURNING ${METADATA_COLUMNS}`,
    ]);
    if (MINTING_KINDS.has(updated.kind as UserKeyKind)) {
      // A client's new secret is the fix for a token endpoint that refused the
      // old one, so the client, and every connection through it, mints again.
      // Its grants hold markers, not the secret, so they stay as they are.
      await txQuery([
        `UPDATE oauth_clients SET state = 'active', broken_at = NULL WHERE key_id = `,
        param(id),
      ]);
      return toMetadata(updated);
    }
    let grants = await txQuery([
      `SELECT id, destination, ${sealedColumnsSelect('value')} FROM user_key_grants WHERE key_id = `,
      param(id),
      ` AND owner = `,
      param(owner),
      ` FOR UPDATE`,
    ]);
    for (let grant of grants) {
      let binding = grantCopyBinding({
        owner,
        keyId: id,
        grantId: grant.id as string,
        destination: grant.destination as string,
      });
      if (!opensUnder(keyring, sealedFromColumns(grant, 'value'), binding)) {
        continue;
      }
      let copy = keyring.seal(validValue, binding);
      await txQuery([
        `UPDATE user_key_grants SET (value_ciphertext, value_nonce, value_tag, value_key_id) = (`,
        ...SEALED_COLUMN_VALUES(copy),
        `) WHERE id = `,
        param(grant.id as string),
      ]);
    }
    return toMetadata(updated);
  });
}

// Deletes a key, and its grants with it (`user_key_grants` cascades). Every
// share holding it is suspended in the same statement,
// by a trigger on `user_keys`, and keeps its place in its realm for a direct
// writer to swap another key into; `listOwnShares` with the key's id lists
// the shares a delete would suspend.
export async function deleteUserKey(
  dbAdapter: DBAdapter,
  { owner, id, ticket }: { owner: string; id: string; ticket: unknown },
): Promise<void> {
  assertKeyId(id);
  await dbAdapter.withTransaction(async (txQuery) => {
    await consumeKeyWriteTicket(txQuery, owner, ticket, {
      action: 'delete',
      keyId: id,
      realmURL: null,
      shareId: null,
    });
    let [key] = await txQuery([
      `SELECT id FROM user_keys WHERE id = `,
      param(id),
      ` AND owner = `,
      param(owner),
      ` FOR UPDATE`,
    ]);
    if (!key) {
      throw notFound();
    }
    // The key's own bindings are revoked with it, each recorded in its
    // history. A share's bindings stay: the share is suspended, and a key
    // swapped into it takes them over.
    await revokeBindingsIn(txQuery, {
      where: [`key_id = `, param(id)],
      actor: owner,
      via: null,
    });
    await txQuery([`DELETE FROM user_keys WHERE id = `, param(id)]);
  });
}
