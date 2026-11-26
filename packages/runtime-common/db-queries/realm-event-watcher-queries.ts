import type { DBAdapter } from '../db.ts';
import { query, param } from '../expression.ts';

// A user who reaches a private realm only through its policy has no permission
// row, so they are in neither the realm's event room nor the session-room
// fallback. While they have the realm open their host asks to watch it, and
// the realm sends each live watcher's session room its index events filtered
// to the cards the policy lets that watcher read. A watch lapses unless it is
// renewed, so a host that goes away needs to say nothing.

// How long one registration lasts. Hosts renew well inside it.
export const REALM_EVENT_WATCH_TTL_MS = 10 * 60 * 1000;

/**
 * Registers `userId` as a watcher of `realmURL` until `ttlMs` from `now`, or
 * extends a registration they already hold. Refused, returning false, when
 * the user already watches `maxRealmsPerUser` other realms. Renewing a realm
 * the user already watches is never refused by that bound.
 */
export async function upsertRealmEventWatcher(
  dbAdapter: DBAdapter,
  realmURL: string,
  userId: string,
  {
    maxRealmsPerUser,
    ttlMs = REALM_EVENT_WATCH_TTL_MS,
    now = Date.now(),
  }: { maxRealmsPerUser: number; ttlMs?: number; now?: number },
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    'INSERT INTO realm_event_watchers (realm_url, user_id, expires_at)',
    'SELECT',
    param(realmURL),
    ',',
    param(userId),
    ', CAST(',
    param(now + ttlMs),
    'AS BIGINT)',
    'WHERE (',
    '  SELECT COUNT(*) FROM realm_event_watchers',
    '  WHERE user_id =',
    param(userId),
    '  AND realm_url <>',
    param(realmURL),
    '  AND expires_at > CAST(',
    param(now),
    '  AS BIGINT)',
    ') < CAST(',
    param(maxRealmsPerUser),
    'AS BIGINT)',
    'ON CONFLICT (realm_url, user_id) DO UPDATE',
    'SET expires_at = EXCLUDED.expires_at',
    'RETURNING realm_url',
  ]);
  return rows.length > 0;
}

/**
 * The users whose watch of `realmURL` has not lapsed.
 */
export async function fetchLiveRealmEventWatchers(
  dbAdapter: DBAdapter,
  realmURL: string,
  now = Date.now(),
): Promise<string[]> {
  let rows = await query(dbAdapter, [
    'SELECT user_id FROM realm_event_watchers',
    'WHERE realm_url =',
    param(realmURL),
    'AND expires_at > CAST(',
    param(now),
    'AS BIGINT)',
    'ORDER BY user_id',
  ]);
  return rows.map((row) => row.user_id as string);
}

/**
 * Removes every lapsed watch. Nothing reads a lapsed row, so this only keeps
 * the table small; it is run opportunistically, never relied on.
 */
export async function deleteExpiredRealmEventWatchers(
  dbAdapter: DBAdapter,
  now = Date.now(),
): Promise<number> {
  let rows = await query(dbAdapter, [
    'DELETE FROM realm_event_watchers WHERE expires_at <= CAST(',
    param(now),
    'AS BIGINT)',
    'RETURNING realm_url',
  ]);
  return rows.length;
}
