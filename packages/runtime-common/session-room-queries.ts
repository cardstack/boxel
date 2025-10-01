import type { DBAdapter } from './db';
import { query, param, dbExpression } from './expression';

/**
 * Returns the stored session room id for the given matrix user or null when none exists.
 */
export async function getSessionRoom(
  dbAdapter: DBAdapter,
  matrixUserId: string,
) {
  let rows = await query(dbAdapter, [
    'SELECT room_id FROM session_rooms WHERE matrix_user_id =',
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
export async function setSessionRoom(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  roomId: string,
) {
  await query(dbAdapter, [
    'INSERT INTO session_rooms (matrix_user_id, room_id, created_at, updated_at)',
    'VALUES (',
    param(matrixUserId),
    ',',
    param(roomId),
    ',',
    dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
    ',',
    dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
    ')',
    'ON CONFLICT (matrix_user_id) DO UPDATE SET',
    'room_id =',
    param(roomId),
    ',',
    'updated_at =',
    dbExpression({ pg: 'NOW()', sqlite: 'CURRENT_TIMESTAMP' }),
  ]);
}

/**
 * Returns a mapping of matrix user id to session room id for all known sessions.
 */
export async function getAllSessionRooms(dbAdapter: DBAdapter) {
  let rows = await query(dbAdapter, [
    'SELECT matrix_user_id, room_id FROM session_rooms',
  ]);

  let result: Record<string, string> = {};
  for (let row of rows) {
    if (row.matrix_user_id && row.room_id) {
      result[row.matrix_user_id as string] = row.room_id as string;
    }
  }
  return result;
}
