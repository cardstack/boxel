import type { DBAdapter } from '../db';
import { query, param, dbExpression } from '../expression';

export const REALM_SERVER_REALM = '__realm-server__';

/**
 * Returns the stored session room id for the given matrix user or null when none exists.
 */
export async function fetchSessionRoom(
  dbAdapter: DBAdapter,
  realmUserId: string,
  matrixUserId: string,
) {
  let rows = await query(dbAdapter, [
    'SELECT room_id FROM session_rooms WHERE realm_user_id =',
    param(realmUserId),
    'AND matrix_user_id =',
    param(matrixUserId),
  ]);

  if (rows.length === 0) {
    return null;
  }

  let [row] = rows;
  return (row.room_id as string) ?? null;
}

/**
 * Upserts the session room id for the given matrix user and updates the timestamp.
 */
export async function upsertSessionRoom(
  dbAdapter: DBAdapter,
  realmUserId: string,
  matrixUserId: string,
  roomId: string,
) {
  await query(dbAdapter, [
    'INSERT INTO session_rooms (realm_url, realm_user_id, matrix_user_id, room_id, created_at, updated_at)',
    'VALUES (',
    param(REALM_SERVER_REALM),
    ',',
    param(realmUserId),
    ',',
    param(matrixUserId),
    ',',
    param(roomId),
    ',',
    dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
    ',',
    dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
    ')',
    'ON CONFLICT (realm_url, matrix_user_id) DO UPDATE SET',
    'room_id =',
    param(roomId),
    ',',
    'realm_user_id =',
    param(realmUserId),
    ',',
    'updated_at =',
    dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
  ]);
}

/**
 * Returns a mapping of matrix user id to session room id for all known sessions.
 */
export async function fetchAllSessionRooms(
  dbAdapter: DBAdapter,
  realmURL: string,
  realmUserId: string,
) {
  let rows = await query(dbAdapter, [
    'SELECT sr.matrix_user_id, sr.room_id',
    'FROM session_rooms sr',
    'JOIN realm_user_permissions rup',
    'ON rup.username = sr.matrix_user_id',
    'WHERE rup.realm_url =',
    param(realmURL),
    'AND (rup.read = true OR rup.write = true)',
    'AND sr.realm_user_id =',
    param(realmUserId),
    'AND sr.realm_url =',
    param(REALM_SERVER_REALM),
  ]);

  let result: Record<string, string> = {};
  for (let row of rows) {
    if (row.matrix_user_id && row.room_id) {
      result[row.matrix_user_id as string] = row.room_id as string;
    }
  }
  return result;
}

export async function clearSessionRooms(dbAdapter: DBAdapter) {
  await query(dbAdapter, ['DELETE FROM session_rooms']);
}
