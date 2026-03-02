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
 * Returns a mapping of matrix user id to session room id for all known sessions
 * that should be notified about changes to the given realm.
 *
 * Includes:
 *  - Users with explicit read/write permissions for this realm.
 *  - All registered users when the realm is world-readable (username = '*'
 *    with read = true). This is intentional: world-readable realms are visible
 *    to everyone, so all users need incremental-index notifications to keep
 *    their UI up to date.
 */
export async function fetchRealmSessionRooms(
  dbAdapter: DBAdapter,
  realmURL: string,
) {
  let rows = await query(dbAdapter, [
    'SELECT u.matrix_user_id, u.session_room_id',
    'FROM users u',
    'WHERE u.session_room_id IS NOT NULL',
    'AND (',
    '  EXISTS (',
    '    SELECT 1 FROM realm_user_permissions',
    '    WHERE realm_url =',
    param(realmURL),
    '    AND username = u.matrix_user_id',
    '    AND (read = true OR write = true)',
    '  )',
    '  OR EXISTS (',
    '    SELECT 1 FROM realm_user_permissions',
    '    WHERE realm_url =',
    param(realmURL),
    "    AND username = '*'",
    '    AND read = true',
    '  )',
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
