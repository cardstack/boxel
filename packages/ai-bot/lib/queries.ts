import type { PgAdapter } from '@cardstack/postgres';
import type { Expression } from '@cardstack/runtime-common';
import {
  query,
  param,
  addExplicitParens,
  separatedByCommas,
  asExpressions,
} from '@cardstack/runtime-common';

export async function acquireLock(
  pgAdapter: PgAdapter,
  eventId: string,
  aiBotInstanceId: string,
): Promise<boolean> {
  let { valueExpressions, nameExpressions } = asExpressions({
    ai_bot_instance_id: aiBotInstanceId,
    event_id_being_processed: eventId,
  });

  let lockRow = await query(pgAdapter, [
    `INSERT INTO ai_bot_event_processing`,
    ...addExplicitParens(separatedByCommas(nameExpressions)),
    `VALUES`,
    ...addExplicitParens(separatedByCommas(valueExpressions)),
    `ON CONFLICT (event_id_being_processed) DO NOTHING`,
    `RETURNING ai_bot_instance_id, event_id_being_processed`,
  ] as Expression);

  return lockRow.length > 0;
}

export async function releaseLock(pgAdapter: PgAdapter, eventId: string) {
  await query(pgAdapter, [
    `UPDATE ai_bot_event_processing SET completed_at = NOW() WHERE event_id_being_processed = `,
    param(eventId),
  ]);
}
