import type { PgAdapter } from '@cardstack/postgres';
import type { Expression } from '@cardstack/runtime-common';
import {
  query,
  param,
  addExplicitParens,
  separatedByCommas,
  asExpressions,
} from '@cardstack/runtime-common';

/**
 * Attempts to acquire an exclusive lock for processing events in a room.
 *
 * This prevents multiple bot instances from processing events in the same room
 * concurrently. The lock is acquired by upserting a row in the database.
 *
 * @param pgAdapter - Database adapter
 * @param roomId - Matrix room ID
 * @param botInstanceId - Unique identifier for this bot instance
 * @param eventId - The event ID being processed
 * @returns true if lock was acquired, false if another instance holds the lock
 *
 * @example
 * ```ts
 * const gotLock = await acquireRoomLock(pgAdapter, roomId, instanceId, eventId);
 * if (!gotLock) {
 *   return; // Another instance is processing this room
 * }
 * try {
 *   // Process the event
 * } finally {
 *   await releaseRoomLock(pgAdapter, roomId);
 * }
 * ```
 */
export async function acquireRoomLock(
  pgAdapter: PgAdapter,
  roomId: string,
  botInstanceId: string,
  eventId: string,
): Promise<boolean> {
  // Attempts to take an exclusive lock per room by upserting a row. The insert succeeds when no
  // unfinished processing exists for the room; otherwise an UPDATE runs only if the previous run
  // has a non-null completed_at, effectively allowing the next bot instance to pick up where the
  // prior one finished.
  let { valueExpressions, nameExpressions } = asExpressions({
    ai_bot_instance_id: botInstanceId,
    room_id: roomId,
    event_id_being_processed: eventId,
  });

  let lockRow = await query(pgAdapter, [
    `INSERT INTO ai_bot_event_processing`,
    ...addExplicitParens(separatedByCommas(nameExpressions)),
    `VALUES`,
    ...addExplicitParens(separatedByCommas(valueExpressions)),
    `ON CONFLICT (room_id) DO UPDATE SET`,
    `ai_bot_instance_id = EXCLUDED.ai_bot_instance_id,`,
    `event_id_being_processed = EXCLUDED.event_id_being_processed,`,
    `processing_started_at = EXCLUDED.processing_started_at,`,
    `completed_at = NULL`,
    `WHERE ai_bot_event_processing.completed_at IS NOT NULL`,
    `RETURNING ai_bot_instance_id, room_id, event_id_being_processed`,
  ] as Expression);

  return lockRow.length > 0;
}

/**
 * Releases the room lock after processing is complete.
 *
 * @param pgAdapter - Database adapter
 * @param roomId - Matrix room ID
 */
export async function releaseRoomLock(
  pgAdapter: PgAdapter,
  roomId: string,
): Promise<void> {
  await query(pgAdapter, [
    `UPDATE ai_bot_event_processing SET completed_at = NOW() WHERE room_id = `,
    param(roomId),
  ]);
}
