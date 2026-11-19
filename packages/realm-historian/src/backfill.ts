// Backfill: the initial snapshot of each realm recording was turned on for
// that has no revision yet and no event to record, such as an existing realm
// at rollout. Each one's directory is swept and recorded as one `Initial
// snapshot` revision by `boxel-system` (`recorder.ts`). A realm with events
// to record gets its initial snapshot from its recorder before its first
// revision instead, and a new realm from its create-realm `scan` event.
//
// The work is due when the task loads the realm, and the task's background
// concurrency paces it: only so many realms walk at once.

import type { DBAdapter } from '@cardstack/runtime-common';
import type { BackgroundKind } from './background.ts';

// How long a backfill whose walk failed waits before it is tried again.
const BACKFILL_RETRY_AFTER_MS = 10 * 60_000;

export function backfillKind({ db }: { db: DBAdapter }): BackgroundKind {
  return {
    name: 'backfill',
    atStart: true,
    outsideQueue: true,
    retryAfterMs: BACKFILL_RETRY_AFTER_MS,
    isDue: (realm) => needsBackfill(db, realm.id),
    run: (_realm, { sweep }) => sweep(),
  };
}

// Whether the realm records history, has no HEAD, and has no event after
// its cursor.
export async function needsBackfill(
  db: DBAdapter,
  realmId: string,
): Promise<boolean> {
  let rows = await db.execute(
    `SELECT 1 FROM realm_history_state state
     WHERE state.realm_id = $1 AND state.enabled AND state.status = 'ok'
       AND state.head IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM realm_change_events events
         WHERE events.realm_id = state.realm_id
           AND (events.xid, events.seq) > (state.cursor_xid, state.cursor_seq)
       )`,
    { bind: [realmId] },
  );
  return rows.length > 0;
}
