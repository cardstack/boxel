import type { DBAdapter } from '../db.ts';
import { query, param } from '../expression.ts';

// A private realm sends its realm events once, into a Matrix room whose
// members are exactly the users the realm's grants name, instead of once into
// each of those users' session rooms. A realm is private when it has no `'*'`
// read grant: a world-readable realm has readers no grant names, who may not
// see each other or its named users, so its events keep going to session
// rooms.

/**
 * Reports whether the given realm is private, and the room its realm events
 * go to when it has one. A private realm's room is created the first time a
 * host asks for it, so until then `roomId` is null.
 */
export async function fetchRealmEventRoom(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<{ isPrivate: boolean; roomId: string | null }> {
  let [row] = await query(dbAdapter, [
    'SELECT NOT EXISTS (',
    '  SELECT 1 FROM realm_user_permissions',
    '  WHERE realm_url =',
    param(realmURL),
    "  AND username = '*'",
    '  AND read = true',
    ') AS is_private,',
    '(SELECT room_id FROM realm_event_rooms WHERE realm_url =',
    param(realmURL),
    ') AS room_id',
  ]);
  return {
    isPrivate: Boolean(row?.is_private),
    roomId: (row?.room_id as string | null | undefined) ?? null,
  };
}

/**
 * Stores the given room as the realm's event room, unless the realm already
 * has one, and returns the room that is stored. When two processes create a
 * room for the same realm at once, the first stored wins and the other's room
 * goes unused. A conflicting insert waits for the row it conflicts with and
 * reads that row's room, so every caller gets the winner back.
 */
export async function insertRealmEventRoom(
  dbAdapter: DBAdapter,
  realmURL: string,
  roomId: string,
): Promise<string> {
  let rows = await query(dbAdapter, [
    'INSERT INTO realm_event_rooms (realm_url, room_id) VALUES (',
    param(realmURL),
    ',',
    param(roomId),
    ') ON CONFLICT (realm_url) DO UPDATE',
    'SET room_id = realm_event_rooms.room_id',
    'RETURNING room_id',
  ]);
  return rows[0].room_id as string;
}

/**
 * Forgets the realm's event room when it is the given room, so the next host
 * that asks for the realm's room gets a new one. For a stored room the realm
 * server can no longer send in, such as after its homeserver was reset, and
 * for the room of a realm that is being deleted.
 */
export async function clearRealmEventRoom(
  dbAdapter: DBAdapter,
  realmURL: string,
  roomId: string,
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    'DELETE FROM realm_event_rooms WHERE realm_url =',
    param(realmURL),
    'AND room_id =',
    param(roomId),
    'RETURNING realm_url',
  ]);
  return rows.length > 0;
}

/**
 * The matrix users the given realm's grants name, the users its event room
 * should hold: every user with their own read or write grant. The `'*'` grant
 * names no one, and neither does a grant to a bare username, which has no
 * matrix account to invite.
 */
export async function fetchRealmNamedGrantees(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<string[]> {
  let rows = await query(dbAdapter, [
    'SELECT username FROM realm_user_permissions',
    'WHERE realm_url =',
    param(realmURL),
    "AND username LIKE '@%:%'",
    'AND (read = true OR write = true)',
    'ORDER BY username',
  ]);
  return rows.map((row) => row.username as string);
}
