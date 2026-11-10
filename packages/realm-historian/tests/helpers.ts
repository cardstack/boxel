// Each test module gets its own migrated database on the Postgres the `PG*`
// variables name, created before each test and dropped after it.

import { PgAdapter } from '@cardstack/postgres';
import { param, type DBAdapter, type Querier } from '@cardstack/runtime-common';
import { JOURNAL_START, type ReadPosition } from '../src/consumer.ts';

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
