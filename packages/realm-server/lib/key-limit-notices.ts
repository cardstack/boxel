import {
  param,
  query,
  separatedByCommas,
  type DBAdapter,
  type Expression,
} from '@cardstack/runtime-common';
import { UserKeyError } from './user-keys.ts';

// The limit notices a user is owed (`key_limit_notices`, recorded by
// `noticeThresholds` in `key-limits.ts`): a share's or personal key's use
// reached the high-water mark or the budget for a UTC day or month. Each is
// recorded for the key's owner and, for a share, each direct writer of its
// realm.
//
// A notice is listed until its period ends. Once the count starts over, what
// it said no longer holds, so it is neither listed nor counted as unread. The
// secure origin's key page lists them and marks the ones it shows read; the
// app reads only the unread count, for its badge.

export interface KeyLimitNotice {
  id: string;
  // The share, with its realm, or the personal key, whose use reached the
  // threshold. A share's notice names no key; a key's names no share.
  share: string | null;
  key: string | null;
  realm: string | null;
  // The share's label or the key's name when the notice was recorded.
  label: string;
  // Whether the recipient owns the key, and so can change its limits. A
  // realm's other direct writers are told too, and can only suspend a share.
  yours: boolean;
  period: 'day' | 'month';
  // When the period ends and its count starts over.
  periodEndsAt: string;
  threshold: 'high-water' | 'budget';
  // The budget for the period when the threshold was reached.
  budget: number;
  // When the key page first listed it; null while it is unread.
  readAt: string | null;
  createdAt: string;
}

// The most notices a listing returns, newest first.
const MAX_LISTED = 100;

const NOTICE_COLUMNS =
  'id, share_id, key_id, realm_url, label, owner, recipient, period, period_ends_at, threshold, budget, read_at, created_at';

// The recipient's notices whose period hasn't ended, newest first.
const CURRENT = ` AND period_ends_at > NOW() ORDER BY created_at DESC, id DESC LIMIT ${MAX_LISTED}`;

function noticeOf(row: Record<string, any>): KeyLimitNotice {
  return {
    id: String(row.id),
    share: row.share_id ?? null,
    key: row.key_id ?? null,
    realm: row.realm_url ?? null,
    label: row.label,
    yours: row.owner === row.recipient,
    period: row.period,
    periodEndsAt: new Date(row.period_ends_at).toISOString(),
    threshold: row.threshold,
    budget: Number(row.budget),
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function listLimitNotices(
  dbAdapter: DBAdapter,
  recipient: string,
): Promise<KeyLimitNotice[]> {
  let rows = (await query(dbAdapter, [
    `SELECT ${NOTICE_COLUMNS} FROM key_limit_notices WHERE recipient = `,
    param(recipient),
    CURRENT,
  ])) as Record<string, any>[];
  return rows.map(noticeOf);
}

// How many of the notices the recipient's key page lists it hasn't marked
// read: their part of the count the app shows on the user's avatar. It counts
// within the listing's own window, since the page marks read only what it
// lists.
export async function countUnreadLimitNotices(
  dbAdapter: DBAdapter,
  recipient: string,
): Promise<number> {
  let [row] = (await query(dbAdapter, [
    `SELECT COUNT(*) AS unread FROM (SELECT read_at FROM key_limit_notices WHERE recipient = `,
    param(recipient),
    CURRENT,
    `) listed WHERE read_at IS NULL`,
  ])) as { unread: number | string }[];
  return Number(row?.unread ?? 0);
}

// Marks the recipient's notices with these ids read, as their key page does
// once it has shown them. Naming the ids, rather than marking everything,
// leaves a notice recorded after the page loaded unread until a page lists it.
// Ids that aren't the recipient's, or are already read, are passed over.
// Answers how many it marked.
export async function markLimitNoticesRead(
  dbAdapter: DBAdapter,
  recipient: string,
  ids: unknown,
): Promise<number> {
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_LISTED ||
    !ids.every((id) => typeof id === 'string' && /^[0-9]{1,18}$/.test(id))
  ) {
    throw new UserKeyError(
      400,
      `ids must be a list of at most ${MAX_LISTED} notice ids`,
    );
  }
  if (ids.length === 0) {
    return 0;
  }
  let rows = (await query(dbAdapter, [
    `UPDATE key_limit_notices SET read_at = NOW() WHERE recipient = `,
    param(recipient),
    ` AND read_at IS NULL AND id IN (`,
    // Bound as text and cast, so an id past 2^53 isn't rounded on the way.
    ...separatedByCommas(ids.map((id) => [param(id), '::bigint'])),
    `) RETURNING id`,
  ] as Expression)) as { id: unknown }[];
  return rows.length;
}
