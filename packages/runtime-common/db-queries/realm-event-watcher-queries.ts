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
 * the user already watches `maxRealmsPerUser` other realms, or the realm
 * already has `maxWatchersPerRealm` other watchers. Renewing a watch the user
 * already holds is never refused by either bound.
 *
 * Both bounds are counted under a per-user and a per-realm advisory lock, so
 * concurrent registrations can't each count below a bound and together pass
 * it. Every registration takes the user's lock before the realm's, so two of
 * them never wait on each other in a cycle.
 */
export async function upsertRealmEventWatcher(
  dbAdapter: DBAdapter,
  realmURL: string,
  userId: string,
  {
    maxRealmsPerUser,
    maxWatchersPerRealm,
    ttlMs = REALM_EVENT_WATCH_TTL_MS,
    now = Date.now(),
  }: {
    maxRealmsPerUser: number;
    maxWatchersPerRealm?: number;
    ttlMs?: number;
    now?: number;
  },
): Promise<boolean> {
  return await dbAdapter.withTransaction(async (txQuerier) => {
    if (dbAdapter.kind === 'pg') {
      for (let key of [`user:${userId}`, `realm:${realmURL}`]) {
        await txQuerier([
          'SELECT pg_advisory_xact_lock(hashtext(',
          param(`realm_event_watchers:${key}`),
          '))',
        ]);
      }
    }
    let rows = await txQuerier([
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
      'AND (',
      '  SELECT COUNT(*) FROM realm_event_watchers',
      '  WHERE realm_url =',
      param(realmURL),
      '  AND user_id <>',
      param(userId),
      '  AND expires_at > CAST(',
      param(now),
      '  AS BIGINT)',
      ') < CAST(',
      param(maxWatchersPerRealm ?? Number.MAX_SAFE_INTEGER),
      'AS BIGINT)',
      'ON CONFLICT (realm_url, user_id) DO UPDATE',
      'SET expires_at = EXCLUDED.expires_at',
      'RETURNING realm_url',
    ]);
    return rows.length > 0;
  });
}

/**
 * The users whose watch of `realmURL` has not lapsed. A watch registered or
 * last renewed before the user's sessions were revoked is left out: it was
 * made with a session that no longer counts. A renewal after the revocation
 * needed a fresh session, so it counts again.
 */
export async function fetchLiveRealmEventWatchers(
  dbAdapter: DBAdapter,
  realmURL: string,
  now = Date.now(),
  ttlMs = REALM_EVENT_WATCH_TTL_MS,
): Promise<string[]> {
  let rows = await query(dbAdapter, [
    'SELECT w.user_id FROM realm_event_watchers w',
    'WHERE w.realm_url =',
    param(realmURL),
    'AND w.expires_at > CAST(',
    param(now),
    'AS BIGINT)',
    'AND NOT EXISTS (',
    '  SELECT 1 FROM users u WHERE u.matrix_user_id = w.user_id',
    '  AND u.sessions_revoked_at IS NOT NULL',
    '  AND u.sessions_revoked_at * 1000 > w.expires_at - CAST(',
    param(ttlMs),
    '  AS BIGINT)',
    ')',
    'ORDER BY w.user_id',
  ]);
  return rows.map((row) => row.user_id as string);
}

/**
 * Whether anyone's watch of `realmURL` has not lapsed, read without deciding
 * who.
 */
export async function hasLiveRealmEventWatchers(
  dbAdapter: DBAdapter,
  realmURL: string,
  now = Date.now(),
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    'SELECT 1 AS live FROM realm_event_watchers WHERE realm_url =',
    param(realmURL),
    'AND expires_at > CAST(',
    param(now),
    'AS BIGINT)',
    'LIMIT 1',
  ]);
  return rows.length > 0;
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
