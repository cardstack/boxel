import type { DBAdapter } from '../db';
import { query, param } from '../expression';

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
 */
export async function upsertSessionRoom(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  roomId: string,
) {
  await query(dbAdapter, [
    'UPDATE users SET session_room_id =',
    param(roomId),
    'WHERE matrix_user_id =',
    param(matrixUserId),
  ]);
}

/**
 * Returns a mapping of matrix user id to session room id for all known sessions.
 */
export async function fetchRealmSessionRooms(
  dbAdapter: DBAdapter,
  realmURL: string,
) {
  let rows = await query(dbAdapter, [
    'SELECT u.matrix_user_id, u.session_room_id',
    'FROM users u',
    'JOIN realm_user_permissions rup',
    'ON rup.username = u.matrix_user_id',
    'WHERE rup.realm_url =',
    param(realmURL),
    'AND (rup.read = true OR rup.write = true)',
    'AND u.session_room_id IS NOT NULL',
  ]);

  let result: Record<string, string> = {};
  for (let row of rows) {
    if (row.matrix_user_id && row.session_room_id) {
      result[row.matrix_user_id as string] = row.session_room_id as string;
    }
  }
  return result;
}
