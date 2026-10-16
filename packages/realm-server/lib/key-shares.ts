import { randomUUID } from 'node:crypto';
import {
  isDirectWriter,
  isDirectWriterLocked,
  param,
  query,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { Querier } from '@cardstack/runtime-common/expression';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { consumeKeyWriteTicket, UserKeyError } from './user-keys.ts';

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
// - Any direct writer of the realm suspends an active share, and lifts a
//   suspension a direct writer made.
// - Any direct writer of the realm swaps one of their own keys into a
//   suspended share, which makes them its owner and resumes it. Swapping takes
//   a key write ticket for that key and that share. Nobody swaps in another
//   user's key.
// - A share's owner sees all of their shares, in every realm. A realm's direct
//   writers see its shares, with owner and state, and the notices recorded
//   when one is suspended. Nobody else sees anything of a realm's shares.
//
// Suspensions that follow from other changes are made by triggers on the
// tables those changes write (see the migration that adds `key_shares`), so
// they hold however the change is made: a share is suspended when its owner
// stops being a direct writer of the realm, and resumes when they are one
// again; and it is suspended, keeping its place, when its key is deleted.
// Every share going from active to suspended records a notice.
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
  owner: string;
  // The key the share holds; given only to the share's owner, and null once
  // the key is deleted.
  keyId?: string | null;
  state: KeyShareState;
  suspensionReason: KeyShareSuspensionReason | null;
  suspendedBy: string | null;
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KeyShareNotice {
  id: string;
  shareId: string;
  realm: string;
  label: string;
  owner: string;
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
    owner: row.owner as string,
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// The user's own key, locked against a concurrent delete until the caller's
// transaction ends. Another user's key answers as one that doesn't exist.
async function lockOwnKey(
  txQuery: Querier,
  owner: string,
  keyId: unknown,
): Promise<string> {
  if (typeof keyId !== 'string' || !UUID.test(keyId)) {
    throw noSuchKey();
  }
  let rows = await txQuery([
    `SELECT id FROM user_keys WHERE id = `,
    param(keyId),
    ` AND owner = `,
    param(owner),
    ` FOR SHARE`,
  ]);
  if (rows.length === 0) {
    throw noSuchKey();
  }
  return keyId;
}

// The share, locked for the caller's change, if `user` may see it: as its
// owner, or as a direct writer of its realm. Any other share answers as one
// that doesn't exist.
async function lockVisibleShare(
  txQuery: Querier,
  user: string,
  shareId: string,
): Promise<{ row: Record<string, unknown>; isWriter: boolean }> {
  if (!UUID.test(shareId)) {
    throw noSuchShare();
  }
  let [row] = await txQuery([
    `SELECT ${SHARE_COLUMNS} FROM key_shares WHERE id = `,
    param(shareId),
    ` FOR UPDATE`,
  ]);
  if (!row) {
    throw noSuchShare();
  }
  let isWriter = await isDirectWriterLocked(
    txQuery,
    new URL(row.realm_url as string),
    user,
  );
  if (!isWriter && row.owner !== user) {
    throw noSuchShare();
  }
  return { row, isWriter };
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
  if (typeof keyId !== 'string') {
    throw new UserKeyError(400, 'a share names the key it holds');
  }
  let id = randomUUID();
  return await dbAdapter.withTransaction(async (txQuery) => {
    await consumeKeyWriteTicket(txQuery, owner, ticket, {
      action: 'share',
      keyId,
      realmURL: realmURL.href,
      shareId: null,
    });
    if (!(await isDirectWriterLocked(txQuery, realmURL, owner))) {
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
// theirs. The realm's direct writers get a notice of it.
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
    return toShare(updated, { withKey: updated.owner === user });
  });
}

// A direct writer lifts a suspension a direct writer made. If the share's
// owner is no longer a direct writer, the share stays suspended for that
// reason instead, and resumes when they are one again.
export async function resumeShare(
  dbAdapter: DBAdapter,
  { user, shareId }: { user: string; shareId: string },
): Promise<KeyShare> {
  return await dbAdapter.withTransaction(async (txQuery) => {
    let { row, isWriter } = await lockVisibleShare(txQuery, user, shareId);
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
    let ownerWrites = await isDirectWriterLocked(
      txQuery,
      new URL(row.realm_url as string),
      row.owner as string,
    );
    let [updated] = await txQuery([
      ownerWrites
        ? `UPDATE key_shares SET state = 'active', suspension_reason = NULL, suspended_at = NULL`
        : `UPDATE key_shares SET suspension_reason = 'owner-lost-write'`,
      `, suspended_by = NULL, updated_at = NOW() WHERE id = `,
      param(shareId),
      ` RETURNING ${SHARE_COLUMNS}`,
    ]);
    return toShare(updated, { withKey: updated.owner === user });
  });
}

// A direct writer puts one of their own keys into a suspended share. They
// become its owner and it resumes; its label, and so every card that names
// it, is unchanged.
export async function swapKeyIntoShare(
  dbAdapter: DBAdapter,
  {
    user,
    shareId,
    keyId,
    ticket,
  }: { user: string; shareId: string; keyId: unknown; ticket: unknown },
): Promise<KeyShare> {
  if (typeof keyId !== 'string') {
    throw new UserKeyError(400, 'a swap names the key it puts in');
  }
  return await dbAdapter.withTransaction(async (txQuery) => {
    await consumeKeyWriteTicket(txQuery, user, ticket, {
      action: 'swap',
      keyId,
      realmURL: null,
      shareId,
    });
    let { row, isWriter } = await lockVisibleShare(txQuery, user, shareId);
    if (!isWriter) {
      throw notADirectWriter();
    }
    if (row.state !== 'suspended') {
      throw new UserKeyError(409, 'only a suspended share takes another key');
    }
    await lockOwnKey(txQuery, user, keyId);
    let [updated] = await txQuery([
      `UPDATE key_shares SET owner = `,
      param(user),
      `, key_id = `,
      param(keyId),
      `, state = 'active', suspension_reason = NULL, suspended_by = NULL, suspended_at = NULL, updated_at = NOW() WHERE id = `,
      param(shareId),
      ` RETURNING ${SHARE_COLUMNS}`,
    ]);
    return toShare(updated, { withKey: true });
  });
}

// The user's own shares, in every realm, by realm and label. With `keyId`,
// only the shares holding that key: the ones deleting it would suspend.
export async function listOwnShares(
  dbAdapter: DBAdapter,
  owner: string,
  { keyId }: { keyId?: string } = {},
): Promise<KeyShare[]> {
  if (keyId !== undefined && !UUID.test(keyId)) {
    return [];
  }
  let rows = await query(dbAdapter, [
    `SELECT ${SHARE_COLUMNS} FROM key_shares WHERE owner = `,
    param(owner),
    ...(keyId !== undefined ? [` AND key_id = `, param(keyId)] : []),
    ` ORDER BY realm_url, label`,
  ]);
  return rows.map((row) => toShare(row, { withKey: true }));
}

async function assertDirectWriter(
  dbAdapter: DBAdapter,
  realmURL: URL,
  user: string,
): Promise<void> {
  if (!(await isDirectWriter(dbAdapter, realmURL, user))) {
    throw new UserKeyError(403, `only a realm's direct writers see its shares`);
  }
}

// A realm's shares, by label, for one of its direct writers.
export async function listRealmShares(
  dbAdapter: DBAdapter,
  user: string,
  realm: unknown,
): Promise<KeyShare[]> {
  let realmURL = validateRealm(realm);
  await assertDirectWriter(dbAdapter, realmURL, user);
  let rows = await query(dbAdapter, [
    `SELECT ${SHARE_COLUMNS} FROM key_shares WHERE realm_url = `,
    param(realmURL.href),
    ` ORDER BY label`,
  ]);
  return rows.map((row) => toShare(row, { withKey: row.owner === user }));
}

// The notices recorded when one of a realm's shares was suspended, newest
// first, for one of its direct writers.
export async function listRealmShareNotices(
  dbAdapter: DBAdapter,
  user: string,
  realm: unknown,
): Promise<KeyShareNotice[]> {
  let realmURL = validateRealm(realm);
  await assertDirectWriter(dbAdapter, realmURL, user);
  let rows = await query(dbAdapter, [
    `SELECT id, share_id, realm_url, label, owner, reason, suspended_by, created_at FROM key_share_notices WHERE realm_url = `,
    param(realmURL.href),
    ` ORDER BY created_at DESC, id DESC LIMIT ${MAX_KEY_SHARE_NOTICES}`,
  ]);
  return rows.map((row) => ({
    id: String(row.id),
    shareId: row.share_id as string,
    realm: row.realm_url as string,
    label: row.label as string,
    owner: row.owner as string,
    reason: row.reason as KeyShareSuspensionReason,
    suspendedBy: (row.suspended_by as string | null) ?? null,
    createdAt: iso(row.created_at)!,
  }));
}
