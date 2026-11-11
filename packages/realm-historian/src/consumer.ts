// The journal consumer. It reads `realm_change_events` after its read
// position and hands each event to its realm's recorder.
//
// A `seq` is assigned when a row is inserted and becomes visible when its
// transaction commits, so a later `seq` can be visible while an earlier one is
// still in flight. The consumer therefore reads only events whose transaction
// is older than every transaction still in progress, the visibility horizon
// `pg_snapshot_xmin(pg_current_snapshot())`, taken in the statement that
// reads them: nothing below it can still appear. A long transaction anywhere
// in the database holds the horizon back, which shows up as recording lag.
//
// The horizon is a transaction id, so the read position is one too: the pair
// `(xid, seq)`, and events are read in that order. A transaction's `xid` is
// assigned at its first write, before its journal row's `seq`, so two
// overlapping writes can commit with their `xid` and `seq` in opposite orders;
// a position kept by `seq` alone would pass over the one whose older
// transaction committed later. Writes to different files of one realm overlap
// too (the realm's advisory lock is shared between them), so a realm's events
// arrive in `(xid, seq)` order, not `seq` order, and its cursor is the same
// pair: the last event its recorder recorded.

import {
  logger,
  type ChangeEvent,
  type DBAdapter,
} from '@cardstack/runtime-common';

const log = logger('realm-historian:consumer');

// Records one realm's events, strictly in the order they are handed over,
// which is `(xid, seq)` order. A recorder keeps the pair of the last event it
// recorded as the realm's cursor, and ignores an event at or below it: the
// consumer reads from the lowest cursor among its realms, and moves back to
// a gained realm's cursor, so an event can be handed over twice.
export interface RealmRecorder {
  record(event: ChangeEvent): Promise<void>;
}

// Where the consumer reads from, and what a realm's cursor is: an event's
// transaction id (a `xid8`, carried as text) and its `seq`.
export interface ReadPosition {
  xid: string;
  seq: number;
}

export const JOURNAL_START: ReadPosition = { xid: '0', seq: 0 };

export function comparePositions(a: ReadPosition, b: ReadPosition): number {
  let byXid = BigInt(a.xid) < BigInt(b.xid) ? -1 : a.xid === b.xid ? 0 : 1;
  return byXid !== 0 ? byXid : a.seq - b.seq;
}

export interface ConsumerOptions {
  db: DBAdapter;
  // The recorder for the event's realm, or undefined for a realm this task
  // does not record, whose events are skipped.
  recorderFor: (
    event: ChangeEvent,
  ) => RealmRecorder | undefined | Promise<RealmRecorder | undefined>;
  // How many events one query reads. A full batch is followed by another
  // query at once.
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 1000;

export class Consumer {
  #db: DBAdapter;
  #recorderFor: ConsumerOptions['recorderFor'];
  #batchSize: number;
  #position: ReadPosition;
  // Set when a rewind moves the position, so a poll in progress reads again
  // from it.
  #rewound = false;

  constructor(options: ConsumerOptions, position: ReadPosition) {
    this.#db = options.db;
    this.#recorderFor = options.recorderFor;
    this.#batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.#position = position;
  }

  get position(): ReadPosition {
    return this.#position;
  }

  // Moves the position back, so events after `position` are read again. A
  // recorder ignores events at or below its realm's cursor, so a re-read
  // costs queries and nothing else. A rewind made while a poll looks up an
  // event's recorder takes effect before that event is handed over: the poll
  // reads again from the new position, and the event comes after the ones
  // the rewind brought back.
  rewindTo(position: ReadPosition): void {
    if (comparePositions(position, this.#position) < 0) {
      this.#position = position;
      this.#rewound = true;
    }
  }

  // Reads every event below the horizon after the position, batch by batch
  // until a batch comes back short, and returns how many were handed over.
  // `keepGoing` is consulted before each event; a false ends the poll with
  // the position at the last event handed over.
  async poll(keepGoing: () => boolean = () => true): Promise<number> {
    let total = 0;
    let more: boolean;
    do {
      this.#rewound = false;
      let batch = await this.#readBatch();
      more = batch.length === this.#batchSize;
      for (let event of batch) {
        if (!keepGoing()) {
          return total;
        }
        let recorder = await this.#recorderFor(event);
        if (this.#rewound) {
          more = true;
          break;
        }
        if (recorder) {
          await recorder.record(event);
        } else {
          log.debug(
            `skipping event ${event.seq} for realm ${event.realmId}, which this task does not record`,
          );
        }
        this.#position = { xid: event.xid, seq: event.seq };
        total++;
      }
    } while (more);
    return total;
  }

  async #readBatch(): Promise<ChangeEvent[]> {
    let rows = await this.#db.execute(
      `SELECT seq, xid::text AS xid, realm_id, realm_url, occurred_at, author,
              channel, agent, room, operation_id, correlation_id, partial,
              push_id, push_final, intent, changes
       FROM realm_change_events
       WHERE (xid, seq) > ($1::xid8, $2::bigint)
         AND xid < pg_snapshot_xmin(pg_current_snapshot())
       ORDER BY xid, seq
       LIMIT $3`,
      {
        bind: [this.#position.xid, this.#position.seq, this.#batchSize],
      },
    );
    return rows.map(changeEventFromRow);
  }
}

// The visibility horizon: the oldest transaction still in progress. Every
// event whose `xid` is below it has committed or rolled back.
export async function currentHorizon(db: DBAdapter): Promise<string> {
  let [{ horizon }] = await db.execute(
    `SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS horizon`,
  );
  return horizon as string;
}

// The position below which every one of the realms' events is recorded: the
// lowest of their cursors. A realm that has recorded nothing has the cursor
// `JOURNAL_START`, so one such realm starts the read from the beginning.
export function positionOfCursors(cursors: ReadPosition[]): ReadPosition {
  let lowest = JOURNAL_START;
  for (let [index, cursor] of cursors.entries()) {
    if (index === 0 || comparePositions(cursor, lowest) < 0) {
      lowest = cursor;
    }
  }
  return lowest;
}

// A journal row as the consumer reads it, with `xid` as text and
// `occurred_at` as an ISO timestamp.
export function changeEventFromRow(row: Record<string, unknown>): ChangeEvent {
  let occurredAt = row.occurred_at;
  return {
    seq: Number(row.seq),
    xid: row.xid as string,
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
