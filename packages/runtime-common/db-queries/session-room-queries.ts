import type { DBAdapter } from '../db.ts';
import { query, param } from '../expression.ts';

/**
 * Returns the stored session room id for the given matrix user or null when none exists.
 */
export async function fetchSessionRoom(
  dbAdapter: DBAdapter,
  matrixUserId: string,
) {
  let rows = await query(dbAdapter, [
    'SELECT session_room_id FROM users WHERE matrix_user_id =',
    param(matrixUserId),
  ]);

  if (rows.length === 0) {
    return null;
  }

  let [row] = rows;
  return (row.session_room_id as string) ?? null;
}

/**
 * Updates the session room id for the given matrix user.
 * Throws if the user does not exist in the users table.
 */
export async function upsertSessionRoom(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  roomId: string,
) {
  let rows = await query(dbAdapter, [
    'UPDATE users SET session_room_id =',
    param(roomId),
    'WHERE matrix_user_id =',
    param(matrixUserId),
    'RETURNING id',
  ]);

  if (rows.length === 0) {
    throw new Error(
      `Cannot set session room for user ${matrixUserId}: user does not exist in the users table`,
    );
  }
}

/**
 * Clears the stored session room id for the given matrix user if it still
 * matches the provided room id. Returns true when a row was updated.
 */
export async function clearSessionRoom(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  roomId: string,
) {
  let rows = await query(dbAdapter, [
    'UPDATE users SET session_room_id = NULL',
    'WHERE matrix_user_id =',
    param(matrixUserId),
    'AND session_room_id =',
    param(roomId),
    'RETURNING id',
  ]);

  return rows.length > 0;
}

/**
 * Returns a mapping of matrix user id to session room id for the users with
 * their own read or write permission on the given realm.
 *
 * A world-readable realm's events don't go to session rooms; they go to the
 * realm's event room (see `fetchRealmEventRoom`), so a `'*'` grant adds no one
 * here.
 */
export async function fetchRealmSessionRooms(
  dbAdapter: DBAdapter,
  realmURL: string,
) {
  let rows = await query(dbAdapter, [
    'SELECT u.matrix_user_id, u.session_room_id',
    'FROM users u',
    'WHERE u.session_room_id IS NOT NULL',
    'AND EXISTS (',
    '  SELECT 1 FROM realm_user_permissions',
    '  WHERE realm_url =',
    param(realmURL),
    '  AND username = u.matrix_user_id',
    '  AND (read = true OR write = true)',
    ')',
  ]);

  let result: Record<string, string> = {};
  for (let row of rows) {
    if (row.matrix_user_id && row.session_room_id) {
      result[row.matrix_user_id as string] = row.session_room_id as string;
    }
  }
  return result;
}

/**
 * Reports whether the given realm is world-readable, and the room its realm
 * events go to when it has one. A world-readable realm's room is created the
 * first time a host asks for it, so until then `roomId` is null.
 */
export async function fetchRealmEventRoom(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<{ worldReadable: boolean; roomId: string | null }> {
  let [row] = await query(dbAdapter, [
    'SELECT EXISTS (',
    '  SELECT 1 FROM realm_user_permissions',
    '  WHERE realm_url =',
    param(realmURL),
    "  AND username = '*'",
    '  AND read = true',
    ') AS world_readable,',
    '(SELECT room_id FROM realm_event_rooms WHERE realm_url =',
    param(realmURL),
    ') AS room_id',
  ]);
  return {
    worldReadable: Boolean(row?.world_readable),
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
 * server can no longer send in, such as after its homeserver was reset.
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
