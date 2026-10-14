import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { param, query, type DBAdapter } from '@cardstack/runtime-common';
import type { Expression, Querier } from '@cardstack/runtime-common/expression';
import type {
  SealedSecret,
  SecretBinding,
  SecretsKeyring,
} from './secrets-at-rest/index.ts';

// Keys that belong to people. Every key has one owner, the user who created
// it, and only that owner lists, shows, replaces or deletes it. A key's value
// is sealed by the secrets-at-rest helper before it reaches the database and
// is never returned by anything here: what callers get back is metadata.
//
// A value is written only with a key write ticket: short-lived, single-use,
// minted for the signed-in user, and consumed in the same transaction as the
// write it authorizes. The routes mint tickets only for the secure origin and
// the CLI, so the app page, where card code runs, can't write a value.

export const USER_KEY_VALUE_FIELD = 'user_keys.value';

export const USER_KEY_KINDS = ['static'] as const;
export type UserKeyKind = (typeof USER_KEY_KINDS)[number];

export type UserKeyState = 'active';

export const KEY_WRITE_TICKET_TTL_MS = 10 * 60 * 1000;

export const MAX_USER_KEY_NAME_LENGTH = 100;
export const MAX_USER_KEY_VALUE_LENGTH = 16 * 1024;

// Where a key goes in a request, as the operation it was added for declares
// it (for example `{ placement: 'header', name: 'Authorization' }`).
export type PlacementHints = Record<string, string>;

export interface UserKeyMetadata {
  id: string;
  name: string;
  kind: UserKeyKind;
  // Where the key may be sent; null until the key has one.
  destination: string | null;
  placementHints: PlacementHints | null;
  state: UserKeyState;
  createdAt: string;
  updatedAt: string;
}

// Which `callApi` operation a key is added for: the key takes its destination
// from what the operation declares, never from what the caller types.
export interface OperationReference {
  realmURL: string;
  definitionURL: string;
  exportName: string;
  operationName: string;
}

export interface ResolvedKeyDestination {
  destination: string;
  placementHints?: PlacementHints;
}

// Looks up the destination an operation declares, on behalf of `owner`.
// Throws a `UserKeyError` when the operation can't supply one.
export type KeyDestinationResolver = (
  operation: OperationReference,
  context: { owner: string },
) => Promise<ResolvedKeyDestination>;

// The realm server's resolver. A destination is declared only by an operation
// that sends a key; no operation base on this server does, so every reference
// is refused.
export const resolveKeyDestination: KeyDestinationResolver = async () => {
  throw new UserKeyError(
    422,
    'the operation declares no destination a key can be sent to',
  );
};

// A refusal the caller can act on. `status` is the HTTP status the routes
// answer with; `message` never carries a key's value or a ticket.
export class UserKeyError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 422;

  constructor(status: 400 | 403 | 404 | 409 | 422, message: string) {
    super(message);
    this.name = 'UserKeyError';
    this.status = status;
  }
}

const INVALID_TICKET_MESSAGE =
  'a valid key write ticket is required: tickets are single-use, expire, and are minted for one user';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// Mints a ticket for `owner`. Only its SHA-256 is stored, so the ticket itself
// exists only in the response that carries it to the caller. Expired tickets
// are swept on the way.
export async function mintKeyWriteTicket(
  dbAdapter: DBAdapter,
  owner: string,
): Promise<{ ticket: string; expiresAt: string }> {
  let ticket = randomBytes(32).toString('base64url');
  let expiresAt = new Date(Date.now() + KEY_WRITE_TICKET_TTL_MS);
  await query(dbAdapter, [
    `DELETE FROM key_write_tickets WHERE expires_at <= NOW()`,
  ]);
  await query(dbAdapter, [
    `INSERT INTO key_write_tickets (ticket_sha256, owner, expires_at) VALUES (`,
    param(sha256(ticket)),
    `, `,
    param(owner),
    `, `,
    param(expiresAt.toISOString()),
    `)`,
  ]);
  return { ticket, expiresAt: expiresAt.toISOString() };
}

// Consumes `ticket` inside the caller's transaction, so a write that fails
// afterwards leaves the ticket unused. Deleting the row is what makes a ticket
// single-use: a concurrent second use waits on the row and then finds it
// gone.
async function consumeKeyWriteTicket(
  txQuery: Querier,
  owner: string,
  ticket: unknown,
): Promise<void> {
  if (typeof ticket !== 'string' || ticket.length === 0) {
    throw new UserKeyError(403, INVALID_TICKET_MESSAGE);
  }
  let rows = await txQuery([
    `DELETE FROM key_write_tickets WHERE ticket_sha256 = `,
    param(sha256(ticket)),
    ` AND owner = `,
    param(owner),
    ` AND expires_at > NOW() RETURNING ticket_sha256`,
  ]);
  if (rows.length === 0) {
    throw new UserKeyError(403, INVALID_TICKET_MESSAGE);
  }
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
  return kind as UserKeyKind;
}

function validateUserKeyValue(value: unknown): string {
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

// A destination is an absolute http(s) URL naming an origin and a path
// prefix: no credentials, query or fragment. It is stored, and bound into the
// sealed value, exactly as given.
export function validateKeyDestination(destination: unknown): string {
  if (typeof destination !== 'string') {
    throw new UserKeyError(422, 'a destination is an absolute URL');
  }
  let parsed: URL;
  try {
    parsed = new URL(destination);
  } catch {
    throw new UserKeyError(422, 'a destination is an absolute URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new UserKeyError(422, 'a destination is an http or https URL');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new UserKeyError(
      422,
      'a destination is an origin and a path, with no credentials, query or fragment',
    );
  }
  return destination;
}

function binding(
  owner: string,
  id: string,
  destination: string | null,
): SecretBinding {
  return {
    field: USER_KEY_VALUE_FIELD,
    owner,
    id,
    ...(destination !== null ? { destination } : {}),
  };
}

const METADATA_COLUMNS = `id, name, kind, destination, placement_hints, state, created_at, updated_at`;

function toMetadata(row: Record<string, unknown>): UserKeyMetadata {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as UserKeyKind,
    destination: (row.destination as string | null) ?? null,
    placementHints: (row.placement_hints as PlacementHints | null) ?? null,
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

const SEALED_COLUMN_VALUES = (sealed: SealedSecret): Expression => [
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
    destination = null,
    placementHints = null,
  }: {
    owner: string;
    name: unknown;
    kind?: unknown;
    value: unknown;
    ticket: unknown;
    destination?: string | null;
    placementHints?: PlacementHints | null;
  },
): Promise<UserKeyMetadata> {
  let validName = validateUserKeyName(name);
  let validKind = validateUserKeyKind(kind);
  let validValue = validateUserKeyValue(value);
  let validDestination =
    destination === null ? null : validateKeyDestination(destination);
  let id = randomUUID();
  return await dbAdapter.withTransaction(async (txQuery) => {
    await consumeKeyWriteTicket(txQuery, owner, ticket);
    let sealed = keyring.seal(validValue, binding(owner, id, validDestination));
    let rows = await txQuery([
      `INSERT INTO user_keys (id, owner, name, kind, destination, placement_hints, state, value_ciphertext, value_nonce, value_tag, value_key_id) VALUES (`,
      param(id),
      `, `,
      param(owner),
      `, `,
      param(validName),
      `, `,
      param(validKind),
      `, `,
      param(validDestination),
      `, `,
      param(placementHints),
      `, 'active', `,
      ...SEALED_COLUMN_VALUES(sealed),
      `) ON CONFLICT (owner, name) DO NOTHING RETURNING ${METADATA_COLUMNS}`,
    ]);
    if (rows.length === 0) {
      throw new UserKeyError(409, `you already have a key named ${validName}`);
    }
    return toMetadata(rows[0]);
  });
}

// Replaces a key's value, keeping its name, kind and destination.
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
    await consumeKeyWriteTicket(txQuery, owner, ticket);
    let [row] = await txQuery([
      `SELECT destination FROM user_keys WHERE id = `,
      param(id),
      ` AND owner = `,
      param(owner),
      ` FOR UPDATE`,
    ]);
    if (!row) {
      throw notFound();
    }
    let sealed = keyring.seal(
      validValue,
      binding(owner, id, (row.destination as string | null) ?? null),
    );
    let [updated] = await txQuery([
      `UPDATE user_keys SET (value_ciphertext, value_nonce, value_tag, value_key_id, updated_at) = (`,
      ...SEALED_COLUMN_VALUES(sealed),
      `, NOW()) WHERE id = `,
      param(id),
      ` RETURNING ${METADATA_COLUMNS}`,
    ]);
    return toMetadata(updated);
  });
}

// Gives a key that has no destination its destination, re-sealing the value
// so that from then on it opens only with that destination. Run by a key's
// first approval. Setting the destination a key already has changes nothing;
// a key's destination never changes once set.
export async function setUserKeyDestination(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  {
    owner,
    id,
    destination,
    placementHints = null,
  }: {
    owner: string;
    id: string;
    destination: string;
    placementHints?: PlacementHints | null;
  },
): Promise<UserKeyMetadata> {
  assertKeyId(id);
  let validDestination = validateKeyDestination(destination);
  return await dbAdapter.withTransaction(async (txQuery) => {
    let [row] = await txQuery([
      `SELECT ${METADATA_COLUMNS}, encode(value_ciphertext, 'base64') AS value_ciphertext, encode(value_nonce, 'base64') AS value_nonce, encode(value_tag, 'base64') AS value_tag, value_key_id FROM user_keys WHERE id = `,
      param(id),
      ` AND owner = `,
      param(owner),
      ` FOR UPDATE`,
    ]);
    if (!row) {
      throw notFound();
    }
    if (row.destination === validDestination) {
      return toMetadata(row);
    }
    if (row.destination != null) {
      throw new UserKeyError(409, `a key's destination can't change`);
    }
    let resealed = keyring.reseal(
      {
        keyId: row.value_key_id as string,
        ciphertext: Buffer.from(row.value_ciphertext as string, 'base64'),
        nonce: Buffer.from(row.value_nonce as string, 'base64'),
        tag: Buffer.from(row.value_tag as string, 'base64'),
      },
      binding(owner, id, null),
      binding(owner, id, validDestination),
    );
    let [updated] = await txQuery([
      `UPDATE user_keys SET (destination, placement_hints, value_ciphertext, value_nonce, value_tag, value_key_id, updated_at) = (`,
      param(validDestination),
      `, `,
      param(placementHints),
      `, `,
      ...SEALED_COLUMN_VALUES(resealed),
      `, NOW()) WHERE id = `,
      param(id),
      ` RETURNING ${METADATA_COLUMNS}`,
    ]);
    return toMetadata(updated);
  });
}

// Deletes a key. No key is shared into a realm, so nothing else refers to
// one; sharing adds the shares a deletion has to answer for.
export async function deleteUserKey(
  dbAdapter: DBAdapter,
  owner: string,
  id: string,
): Promise<void> {
  assertKeyId(id);
  let rows = await query(dbAdapter, [
    `DELETE FROM user_keys WHERE id = `,
    param(id),
    ` AND owner = `,
    param(owner),
    ` RETURNING id`,
  ]);
  if (rows.length === 0) {
    throw notFound();
  }
}
