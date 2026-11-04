// The realms a task records: every realm whose `realm_history_state.enabled`
// is set, with its directory from `realm_registry`, in the shards the task
// holds. A published realm is never recorded, whatever its state row says.

import { join } from 'node:path';
import type { DBAdapter } from '@cardstack/runtime-common';
import { shardOf } from './lease.ts';

export interface RecordedRealm {
  // The `realm_registry.id`, permanent for the realm's life.
  id: string;
  url: string;
  kind: 'source' | 'bootstrap';
  shard: number;
  // The realm's files on disk: a source realm's `disk_id` under the realms
  // root, or a bootstrap realm's absolute path.
  directory: string;
  // The last journal `seq` recorded for the realm.
  cursorSeq: number;
  head: string | undefined;
}

export interface LoadRealmsOptions {
  db: DBAdapter;
  realmsRoot: string;
  shardCount: number;
  holds: (shard: number) => boolean;
}

export async function loadRecordedRealms({
  db,
  realmsRoot,
  shardCount,
  holds,
}: LoadRealmsOptions): Promise<Map<string, RecordedRealm>> {
  let rows = await db.execute(
    `SELECT registry.id, registry.url, registry.kind, registry.disk_id,
            state.cursor_seq::text AS cursor_seq, state.head
     FROM realm_history_state state
     JOIN realm_registry registry ON registry.id = state.realm_id
     WHERE state.enabled AND registry.kind <> 'published'
     ORDER BY registry.url`,
  );
  let realms = new Map<string, RecordedRealm>();
  for (let row of rows) {
    let id = row.id as string;
    let shard = shardOf(id, shardCount);
    if (!holds(shard)) {
      continue;
    }
    let kind = row.kind as RecordedRealm['kind'];
    let diskId = row.disk_id as string;
    realms.set(id, {
      id,
      url: row.url as string,
      kind,
      shard,
      directory: kind === 'bootstrap' ? diskId : join(realmsRoot, diskId),
      cursorSeq: Number(row.cursor_seq),
      head: (row.head as string | null) ?? undefined,
    });
  }
  return realms;
}

// Where the consumer starts: the lowest cursor among the realms, so no
// realm's unrecorded events are passed over.
export function lowestCursor(
  realms: Iterable<RecordedRealm>,
): number | undefined {
  let lowest: number | undefined;
  for (let realm of realms) {
    if (lowest === undefined || realm.cursorSeq < lowest) {
      lowest = realm.cursorSeq;
    }
  }
  return lowest;
}
