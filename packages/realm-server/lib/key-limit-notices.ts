import {
  isDirectWriter,
  param,
  query,
  separatedByCommas,
  type DBAdapter,
  type Expression,
} from '@cardstack/runtime-common';
import { matrixServerNameFromEnv } from '../utils/matrix-server-name.ts';
import { limitsOf } from './key-limit-settings.ts';
import { UserKeyError } from './user-keys.ts';

// The limit notices a user is owed (`key_limit_notices`, recorded by
// `noticeThresholds` in `key-limits.ts`): a share's or personal key's use
// reached the high-water mark or the budget for a UTC day or month. Each is
// recorded for the key's owner and, for a share, each direct writer of its
// realm.
//
// A notice is read against the share or key as it is now, and listed only
// while what it says still holds:
// - until its period ends, when the count starts over;
// - while its budget is not below the one in force, since a budget the owner
//   raised has made calls available again (reaching the new one records a
//   notice of its own);
// - for a share, while the recipient owns its key or directly writes its
//   realm, as the realm's share listing is shown to them.
// What isn't listed isn't counted as unread either. The secure origin's key
// page lists them and marks the ones it shows read; the app reads only the
// unread count, for its badge.

export interface KeyLimitNotice {
  id: string;
  // The share, with its realm, or the personal key, whose use reached the
  // threshold. A share's notice names no key; a key's names no share.
  share: string | null;
  key: string | null;
  realm: string | null;
  // The share's label or the key's name when the notice was recorded.
  label: string;
  // Whether the recipient owns the key now, and so can change its limits. A
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

const LIMIT_COLUMNS = [
  'rate_burst',
  'rate_refill_per_minute',
  'daily_budget',
  'monthly_budget',
];

// Each notice with its share's or key's owner and limits as they are now. A
// notice whose share or key is gone went with it (`ON DELETE CASCADE`).
const NOTICE_COLUMNS = [
  'n.id',
  'n.share_id',
  'n.key_id',
  'n.realm_url',
  'n.label',
  'n.period',
  'n.period_ends_at',
  'n.threshold',
  'n.budget',
  'n.read_at',
  'n.created_at',
  'COALESCE(s.owner, k.owner) AS current_owner',
  ...LIMIT_COLUMNS.map(
    (column) => `COALESCE(s.${column}, k.${column}) AS ${column}`,
  ),
].join(', ');

function noticeOf(row: Record<string, any>, recipient: string): KeyLimitNotice {
  return {
    id: String(row.id),
    share: row.share_id ?? null,
    key: row.key_id ?? null,
    realm: row.realm_url ?? null,
    label: row.label,
    yours: row.current_owner === recipient,
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
    `SELECT ${NOTICE_COLUMNS} FROM key_limit_notices n
       LEFT JOIN key_shares s ON s.id = n.share_id
       LEFT JOIN user_keys k ON k.id = n.key_id
     WHERE n.recipient = `,
    param(recipient),
    ` AND n.period_ends_at > NOW() ORDER BY n.created_at DESC, n.id DESC LIMIT ${MAX_LISTED}`,
  ])) as Record<string, any>[];
  let writes = new Map<string, Promise<boolean>>();
  let writesRealm = (realm: string) => {
    let answer = writes.get(realm);
    if (!answer) {
      answer = isDirectWriter(
        dbAdapter,
        new URL(realm),
        recipient,
        matrixServerNameFromEnv(),
      );
      writes.set(realm, answer);
    }
    return answer;
  };
  let listed: KeyLimitNotice[] = [];
  for (let row of rows) {
    let notice = noticeOf(row, recipient);
    let limits = limitsOf(row);
    let inForce =
      notice.period === 'day' ? limits.dailyBudget : limits.monthlyBudget;
    if (notice.budget < inForce) {
      continue;
    }
    if (notice.realm && !notice.yours && !(await writesRealm(notice.realm))) {
      continue;
    }
    listed.push(notice);
  }
  return listed;
}

// How many of the notices the recipient's key page lists it hasn't marked
// read: their part of the count the app shows on the user's avatar. It counts
// what the listing lists, since the page marks read only that.
export async function countUnreadLimitNotices(
  dbAdapter: DBAdapter,
  recipient: string,
): Promise<number> {
  return (await listLimitNotices(dbAdapter, recipient)).filter(
    (notice) => !notice.readAt,
  ).length;
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
