// Each test module gets its own migrated database on the Postgres the `PG*`
// variables name, created before each test and dropped after it.

import { PgAdapter } from '@cardstack/postgres';
import {
  dbAdapterQuerier,
  param,
  type ChangeEvent,
  type ChangeEventChange,
  type ChangeIntent,
  type DBAdapter,
  type Querier,
  type WriteChannel,
} from '@cardstack/runtime-common';
import {
  changeEventFromRow,
  JOURNAL_START,
  type ReadPosition,
} from '../src/consumer.ts';

let databaseCounter = 0;

export interface TestDatabase {
  readonly db: PgAdapter;
  // A second adapter on the same database, for a connection the test holds
  // open independently of `db`.
  another(): PgAdapter;
}

export function setupTestDatabase(hooks: NestedHooks): TestDatabase {
  let db: PgAdapter | undefined;
  let others: PgAdapter[] = [];
  let name: string | undefined;
  let previousName: string | undefined;

  hooks.beforeEach(async () => {
    previousName = process.env.PGDATABASE;
    name = `test_realm_historian_${process.pid}_${++databaseCounter}`;
    process.env.PGDATABASE = name;
    db = new PgAdapter({ autoMigrate: true, migrationLogging: false });
    await db.execute('SELECT 1');
  });

  hooks.afterEach(async () => {
    for (let other of others.splice(0)) {
      if (!other.isClosed) {
        await other.close();
      }
    }
    if (db && !db.isClosed) {
      await db.close();
    }
    await dropDatabase(name!);
    process.env.PGDATABASE = previousName;
  });

  return {
    get db() {
      return db!;
    },
    another() {
      let other = new PgAdapter();
      others.push(other);
      return other;
    },
  };
}

async function dropDatabase(name: string): Promise<void> {
  let current = process.env.PGDATABASE;
  process.env.PGDATABASE = 'postgres';
  let admin = new PgAdapter();
  try {
    await admin.execute(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.close();
    process.env.PGDATABASE = current;
  }
}

export interface TestRealm {
  id: string;
  url: string;
}

// A source realm with recording on, unless `enabled` says otherwise.
export async function insertRealm(
  db: DBAdapter,
  {
    url,
    kind = 'source',
    diskId = 'test-user/test-realm',
    enabled = true,
    cursor = JOURNAL_START,
  }: {
    url: string;
    kind?: 'source' | 'published' | 'bootstrap';
    diskId?: string;
    enabled?: boolean;
    cursor?: ReadPosition;
  },
): Promise<TestRealm> {
  let [{ id }] = await db.execute(
    `INSERT INTO realm_registry (url, kind, disk_id, owner_username, source_url)
     VALUES ($1, $2, $3, 'test-user', $4) RETURNING id`,
    {
      bind: [
        url,
        kind,
        diskId,
        kind === 'published' ? 'http://localhost:4201/test-user/source/' : null,
      ],
    },
  );
  await db.execute(
    `INSERT INTO realm_history_state (realm_id, enabled, cursor_xid, cursor_seq)
     VALUES ($1, $2, $3::xid8, $4)`,
    { bind: [id, enabled, cursor.xid, cursor.seq] },
  );
  return { id: id as string, url };
}

// Sets a realm's cursor, as its recorder does after recording `position`.
export async function setCursor(
  db: DBAdapter,
  realm: TestRealm,
  position: ReadPosition,
): Promise<void> {
  await db.execute(
    `UPDATE realm_history_state SET cursor_xid = $2::xid8, cursor_seq = $3
     WHERE realm_id = $1`,
    { bind: [realm.id, position.xid, position.seq] },
  );
}

// A journal row for one modified path, written through `querier` so a test
// can insert it on a transaction it holds open. Returns its `seq`;
// `insertEventAt` returns its position.
export async function insertEvent(
  querier: Querier,
  realm: TestRealm,
  path = 'card.json',
): Promise<number> {
  return (await insertEventAt(querier, realm, path)).seq;
}

export async function insertEventAt(
  querier: Querier,
  realm: TestRealm,
  path = 'card.json',
): Promise<ReadPosition> {
  let [{ seq, xid }] = await querier([
    `INSERT INTO realm_change_events
       (realm_id, realm_url, author, channel, changes)
     VALUES (`,
    param(realm.id),
    ', ',
    param(realm.url),
    `, '@test-user:localhost', 'api', `,
    param(JSON.stringify([{ path, status: 'M' }])),
    `::jsonb) RETURNING seq::text, xid::text`,
  ]);
  return { xid: xid as string, seq: Number(seq) };
}

export interface EventFields {
  changes: ChangeEventChange[];
  author?: string;
  channel?: WriteChannel;
  agent?: string;
  room?: string;
  operationId?: string;
  correlationId?: string;
  partial?: boolean;
  pushId?: string;
  pushFinal?: boolean;
  intent?: ChangeIntent;
  // The database's `now()` when left out.
  occurredAt?: Date;
}

// A journal row with its path rows, as the realm server's journal writes
// them, read back as the consumer reads it.
export async function appendEvent(
  db: DBAdapter,
  realm: TestRealm,
  fields: EventFields,
): Promise<ChangeEvent> {
  return appendEventOn(dbAdapterQuerier(db), realm, fields);
}

// `appendEvent` through `querier`, so a test can append on a transaction it
// holds open.
export async function appendEventOn(
  querier: Querier,
  realm: TestRealm,
  fields: EventFields,
): Promise<ChangeEvent> {
  let [row] = await querier([
    `WITH event AS (
       INSERT INTO realm_change_events
         (realm_id, realm_url, occurred_at, author, channel, agent, room,
          operation_id, correlation_id, partial, push_id, push_final, intent,
          changes)
       VALUES (`,
    param(realm.id),
    ',',
    param(realm.url),
    ', COALESCE(',
    param(fields.occurredAt?.toISOString() ?? null),
    '::timestamptz, now()),',
    param(fields.author ?? '@test-user:localhost'),
    ',',
    param(fields.channel ?? 'host'),
    ',',
    param(fields.agent ?? null),
    ',',
    param(fields.room ?? null),
    ',',
    param(fields.operationId ?? null),
    ',',
    param(fields.correlationId ?? null),
    ',',
    param(fields.partial ?? false),
    ',',
    param(fields.pushId ?? null),
    ',',
    param(fields.pushFinal ?? false),
    ',',
    param(fields.intent ? JSON.stringify(fields.intent) : null),
    '::jsonb,',
    param(JSON.stringify(fields.changes)),
    `::jsonb)
       RETURNING *
     ), event_paths AS (
       INSERT INTO realm_change_event_paths (realm_id, path, seq)
       SELECT event.realm_id, changed.path, event.seq
       FROM event, jsonb_array_elements_text(`,
    param(JSON.stringify([...new Set(fields.changes.map(({ path }) => path))])),
    `::jsonb) AS changed(path)
       ON CONFLICT DO NOTHING
     )
     SELECT seq, xid::text AS xid, realm_id, realm_url, occurred_at, author,
            channel, agent, room, operation_id, correlation_id, partial,
            push_id, push_final, intent, changes
     FROM event`,
  ]);
  return changeEventFromRow(row);
}

export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  { timeoutMs = 5000, intervalMs = 20, what = 'condition' } = {},
): Promise<void> {
  let deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    }
    await sleep(intervalMs);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
