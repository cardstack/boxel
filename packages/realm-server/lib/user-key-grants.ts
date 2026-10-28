import { randomUUID } from 'node:crypto';
import {
  param,
  query,
  type DBAdapter,
  type Querier,
} from '@cardstack/runtime-common';
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
import { isOutboundDevAllowlisted } from './outbound/client.ts';
import type { SecureSessionClient } from './secure-session.ts';
import { revokeBindingsIn } from './key-binding-revocation.ts';
import {
  grantCopyBinding,
  opensUnder,
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
// The approval also names the destination its user was shown, and is refused
// when the operation no longer sends there, so an edit between showing it and
// approving it can't move where a key goes. Nothing reads the operation again
// to send under it, so neither can an edit afterwards.
//
// A destination is as broad as the operation's declaration makes it: the path
// up to its first `{name}` segment. When the first segment is a parameter
// (`https://storage.googleapis.com/{bucket}/…`), the destination is the whole
// host. It then covers every operation sending to that host, whatever path
// separates one tenant there from another.
//
// Each grant holds its own sealed copy of the key's value, bound to the grant,
// the key and the destination (`grantCopyBinding`). Creating a grant is the
// only place a key's master copy is opened to make a copy of it (the data-key
// re-seal pass also opens every sealed row, to seal it again under its own
// binding); sending opens only a grant's copy, under the destination stored on
// the grant. A grant row written outside the realm server, or one whose key or
// destination is edited, has no copy that opens, so it sends nothing. Nothing
// that reads grants takes such a row for one: it is never reused for an
// approval, and never sealed again when its key is replaced.
//
// Creating or removing a grant takes a session signed in on the secure origin;
// the routes check that (`handle-user-key-grants.ts`) and record which client
// it was as `approvedVia`.

// `rejected` when the vendor answered the key with 401 at this destination
// (see `key-grant-rejection.ts`).
export type UserKeyGrantState = 'active' | 'rejected';

export interface UserKeyGrant {
  id: string;
  keyId: string;
  destination: string;
  state: UserKeyGrantState;
  approvedAt: string;
  approvedVia: SecureSessionClient;
  // When the vendor rejected the key here; null while the grant is active.
  rejectedAt: string | null;
  // The latest 403 the vendor answered under the grant, which changes no
  // state: when, and from which host.
  vendorForbidden: { at: string; host: string } | null;
}

const GRANT_COLUMNS = `id, key_id, destination, state, approved_at, approved_via, rejected_at, last_forbidden_at, last_forbidden_host`;

function toGrant(row: Record<string, unknown>): UserKeyGrant {
  return {
    id: row.id as string,
    keyId: row.key_id as string,
    destination: row.destination as string,
    state: row.state as UserKeyGrantState,
    approvedAt: new Date(row.approved_at as string).toISOString(),
    approvedVia: row.approved_via as SecureSessionClient,
    rejectedAt: row.rejected_at
      ? new Date(row.rejected_at as string).toISOString()
      : null,
    vendorForbidden: row.last_forbidden_at
      ? {
          at: new Date(row.last_forbidden_at as string).toISOString(),
          host: row.last_forbidden_host as string,
        }
      : null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A destination as a grant stores it: the URL parser's `href` of an `https:`
// origin (or an `http:` one whose host is on the outbound guard's development
// allowlist, the only `http:` hosts it sends to) and a path prefix ending in
// `/`, with no user info, query or fragment, naming exactly one host. Two
// spellings of one place normalize alike, so they are one grant.
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
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && isOutboundDevAllowlisted(url.hostname))
  ) {
    throw new UserKeyError(400, 'a destination is an https URL');
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
// longest destination is used, of those whose copy opens: a row whose copy
// doesn't was not written by the realm server and is no grant.
//
// A new grant's copy is sealed from the key's master copy, opened here and
// nowhere else, in the same transaction that inserts the grant. The key's row
// is locked first, so a concurrent replace either finishes before this reads
// the master copy or waits and then re-seals the new grant too.
export async function createOrReuseGrant(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  args: {
    owner: string;
    keyId: string;
    destination: unknown;
    via: SecureSessionClient;
  },
): Promise<{ grant: UserKeyGrant; created: boolean }> {
  return await dbAdapter.withTransaction((txQuery) =>
    createOrReuseGrantIn(txQuery, keyring, args),
  );
}

// `createOrReuseGrant` in a transaction the caller holds, for a change that
// makes grants as one step of its own, such as swapping a key into a share.
export async function createOrReuseGrantIn(
  txQuery: Querier,
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
  let rows = await txQuery([
    `SELECT ${GRANT_COLUMNS}, ${sealedColumnsSelect('value')} FROM user_key_grants WHERE key_id = `,
    param(keyId),
    ` AND owner = `,
    param(owner),
  ]);
  let covering = rows
    .map((row) => ({ row, grant: toGrant(row) }))
    .filter(
      ({ grant }) =>
        grant.state === 'active' &&
        destinationCovers(grant.destination, normalized),
    )
    .sort((a, b) => b.grant.destination.length - a.grant.destination.length)
    .find(({ row, grant }) =>
      opensUnder(
        keyring,
        sealedFromColumns(row, 'value'),
        grantCopyBinding({
          owner,
          keyId,
          grantId: grant.id,
          destination: grant.destination,
        }),
      ),
    );
  if (covering) {
    return { grant: covering.grant, created: false };
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
}

// `createOrReuseGrant` for the destination an operation in a realm sends to,
// read from the realm's definition cache. `expectedDestination` is the one the
// approving user was shown; when the operation sends elsewhere now, nothing is
// approved and the caller shows the user the destination again.
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
    expectedDestination,
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
    expectedDestination: unknown;
    via: SecureSessionClient;
  },
): Promise<{ grant: UserKeyGrant; created: boolean }> {
  let expected = normalizeGrantDestination(expectedDestination);
  let destination = operationGrantDestination(
    await lookupGrantOperation(core, realmURL, codeRef, operationName, owner),
  );
  if (destination !== expected) {
    throw new UserKeyError(
      409,
      'the operation sends to another destination than the one approved; show it again',
    );
  }
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
// inputs. A rejected grant opens too, for the probe that may bring it back;
// whether a call may send under it is the caller's to decide.
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
    ` AND state IN ('active', 'rejected')`,
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
// under it, in every realm. They are revoked with it, each with a revocation
// recorded in its history, so a later call through one is refused
// `binding-not-approved`. Another user's grant answers as one that doesn't
// exist.
export async function removeGrant(
  dbAdapter: DBAdapter,
  {
    owner,
    grantId,
    via,
  }: { owner: string; grantId: string; via: SecureSessionClient },
): Promise<{ revokedBindings: string[] }> {
  if (!UUID.test(grantId)) {
    throw new UserKeyError(404, 'no such grant');
  }
  return await dbAdapter.withTransaction(async (txQuery) => {
    let [grant] = await txQuery([
      `SELECT id FROM user_key_grants WHERE id = `,
      param(grantId),
      ` AND owner = `,
      param(owner),
      ` FOR UPDATE`,
    ]);
    if (!grant) {
      throw new UserKeyError(404, 'no such grant');
    }
    let revokedBindings = await revokeBindingsIn(txQuery, {
      where: [`grant_id = `, param(grantId)],
      actor: owner,
      via,
    });
    await txQuery([`DELETE FROM user_key_grants WHERE id = `, param(grantId)]);
    return { revokedBindings };
  });
}
