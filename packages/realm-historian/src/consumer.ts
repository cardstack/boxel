// The journal consumer. It reads `realm_change_events` after its read
// position, in `seq` order, and hands each event to its realm's recorder.
//
// A `seq` is assigned when a row is inserted and becomes visible when its
// transaction commits, so a later `seq` can be visible while an earlier one is
// still in flight. Reading past the earlier one would skip it for good. The
// consumer therefore reads only events whose transaction is older than every
// transaction still in progress, the visibility horizon
// `pg_snapshot_xmin(pg_current_snapshot())`: nothing below it can still
// appear. A long transaction anywhere in the database holds the horizon back,
// which shows up as recording lag.

import {
  logger,
  type ChangeEvent,
  type DBAdapter,
} from '@cardstack/runtime-common';

const log = logger('realm-historian:consumer');

// Records one realm's events, strictly in order.
export interface RealmRecorder {
  record(event: ChangeEvent): Promise<void>;
}

export interface ConsumerOptions {
  db: DBAdapter;
  // The recorder for a realm, or undefined for a realm this task does not
  // record, whose events are skipped.
  recorderFor: (realmId: string) => RealmRecorder | undefined;
  // How many events one query reads. A full batch is followed by another
  // query at once.
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 1000;

export class Consumer {
  #db: DBAdapter;
  #recorderFor: ConsumerOptions['recorderFor'];
  #batchSize: number;
  #readPosition: number;

  constructor(options: ConsumerOptions, readPosition: number) {
    this.#db = options.db;
    this.#recorderFor = options.recorderFor;
    this.#batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.#readPosition = readPosition;
  }

  // The last `seq` read. It only advances.
  get readPosition(): number {
    return this.#readPosition;
  }

  // Reads every event below the horizon after the read position, batch by
  // batch until a batch comes back short, and returns how many were read.
  async poll(): Promise<number> {
    let total = 0;
    let batch: ChangeEvent[];
    do {
      batch = await this.#readBatch();
      for (let event of batch) {
        let recorder = this.#recorderFor(event.realmId);
        if (recorder) {
          await recorder.record(event);
        } else {
          log.debug(
            `skipping event ${event.seq} for realm ${event.realmId}, which this task does not record`,
          );
        }
        this.#readPosition = event.seq;
      }
      total += batch.length;
    } while (batch.length === this.#batchSize);
    return total;
  }

  async #readBatch(): Promise<ChangeEvent[]> {
    let [{ horizon }] = await this.#db.execute(
      `SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS horizon`,
    );
    let rows = await this.#db.execute(
      `SELECT seq, realm_id, realm_url, occurred_at, author, channel, agent,
              room, operation_id, correlation_id, partial, push_id, push_final,
              intent, changes
       FROM realm_change_events
       WHERE seq > $1 AND xid < $2::xid8
       ORDER BY seq
       LIMIT $3`,
      { bind: [this.#readPosition, horizon as string, this.#batchSize] },
    );
    return rows.map(changeEventFromRow);
  }
}

// The `seq` of the newest journal row, or 0 for an empty journal.
export async function journalTail(db: DBAdapter): Promise<number> {
  let [{ tail }] = await db.execute(
    `SELECT COALESCE(MAX(seq), 0)::text AS tail FROM realm_change_events`,
  );
  return Number(tail);
}

function changeEventFromRow(row: Record<string, unknown>): ChangeEvent {
  let occurredAt = row.occurred_at;
  return {
    seq: Number(row.seq),
    realmId: row.realm_id as string,
    realmURL: row.realm_url as string,
    occurredAt:
      occurredAt instanceof Date
        ? occurredAt.toISOString()
        : String(occurredAt),
    author: row.author as string,
    channel: row.channel as ChangeEvent['channel'],
    agent: (row.agent as string | null) ?? undefined,
    room: (row.room as string | null) ?? undefined,
    operationId: (row.operation_id as string | null) ?? undefined,
    correlationId: (row.correlation_id as string | null) ?? undefined,
    partial: row.partial as boolean,
    pushId: (row.push_id as string | null) ?? undefined,
    pushFinal: row.push_final as boolean,
    intent: (row.intent as ChangeEvent['intent'] | null) ?? undefined,
    changes: row.changes as ChangeEvent['changes'],
  };
}
