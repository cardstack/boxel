import type { PgAdapter } from '@cardstack/postgres';
import type { Expression } from '@cardstack/runtime-common';
import {
  query,
  param,
  addExplicitParens,
  separatedByCommas,
  asExpressions,
} from '@cardstack/runtime-common';

export async function acquireRoomLock(
  pgAdapter: PgAdapter,
  roomId: string,
  aiBotInstanceId: string,
  eventId?: string,
): Promise<boolean> {
  let { valueExpressions, nameExpressions } = asExpressions({
    ai_bot_instance_id: aiBotInstanceId,
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

export async function releaseRoomLock(pgAdapter: PgAdapter, roomId: string) {
  await query(pgAdapter, [
    `UPDATE ai_bot_event_processing SET completed_at = NOW() WHERE room_id = `,
    param(roomId),
  ]);
}
