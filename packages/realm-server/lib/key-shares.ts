import { randomUUID } from 'node:crypto';
import {
  isDirectWriterLocked,
  param,
  query,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { Querier } from '@cardstack/runtime-common/expression';
import { isUserOfMatrixServer } from '@cardstack/runtime-common/matrix-server-name';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { consumeKeyWriteTicket, UserKeyError } from './user-keys.ts';
import { moveShareBindingsIn } from './key-bindings.ts';
import { matrixServerNameFromEnv } from '../utils/matrix-server-name.ts';
import type { SecretsKeyring } from './secrets-at-rest/index.ts';
import type { SecureSessionClient } from './secure-session.ts';

// Shares: a key its owner has put into a realm for other people there to
// consume. A share holds no secret, only the key it refers to, so one key may
// be shared into several realms and its value is stored once.
//
// Who may do what:
//
// - Only a key's owner shares it, and only into a realm where they are a
//   direct writer (`isDirectWriter`). Sharing takes a key write ticket for
//   that key and that realm.
// - Only a share's owner unshares it, whether or not they still write the
//   realm: withdrawing one's own key needs no write.
// - Any direct writer of the realm suspends an active share. Any direct writer
//   lifts a suspension a direct writer made, with a key write ticket for that
//   share: lifting one puts a key back into use.
// - Any direct writer of the realm swaps one of their own keys into a
//   suspended share, which makes them its owner and resumes it. Swapping takes
//   a key write ticket for that key and that share. Nobody swaps in another
//   user's key.
// - A share's owner sees all of their shares, in every realm. A realm's direct
//   writers see its shares, with owner and state, and the notices recorded
//   when one is suspended, with the owner and suspender named only while a
//   permission row in the realm names them. Nobody else sees anything of a
//   realm's shares.
//
// Suspensions that follow from other changes are made by triggers on the
// tables those changes write (see the migration that adds `key_shares`), so
// they hold however the change is made: a share is suspended when its owner
// stops being a direct writer of the realm, and resumes when they are one
// again; and it is suspended, keeping its place, when its key is deleted.
// Every share going from active to suspended records a notice, as does a
// suspended share whose key is deleted. Deleting a realm deletes its shares.
//
// Every check that a person is a direct writer runs inside the change's
// transaction with their permission row locked (`isDirectWriterLocked`), so a
// concurrent removal of their write waits for the change to commit and then
// suspends what it made.

export type KeyShareState = 'active' | 'suspended';

export type KeyShareSuspensionReason =
  | 'owner-lost-write'
  | 'suspended-by-writer'
  | 'key-deleted';

export interface KeyShare {
  id: string;
  realm: string;
  label: string;
  // Null in a writer's view once no permission row in the realm names the
  // owner (see `withholdUnnamed`); a share's owner always sees their own id.
  owner: string | null;
  // The key the share holds; given only to the share's owner, and null once
  // the key is deleted.
  keyId?: string | null;
  state: KeyShareState;
  suspensionReason: KeyShareSuspensionReason | null;
  // Null when no writer suspended the share, or once permission rows in the
  // realm no longer name both the viewer and the one who did.
  suspendedBy: string | null;
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // In a realm's listing: the operations the share is approved for there,
  // one per binding, so the realm's writers see what each share is used by.
  operations?: KeyShareOperation[];
}

export interface KeyShareOperation {
  bindingId: string;
  type: { module: string; name: string };
  operation: string;
  instance: string | null;
  slot: string;
  state: 'active' | 'needs-reapproval' | 'suspended';
}

export interface KeyShareNotice {
  id: string;
  shareId: string;
  realm: string;
  label: string;
  // Null, as is `suspendedBy`, once no permission row in the realm names them.
  owner: string | null;
  reason: KeyShareSuspensionReason;
  suspendedBy: string | null;
  createdAt: string;
}

// The most notices a realm's listing returns, newest first.
export const MAX_KEY_SHARE_NOTICES = 100;

const SHARE_COLUMNS = `id, realm_url, label, owner, key_id, state, suspension_reason, suspended_by, suspended_at, created_at, updated_at`;

function iso(value: unknown): string | null {
  return value == null ? null : new Date(value as string).toISOString();
}

function toShare(
  row: Record<string, unknown>,
  { withKey }: { withKey: boolean },
): KeyShare {
  return {
    id: row.id as string,
    realm: row.realm_url as string,
    label: row.label as string,
    owner: (row.owner as string | null) ?? null,
    ...(withKey ? { keyId: (row.key_id as string | null) ?? null } : {}),
    state: row.state as KeyShareState,
    suspensionReason:
      (row.suspension_reason as KeyShareSuspensionReason | null) ?? null,
    suspendedBy: (row.suspended_by as string | null) ?? null,
    suspendedAt: iso(row.suspended_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

// Share or notice rows as `viewer` may see them: `owner` and `suspended_by`
// are null except for the viewer's own id and the ids of people who, with the
// viewer, are named by a permission row in the row's realm. A person's Matrix
// id is shown only to people who share a realm with them (ADR 011 §1.1, §1.2),
// and a share and its notices outlive their owner's and their suspender's
// rows. A `*` or `users` row, or a policy grant, names no one; a row granting
// nothing is deleted, so any row names its user.
async function withholdUnnamed(
  txQuery: Querier,
  viewer: string,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  let realms = [...new Set(rows.map((row) => row.realm_url as string))];
  let ids = [
    ...new Set([
      viewer,
      ...rows.flatMap((row) =>
        [row.owner, row.suspended_by].filter(
          (id): id is string => typeof id === 'string',
        ),
      ),
    ]),
  ];
  if (ids.length === 1) {
    return rows;
  }
  let list = (values: string[]) =>
    values.flatMap((value, i) => [...(i > 0 ? [', '] : []), param(value)]);
  let named = new Set(
    (
      await txQuery([
        `SELECT realm_url, username FROM realm_user_permissions WHERE realm_url IN (`,
        ...list(realms),
        `) AND username IN (`,
        ...list(ids),
        `)`,
      ])
    ).map((row) => `${row.realm_url}\n${row.username}`),
  );
  return rows.map((row) => {
    let realm = row.realm_url as string;
    let shown = (id: unknown) =>
      typeof id === 'string' &&
      (id === viewer ||
        (named.has(`${realm}\n${viewer}`) && named.has(`${realm}\n${id}`)))
        ? id
        : null;
    return {
      ...row,
      owner: shown(row.owner),
      suspended_by: shown(row.suspended_by),
    };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function noSuchShare() {
  return new UserKeyError(404, 'no such share');
}

function noSuchKey() {
  return new UserKeyError(404, 'no such key');
}

function notADirectWriter() {
  return new UserKeyError(
    403,
    'only a direct writer of the realm can do this to its shares',
  );
}

export function validateRealm(realm: unknown): URL {
  let realmURL = typeof realm === 'string' ? normalizeRealmURL(realm) : null;
  if (!realmURL) {
    throw new UserKeyError(400, 'a share names the realm it is in');
  }
  return realmURL;
}

export const MAX_KEY_SHARE_LABEL_LENGTH = 100;

export function validateShareLabel(label: unknown): string {
  let trimmed = typeof label === 'string' ? label.trim() : '';
  if (trimmed.length === 0) {
    throw new UserKeyError(400, 'a share needs a label');
  }
  if (trimmed.length > MAX_KEY_SHARE_LABEL_LENGTH) {
    throw new UserKeyError(
      400,
      `a share's label is at most ${MAX_KEY_SHARE_LABEL_LENGTH} characters`,
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new UserKeyError(
      400,
      `a share's label can't contain control characters`,
    );
  }
  return trimmed;
}

// Locks are taken in the order the triggers take them: permission rows, then
// the key, then the share. A permission change locks its row and then,
// through its trigger, every share the person holds in that realm, waiting
// out any change to one before deciding what to suspend or resume. A row
// that doesn't exist can't be locked, so that wait is what keeps a resume
// and the person's write being granted from missing each other. Deleting a
// key locks the key and then the shares holding it. Taking a share before a
// row either of them holds would deadlock against them.

// Whether each of `users` is a direct writer of the realm, with their
// permission rows locked in username order, so two changes locking the same
// rows can't wait on each other.
async function lockDirectWriters(
  txQuery: Querier,
  realmURL: URL,
  users: string[],
): Promise<Map<string, boolean>> {
  let writers = new Map<string, boolean>();
  for (let user of [...new Set(users)].sort()) {
    writers.set(
      user,
      await isDirectWriterLocked(
        txQuery,
        realmURL,
        user,
        matrixServerNameFromEnv(),
      ),
    );
  }
  return writers;
}

// The user's own key, locked against a concurrent delete until the caller's
// transaction ends. Another user's key answers as one that doesn't exist.
async function lockOwnKey(
  txQuery: Querier,
  owner: string,
  keyId: string,
): Promise<void> {
  let rows = await txQuery([
    `SELECT kind FROM user_keys WHERE id = `,
    param(keyId),
    ` AND owner = `,
    param(owner),
    ` FOR SHARE`,
  ]);
  if (rows.length === 0) {
    throw noSuchKey();
  }
  // An OAuth connection is one person's sign-in at the vendor, so it serves
  // only its owner's own calls. Teammates share the client and each connect
  // their own account through it.
  if (rows[0].kind === 'oauth-connection') {
    throw new UserKeyError(
      400,
      "a connection is its owner's own sign-in and is never shared: share the OAuth client, and each teammate connects through it",
    );
  }
}

// The share, locked for the caller's change, if `user` may see it: as its
// owner, or as a direct writer of its realm. Any other share answers as one
// that doesn't exist. The user's permission row is locked first, and with
// `withOwner` the share's owner's too; with `ownKeyId`, the user's key is
// locked next. A swap made between reading the share's owner and locking the
// share changes the owner, so the locks are taken again for the new one.
async function lockVisibleShare(
  txQuery: Querier,
  user: string,
  shareId: string,
  {
    withOwner = false,
    ownKeyId,
  }: { withOwner?: boolean; ownKeyId?: string } = {},
): Promise<{
  row: Record<string, unknown>;
  isWriter: boolean;
  ownerIsWriter: boolean;
}> {
  if (!isUUID(shareId)) {
    throw noSuchShare();
  }
  for (;;) {
    let [current] = await txQuery([
      `SELECT realm_url, owner FROM key_shares WHERE id = `,
      param(shareId),
    ]);
    if (!current) {
      throw noSuchShare();
    }
    let owner = current.owner as string;
    let writers = await lockDirectWriters(
      txQuery,
      new URL(current.realm_url as string),
      withOwner ? [user, owner] : [user],
    );
    if (ownKeyId !== undefined) {
      await lockOwnKey(txQuery, user, ownKeyId);
    }
    let [row] = await txQuery([
      `SELECT ${SHARE_COLUMNS} FROM key_shares WHERE id = `,
      param(shareId),
      ` FOR UPDATE`,
    ]);
    if (!row) {
      throw noSuchShare();
    }
    if (withOwner && row.owner !== owner) {
      continue;
    }
    let isWriter = writers.get(user)!;
    if (!isWriter && row.owner !== user) {
      throw noSuchShare();
    }
    return { row, isWriter, ownerIsWriter: writers.get(owner) ?? false };
  }
}

export async function shareKey(
  dbAdapter: DBAdapter,
  {
    owner,
    realm,
    keyId,
    label,
    ticket,
  }: {
    owner: string;
    realm: unknown;
    keyId: unknown;
    label: unknown;
    ticket: unknown;
  },
): Promise<KeyShare> {
  let realmURL = validateRealm(realm);
  let validLabel = validateShareLabel(label);
  if (keyId === undefined || keyId === null) {
    throw new UserKeyError(400, 'a share names the key it holds');
  }
  if (!isUUID(keyId)) {
    throw noSuchKey();
  }
  let id = randomUUID();
  return await dbAdapter.withTransaction(async (txQuery) => {
    await consumeKeyWriteTicket(txQuery, owner, ticket, {
      action: 'share',
      keyId,
      realmURL: realmURL.href,
      shareId: null,
    });
    if (
      !(await isDirectWriterLocked(
        txQuery,
        realmURL,
        owner,
        matrixServerNameFromEnv(),
      ))
    ) {
      throw new UserKeyError(
        403,
        'a key is shared only into a realm its owner is a direct writer of',
      );
    }
    await lockOwnKey(txQuery, owner, keyId);
    let [row] = await txQuery([
      `INSERT INTO key_shares (id, realm_url, label, owner, key_id, state) VALUES (`,
      param(id),
      `, `,
      param(realmURL.href),
      `, `,
      param(validLabel),
      `, `,
      param(owner),
      `, `,
      param(keyId),
      `, 'active') ON CONFLICT (realm_url, label) DO NOTHING RETURNING ${SHARE_COLUMNS}`,
    ]);
    if (!row) {
      throw new UserKeyError(
        409,
        `the realm already has a share labelled ${validLabel}`,
      );
    }
    return toShare(row, { withKey: true });
  });
}

export async function unshareKey(
  dbAdapter: DBAdapter,
  { user, shareId }: { user: string; shareId: string },
): Promise<void> {
  await dbAdapter.withTransaction(async (txQuery) => {
    let { row } = await lockVisibleShare(txQuery, user, shareId);
    if (row.owner !== user) {
      throw new UserKeyError(403, 'only its owner unshares a share');
    }
    await txQuery([`DELETE FROM key_shares WHERE id = `, param(shareId)]);
  });
}

// A direct writer suspends an active share, for abuse or any other reason of
// theirs. The realm's direct writers get a notice of it. Suspending takes no
// ticket: it only stops a key being used.
export async function suspendShare(
  dbAdapter: DBAdapter,
  { user, shareId }: { user: string; shareId: string },
): Promise<KeyShare> {
  return await dbAdapter.withTransaction(async (txQuery) => {
    let { row, isWriter } = await lockVisibleShare(txQuery, user, shareId);
    if (!isWriter) {
      throw notADirectWriter();
    }
    if (row.state !== 'active') {
      throw new UserKeyError(409, 'the share is already suspended');
    }
    let [updated] = await txQuery([
      `UPDATE key_shares SET state = 'suspended', suspension_reason = 'suspended-by-writer', suspended_by = `,
      param(user),
      `, suspended_at = NOW(), updated_at = NOW() WHERE id = `,
      param(shareId),
      ` RETURNING ${SHARE_COLUMNS}`,
    ]);
    let [shown] = await withholdUnnamed(txQuery, user, [updated]);
    return toShare(shown, { withKey: shown.owner === user });
  });
}

// A direct writer lifts a suspension a direct writer made, with a key write
// ticket for that share: lifting one puts a key back into use, which card
// code in the writer's app page must not be able to do. If the share's owner
// is no longer a direct writer, the share stays suspended for that reason
// instead, and resumes when they are one again.
export async function resumeShare(
  dbAdapter: DBAdapter,
  { user, shareId, ticket }: { user: string; shareId: string; ticket: unknown },
): Promise<KeyShare> {
  if (!isUUID(shareId)) {
    throw noSuchShare();
  }
  return await dbAdapter.withTransaction(async (txQuery) => {
    await consumeKeyWriteTicket(txQuery, user, ticket, {
      action: 'resume',
      keyId: null,
      realmURL: null,
      shareId,
    });
    let { row, isWriter, ownerIsWriter } = await lockVisibleShare(
      txQuery,
      user,
      shareId,
      { withOwner: true },
    );
    if (!isWriter) {
      throw notADirectWriter();
    }
    if (row.suspension_reason !== 'suspended-by-writer') {
      throw new UserKeyError(
        409,
        row.state === 'active'
          ? 'the share is not suspended'
          : 'only a suspension a writer made is lifted; swap a key in instead',
      );
    }
    let [updated] = await txQuery([
      ownerIsWriter
        ? `UPDATE key_shares SET state = 'active', suspension_reason = NULL, suspended_at = NULL`
        : `UPDATE key_shares SET suspension_reason = 'owner-lost-write'`,
      `, suspended_by = NULL, updated_at = NOW() WHERE id = `,
      param(shareId),
      ` RETURNING ${SHARE_COLUMNS}`,
    ]);
    let [shown] = await withholdUnnamed(txQuery, user, [updated]);
    return toShare(shown, { withKey: shown.owner === user });
  });
}

// A direct writer puts one of their own keys into a suspended share. They
// become its owner and it resumes; its label, and so every card that names
// it, is unchanged. Every operation approved for the share moves to the new
// key: the swap is the new owner's approval of each, so it grants the new key
// the destinations they send to, which takes a session signed in on the
// secure origin (`via`) when the share has any.
export async function swapKeyIntoShare(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  {
    user,
    shareId,
    keyId,
    ticket,
    via,
  }: {
    user: string;
    shareId: string;
    keyId: unknown;
    ticket: unknown;
    via: SecureSessionClient | undefined;
  },
): Promise<{ share: KeyShare; reapprovedBindings: string[] }> {
  if (keyId === undefined || keyId === null) {
    throw new UserKeyError(400, 'a swap names the key it puts in');
  }
  if (!isUUID(keyId)) {
    throw noSuchKey();
  }
  if (!isUUID(shareId)) {
    throw noSuchShare();
  }
  return await dbAdapter.withTransaction(async (txQuery) => {
    await consumeKeyWriteTicket(txQuery, user, ticket, {
      action: 'swap',
      keyId,
      realmURL: null,
      shareId,
    });
    let { row, isWriter } = await lockVisibleShare(txQuery, user, shareId, {
      ownKeyId: keyId,
    });
    if (!isWriter) {
      throw notADirectWriter();
    }
    if (row.state !== 'suspended') {
      throw new UserKeyError(409, 'only a suspended share takes another key');
    }
    let [updated] = await txQuery([
      `UPDATE key_shares SET owner = `,
      param(user),
      `, key_id = `,
      param(keyId),
      `, state = 'active', suspension_reason = NULL, suspended_by = NULL, suspended_at = NULL, updated_at = NOW() WHERE id = `,
      param(shareId),
      ` RETURNING ${SHARE_COLUMNS}`,
    ]);
    let reapprovedBindings = await moveShareBindingsIn(txQuery, keyring, {
      shareId,
      keyId,
      owner: user,
      via,
    });
    return { share: toShare(updated, { withKey: true }), reapprovedBindings };
  });
}

// The user's own shares, in every realm, by realm and label. With `keyId`,
// only the shares holding that key: the ones deleting it would suspend.
export async function listOwnShares(
  dbAdapter: DBAdapter,
  owner: string,
  { keyId }: { keyId?: string } = {},
): Promise<KeyShare[]> {
  if (keyId !== undefined && !isUUID(keyId)) {
    return [];
  }
  let rows = await withholdUnnamed(
    (expression) => query(dbAdapter, expression),
    owner,
    await query(dbAdapter, [
      `SELECT ${SHARE_COLUMNS} FROM key_shares WHERE owner = `,
      param(owner),
      ...(keyId !== undefined ? [` AND key_id = `, param(keyId)] : []),
      ` ORDER BY realm_url, label`,
    ]),
  );
  return rows.map((row) => toShare(row, { withKey: true }));
}

// A realm one of the user's keys is shared into: its address, its name as its
// `realm.json` gives it, and the key's shares there. The name is null when
// the user can't read the realm by a permission row of their own or a public
// one (`*`, `users`), as after they are removed from it, and while its
// `realm.json` isn't indexed. A share outlives its owner's access, so the
// address is all an owner who can no longer read the realm keeps of it.
export interface SharedRealm {
  url: string;
  name: string | null;
  shares: { id: string; label: string; state: KeyShareState }[];
}

// The realms each of the user's keys is shared into, by key id, each realm
// once with every share that puts the key there, by name and then address.
// These are the shares `listOwnShares` lists, read for every key at once.
// With `keyId`, only that key's. `matrixServerName` names the paired
// homeserver.
export async function listOwnSharedRealms(
  dbAdapter: DBAdapter,
  owner: string,
  { keyId, matrixServerName }: { keyId?: string; matrixServerName: string },
): Promise<Map<string, SharedRealm[]>> {
  let byKey = new Map<string, SharedRealm[]>();
  if (keyId !== undefined && !isUUID(keyId)) {
    return byKey;
  }
  // A realm's name is shown to an owner who may read the realm: through its
  // `*` row, their own row, or its `users` row, which grants only to users of
  // the paired homeserver (ADR 004 §1.4).
  let readingRows = isUserOfMatrixServer(owner, matrixServerName)
    ? `'*', 'users', ks.owner`
    : `'*', ks.owner`;
  let rows = (await query(dbAdapter, [
    `SELECT ks.id, ks.label, ks.state, ks.key_id, ks.realm_url,
            (SELECT config.pristine_doc->'attributes'->'cardInfo'->>'name'
             FROM boxel_index config
             WHERE config.url = ks.realm_url || 'realm.json'
               AND config.realm_url = ks.realm_url
               AND config.type = 'instance'
               AND (config.is_deleted = FALSE OR config.is_deleted IS NULL)
               AND EXISTS (
                 SELECT 1 FROM realm_user_permissions rup
                 WHERE rup.realm_url = ks.realm_url
                   AND rup.read = true
                   AND rup.username IN (${readingRows}))
             LIMIT 1) AS name
     FROM key_shares ks
     WHERE ks.key_id IS NOT NULL AND ks.owner = `,
    param(owner),
    ...(keyId !== undefined ? [` AND ks.key_id = `, param(keyId)] : []),
    ` ORDER BY ks.key_id, ks.realm_url, ks.label`,
  ])) as {
    id: string;
    label: string;
    state: KeyShareState;
    key_id: string;
    realm_url: string;
    name: string | null;
  }[];
  for (let { id, label, state, key_id, realm_url, name } of rows) {
    let realms = byKey.get(key_id) ?? [];
    let realm = realms.find((r) => r.url === realm_url);
    if (!realm) {
      realm = { url: realm_url, name, shares: [] };
      realms.push(realm);
    }
    realm.shares.push({ id, label, state });
    byKey.set(key_id, realms);
  }
  for (let realms of byKey.values()) {
    realms.sort(
      (a, b) =>
        (a.name ?? '').localeCompare(b.name ?? '') ||
        a.url.localeCompare(b.url),
    );
  }
  return byKey;
}

// Reads `realm`'s rows for one of its direct writers, with their permission
// row locked for the read, so write removed meanwhile can't let them read on.
async function readAsDirectWriter(
  dbAdapter: DBAdapter,
  user: string,
  realm: unknown,
  read: (txQuery: Querier, realmURL: URL) => Promise<Record<string, unknown>[]>,
): Promise<Record<string, unknown>[]> {
  let realmURL = validateRealm(realm);
  return await dbAdapter.withTransaction(async (txQuery) => {
    if (
      !(await isDirectWriterLocked(
        txQuery,
        realmURL,
        user,
        matrixServerNameFromEnv(),
      ))
    ) {
      throw new UserKeyError(
        403,
        `only a realm's direct writers see its shares`,
      );
    }
    return await read(txQuery, realmURL);
  });
}

// A realm's shares, by label, for one of its direct writers.
export async function listRealmShares(
  dbAdapter: DBAdapter,
  user: string,
  realm: unknown,
): Promise<KeyShare[]> {
  let rows = await readAsDirectWriter(
    dbAdapter,
    user,
    realm,
    async (txQuery, realmURL) =>
      await withholdUnnamed(
        txQuery,
        user,
        await txQuery([
          `SELECT ${SHARE_COLUMNS} FROM key_shares WHERE realm_url = `,
          param(realmURL.href),
          ` ORDER BY label`,
        ]),
      ),
  );
  let operations = new Map<string, KeyShareOperation[]>();
  if (rows.length > 0) {
    let bindings = await query(dbAdapter, [
      `SELECT id, share_id, definition_url, export_name, operation_name, instance_url, slot, state FROM key_bindings WHERE share_id IN (`,
      ...rows.flatMap((row, i) => [
        ...(i > 0 ? [', '] : []),
        param(row.id as string),
      ]),
      `) ORDER BY definition_url, export_name, operation_name, instance_url NULLS FIRST, slot`,
    ]);
    for (let binding of bindings) {
      let shareId = binding.share_id as string;
      let list = operations.get(shareId) ?? [];
      list.push({
        bindingId: binding.id as string,
        type: {
          module: binding.definition_url as string,
          name: binding.export_name as string,
        },
        operation: binding.operation_name as string,
        instance: (binding.instance_url as string | null) ?? null,
        slot: binding.slot as string,
        state: binding.state as KeyShareOperation['state'],
      });
      operations.set(shareId, list);
    }
  }
  return rows.map((row) => ({
    ...toShare(row, { withKey: row.owner === user }),
    operations: operations.get(row.id as string) ?? [],
  }));
}

// The notices recorded when one of a realm's shares was suspended, or when
// deleting its key changed why it is suspended, newest first, for one of its
// direct writers.
export async function listRealmShareNotices(
  dbAdapter: DBAdapter,
  user: string,
  realm: unknown,
): Promise<KeyShareNotice[]> {
  let rows = await readAsDirectWriter(
    dbAdapter,
    user,
    realm,
    async (txQuery, realmURL) =>
      await withholdUnnamed(
        txQuery,
        user,
        await txQuery([
          `SELECT id, share_id, realm_url, label, owner, reason, suspended_by, created_at FROM key_share_notices WHERE realm_url = `,
          param(realmURL.href),
          ` ORDER BY created_at DESC, id DESC LIMIT ${MAX_KEY_SHARE_NOTICES}`,
        ]),
      ),
  );
  return rows.map((row) => ({
    id: String(row.id),
    shareId: row.share_id as string,
    realm: row.realm_url as string,
    label: row.label as string,
    owner: (row.owner as string | null) ?? null,
    reason: row.reason as KeyShareSuspensionReason,
    suspendedBy: (row.suspended_by as string | null) ?? null,
    createdAt: iso(row.created_at)!,
  }));
}
