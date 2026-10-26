import { randomUUID } from 'node:crypto';
import { param, query, type DBAdapter } from '@cardstack/runtime-common';
import type { CodeRef } from '@cardstack/runtime-common/code-ref';
import {
  destinationCovers,
  type OperationCore,
  type OperationDefinition,
} from '@cardstack/runtime-common/card-operations';
import {
  sealedColumnsSelect,
  sealedFromColumns,
  type SecretsKeyring,
} from './secrets-at-rest/index.ts';
import type { SecureSessionClient } from './secure-session.ts';
import {
  grantCopyBinding,
  SEALED_COLUMN_VALUES,
  UserKeyError,
  userKeyBinding,
} from './user-keys.ts';

// Grants: where a user's key may be sent. A key holds its secret and nothing
// about where it goes; each destination its owner approves for it is a grant.
// One key serves several hosts, or several path prefixes on one host, through
// one grant each, and its secret is entered once.
//
// A grant stores the destination it was approved for, read from the
// operation's lowered declaration in the definition cache when it is created.
// Nothing reads the operation again to send under it, so editing a
// declaration afterwards can't move where a key goes.
//
// Each grant holds its own sealed copy of the key's value, bound to the grant,
// the key and the destination (`grantCopyBinding`). Creating a grant is the
// only place a key's master copy is opened to make a copy of it (the data-key
// re-seal pass also opens every sealed row, to seal it again under its own
// binding); sending opens only a grant's copy, under the destination stored on
// the grant. A grant row written outside the
// realm server, or one whose key or destination is edited, has no copy that
// opens, so it sends nothing.
//
// Creating or removing a grant takes a session signed in on the secure origin;
// the routes check that (`handle-user-key-grants.ts`) and record which client
// it was as `approvedVia`.

export type UserKeyGrantState = 'active';

export interface UserKeyGrant {
  id: string;
  keyId: string;
  destination: string;
  state: UserKeyGrantState;
  approvedAt: string;
  approvedVia: SecureSessionClient;
}

const GRANT_COLUMNS = `id, key_id, destination, state, approved_at, approved_via`;

function toGrant(row: Record<string, unknown>): UserKeyGrant {
  return {
    id: row.id as string,
    keyId: row.key_id as string,
    destination: row.destination as string,
    state: row.state as UserKeyGrantState,
    approvedAt: new Date(row.approved_at as string).toISOString(),
    approvedVia: row.approved_via as SecureSessionClient,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A destination as a grant stores it: the URL parser's `href` of an `https:`
// (or `http:`, which the outbound guard refuses to send to unless its host is
// on the development allowlist) origin and a path prefix ending in `/`, with
// no user info, query or fragment, naming exactly one host. Two spellings of
// one place normalize alike, so they are one grant.
export function normalizeGrantDestination(destination: unknown): string {
  if (typeof destination !== 'string') {
    throw new UserKeyError(400, 'a destination is an absolute URL');
  }
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    throw new UserKeyError(400, 'a destination is an absolute URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UserKeyError(400, 'a destination is an https or http URL');
  }
  if (url.username || url.password) {
    throw new UserKeyError(400, 'a destination carries no user info');
  }
  if (url.href.includes('?') || url.href.includes('#')) {
    throw new UserKeyError(400, 'a destination has no query or fragment');
  }
  if (!url.pathname.endsWith('/')) {
    throw new UserKeyError(400, 'a destination’s path ends with /');
  }
  if (url.hostname.includes('*')) {
    throw new UserKeyError(
      400,
      'a destination names one host: a host wildcard is refused',
    );
  }
  if (url.hostname.endsWith('.')) {
    throw new UserKeyError(400, 'a destination’s host has no trailing dot');
  }
  return url.href;
}

// The destination a grant for this operation stores: its lowered `callApi`
// destination. An operation that sends no request, or whose declaration has
// problems, has none.
export function operationGrantDestination(
  operation: OperationDefinition | undefined,
): string {
  if (!operation) {
    throw new UserKeyError(404, 'no such operation');
  }
  if (operation.base !== 'callApi' || !operation.callApi) {
    throw new UserKeyError(
      400,
      'the operation sends no request, so no key is sent with it',
    );
  }
  if (operation.invalid) {
    throw new UserKeyError(
      400,
      'the operation’s declaration has problems, so it sends nothing',
    );
  }
  return normalizeGrantDestination(operation.callApi.destination);
}

// Reads an operation from the realm's definition cache: the type `codeRef`
// names, resolved against the realm, and its own operation of that name. The
// definition lookup reads a module from any realm this server serves, on the
// server's own authority, so the module's own realm must be one `caller` may
// read, as a named query's type must be: a module in a realm they can't read,
// or in none this server serves, answers as no operation, and its destination
// is never disclosed.
export async function lookupGrantOperation(
  core: Pick<
    OperationCore,
    'resolveCodeRef' | 'definitionLookup' | 'readsRealmOf'
  >,
  realmURL: URL,
  codeRef: CodeRef,
  operationName: string,
  caller: string,
): Promise<OperationDefinition | undefined> {
  let resolved = core.resolveCodeRef(codeRef, realmURL);
  if (!resolved || !core.readsRealmOf) {
    return undefined;
  }
  let served;
  try {
    served = await core.readsRealmOf(resolved.module, {
      kind: 'user',
      actor: caller,
    });
  } catch {
    return undefined;
  }
  if (!served?.read) {
    return undefined;
  }
  let operations;
  try {
    operations = (await core.definitionLookup.lookupDefinition(resolved))
      ?.operations;
  } catch {
    return undefined;
  }
  return operations && Object.hasOwn(operations, operationName)
    ? operations[operationName]
    : undefined;
}

// The key's grants, by destination. Another user's key answers as one with
// none.
export async function listKeyGrants(
  dbAdapter: DBAdapter,
  owner: string,
  keyId: string,
): Promise<UserKeyGrant[]> {
  if (!UUID.test(keyId)) {
    return [];
  }
  let rows = await query(dbAdapter, [
    `SELECT ${GRANT_COLUMNS} FROM user_key_grants WHERE key_id = `,
    param(keyId),
    ` AND owner = `,
    param(owner),
    ` ORDER BY destination`,
  ]);
  return rows.map(toGrant);
}

// Every grant of the owner's keys, by key.
export async function listOwnerGrants(
  dbAdapter: DBAdapter,
  owner: string,
): Promise<Map<string, UserKeyGrant[]>> {
  let rows = await query(dbAdapter, [
    `SELECT ${GRANT_COLUMNS} FROM user_key_grants WHERE owner = `,
    param(owner),
    ` ORDER BY key_id, destination`,
  ]);
  let byKey = new Map<string, UserKeyGrant[]>();
  for (let grant of rows.map(toGrant)) {
    let grants = byKey.get(grant.keyId) ?? [];
    grants.push(grant);
    byKey.set(grant.keyId, grants);
  }
  return byKey;
}

// The key's grant that covers `destination`, or a new one for it. A grant
// covers a destination when the destination starts with the grant's, compared
// as normalized `href`s (`destinationCovers`, the rule sending applies too), so
// a grant for `https://api.example.com/v1/` covers an operation sending under
// `https://api.example.com/v1/chat/` and not one under
// `https://api.example.com/v1beta/`. Of several that cover it, the one with the
// longest destination is used.
//
// A new grant's copy is sealed from the key's master copy, opened here and
// nowhere else, in the same transaction that inserts the grant. The key's row
// is locked first, so a concurrent replace either finishes before this reads
// the master copy or waits and then re-seals the new grant too.
export async function createOrReuseGrant(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  {
    owner,
    keyId,
    destination,
    via,
  }: {
    owner: string;
    keyId: string;
    destination: unknown;
    via: SecureSessionClient;
  },
): Promise<{ grant: UserKeyGrant; created: boolean }> {
  let normalized = normalizeGrantDestination(destination);
  if (!UUID.test(keyId)) {
    throw new UserKeyError(404, 'no such key');
  }
  return await dbAdapter.withTransaction(async (txQuery) => {
    let [key] = await txQuery([
      `SELECT ${sealedColumnsSelect('value')} FROM user_keys WHERE id = `,
      param(keyId),
      ` AND owner = `,
      param(owner),
      ` FOR UPDATE`,
    ]);
    if (!key) {
      throw new UserKeyError(404, 'no such key');
    }
    let grants = (
      await txQuery([
        `SELECT ${GRANT_COLUMNS} FROM user_key_grants WHERE key_id = `,
        param(keyId),
        ` AND owner = `,
        param(owner),
      ])
    ).map(toGrant);
    let covering = grants
      .filter(
        (grant) =>
          grant.state === 'active' &&
          destinationCovers(grant.destination, normalized),
      )
      .sort((a, b) => b.destination.length - a.destination.length)[0];
    if (covering) {
      return { grant: covering, created: false };
    }
    let master = sealedFromColumns(key, 'value');
    if (!master) {
      throw new Error(`key ${keyId} holds no sealed value`);
    }
    let value = keyring.open(master, userKeyBinding(owner, keyId));
    let grantId = randomUUID();
    let copy = keyring.seal(
      value,
      grantCopyBinding({ owner, keyId, grantId, destination: normalized }),
    );
    let [row] = await txQuery([
      `INSERT INTO user_key_grants (id, key_id, owner, destination, state, approved_via, value_ciphertext, value_nonce, value_tag, value_key_id) VALUES (`,
      param(grantId),
      `, `,
      param(keyId),
      `, `,
      param(owner),
      `, `,
      param(normalized),
      `, 'active', `,
      param(via),
      `, `,
      ...SEALED_COLUMN_VALUES(copy),
      `) RETURNING ${GRANT_COLUMNS}`,
    ]);
    return { grant: toGrant(row), created: true };
  });
}

// `createOrReuseGrant` for the destination an operation in a realm sends to,
// read from the realm's definition cache.
export async function createOrReuseGrantForOperation(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  {
    core,
    realmURL,
    codeRef,
    operationName,
    owner,
    keyId,
    via,
  }: {
    core: Pick<
      OperationCore,
      'resolveCodeRef' | 'definitionLookup' | 'readsRealmOf'
    >;
    realmURL: URL;
    codeRef: CodeRef;
    operationName: string;
    owner: string;
    keyId: string;
    via: SecureSessionClient;
  },
): Promise<{ grant: UserKeyGrant; created: boolean }> {
  let destination = operationGrantDestination(
    await lookupGrantOperation(core, realmURL, codeRef, operationName, owner),
  );
  return await createOrReuseGrant(dbAdapter, keyring, {
    owner,
    keyId,
    destination,
    via,
  });
}

// Opens a grant's copy of its key's value for sending, under the destination
// stored on the grant, and answers with that destination beside it. It reads
// only the grant: never the key's master copy and never the operation. A copy
// that doesn't open throws `SecretDecryptionError`, which names none of its
// inputs.
export async function openGrantForSending(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  { owner, grantId }: { owner: string; grantId: string },
): Promise<{ keyId: string; destination: string; value: string }> {
  if (!UUID.test(grantId)) {
    throw new UserKeyError(404, 'no such grant');
  }
  let [row] = await query(dbAdapter, [
    `SELECT key_id, owner, destination, ${sealedColumnsSelect('value')} FROM user_key_grants WHERE id = `,
    param(grantId),
    ` AND owner = `,
    param(owner),
    ` AND state = 'active'`,
  ]);
  if (!row) {
    throw new UserKeyError(404, 'no such grant');
  }
  let copy = sealedFromColumns(row, 'value');
  if (!copy) {
    throw new Error(`grant ${grantId} holds no sealed value`);
  }
  let keyId = row.key_id as string;
  let destination = row.destination as string;
  let value = keyring.open(
    copy,
    grantCopyBinding({
      owner: row.owner as string,
      keyId,
      grantId,
      destination,
    }),
  );
  return { keyId, destination, value };
}

// Removes one of the owner's grants, and answers with the bindings that sent
// under it, which go with it. No binding sends under a grant, so the list is
// empty. Another user's grant answers as one that doesn't exist.
export async function removeGrant(
  dbAdapter: DBAdapter,
  { owner, grantId }: { owner: string; grantId: string },
): Promise<{ revokedBindings: string[] }> {
  if (!UUID.test(grantId)) {
    throw new UserKeyError(404, 'no such grant');
  }
  let rows = await query(dbAdapter, [
    `DELETE FROM user_key_grants WHERE id = `,
    param(grantId),
    ` AND owner = `,
    param(owner),
    ` RETURNING id`,
  ]);
  if (rows.length === 0) {
    throw new UserKeyError(404, 'no such grant');
  }
  return { revokedBindings: [] };
}
