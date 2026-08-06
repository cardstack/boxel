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
  eventId: string,
): Promise<boolean> {
  // Attempts to take an exclusive lock per room by upserting a row. The insert succeeds when no
  // unfinished processing exists for the room; otherwise an UPDATE runs only if the previous run
  // has a non-null completed_at, effectively allowing the next bot instance to pick up where the
  // prior one finished.
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

// How long a caller will wait for a room that is mid-turn before giving up.
// An agentic turn runs a chain of tool calls and can take tens of seconds, and
// the wait only has to outlast the turn in front of it.
export const ROOM_LOCK_WAIT_TIMEOUT_MS = 120_000;
const ROOM_LOCK_POLL_INTERVAL_MS = 500;

/**
 * Take the room lock, waiting for whoever holds it rather than giving up at
 * once. A user message that arrives mid-turn contends with the turn already
 * running, and abandoning it there loses the message outright — the room's
 * events are not a queue anything drains later. Waiting lets it be handled as
 * soon as the room is free.
 *
 * Returns false only after the timeout, which means the holder is wedged or
 * died without releasing; the caller decides what to say about that.
 */
export async function acquireRoomLockWithWait(
  pgAdapter: PgAdapter,
  roomId: string,
  aiBotInstanceId: string,
  eventId: string,
  opts: { timeoutMs?: number; now?: () => number } = {},
): Promise<boolean> {
  let timeoutMs = opts.timeoutMs ?? ROOM_LOCK_WAIT_TIMEOUT_MS;
  let now = opts.now ?? (() => Date.now());
  let deadline = now() + timeoutMs;
  for (;;) {
    if (await acquireRoomLock(pgAdapter, roomId, aiBotInstanceId, eventId)) {
      return true;
    }
    if (now() >= deadline) {
      return false;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, ROOM_LOCK_POLL_INTERVAL_MS),
    );
  }
}

export async function releaseRoomLock(pgAdapter: PgAdapter, roomId: string) {
  await query(pgAdapter, [
    `UPDATE ai_bot_event_processing SET completed_at = NOW() WHERE room_id = `,
    param(roomId),
  ]);
}
