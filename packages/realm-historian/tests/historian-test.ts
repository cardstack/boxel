import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dbAdapterQuerier,
  REALM_CHANGE_EVENTS_CHANNEL,
  type ChangeEvent,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { Historian } from '../src/historian.ts';
import { Heartbeat } from '../src/health.ts';
import { LeaseManager, shardOf } from '../src/lease.ts';
import {
  insertEvent,
  insertRealm,
  setupTestDatabase,
  sleep,
  waitUntil,
  type TestRealm,
} from './helpers.ts';

const RENEW_MS = 50;
// Long enough that a busy machine doesn't push a renewal past its deadline.
const EXPIRY_MS = 1000;
// Long enough that only a wakeup, not the timer, explains a prompt read.
const POLL_MS = 5000;

module('historian', (hooks) => {
  let database = setupTestDatabase(hooks);
  let historians: Historian[] = [];
  let managers: LeaseManager[] = [];
  let root: string;
  let recorded: ChangeEvent[];

  hooks.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'realm-historian-'));
    recorded = [];
  });

  hooks.afterEach(async () => {
    for (let historian of historians.splice(0)) {
      await historian.stop();
    }
    for (let manager of managers.splice(0)) {
      await manager.abandon();
    }
    await rm(root, { recursive: true, force: true });
  });

  function historian(
    holder: string,
    {
      shardCount = 1,
      taskCount = 1,
      db = database.another(),
      record = async (event: ChangeEvent) => void recorded.push(event),
    }: {
      shardCount?: number;
      taskCount?: number;
      db?: PgAdapter;
      record?: (event: ChangeEvent) => Promise<void>;
    } = {},
  ): Historian {
    let created = new Historian({
      db,
      historyRoot: join(root, holder, 'history'),
      realmsRoot: join(root, 'realms'),
      heartbeat: new Heartbeat(),
      pollMs: POLL_MS,
      lease: {
        shardCount,
        taskCount,
        renewMs: RENEW_MS,
        expiryMs: EXPIRY_MS,
        holder,
      },
      recorderFor: () => ({ record }),
    });
    historians.push(created);
    created.run().catch(() => {});
    return created;
  }

  // One realm in each shard, indexed by shard.
  async function realmPerShard(shardCount: number): Promise<TestRealm[]> {
    let realms: TestRealm[] = [];
    for (let i = 0; realms.filter(Boolean).length < shardCount && i < 50; i++) {
      let realm = await insertRealm(database.db, {
        url: `http://localhost:4201/test-user/realm-${i}/`,
        diskId: `test-user/realm-${i}`,
      });
      realms[shardOf(realm.id, shardCount)] ??= realm;
    }
    return realms;
  }

  // Another task's lease manager, which takes the first free shard of two.
  async function otherHolder(shardCount: number): Promise<LeaseManager> {
    let other = new LeaseManager(database.another(), {
      shardCount,
      taskCount: 2,
      renewMs: RENEW_MS,
      expiryMs: EXPIRY_MS,
      holder: 'other',
    });
    managers.push(other);
    await other.start(() => {});
    return other;
  }

  // A recorder that holds the poll at `seq` until the returned `release`.
  function holdAt(seq: () => number) {
    let release!: () => void;
    let released = new Promise<void>((resolve) => (release = resolve));
    let holding = false;
    return {
      get holding() {
        return holding;
      },
      release,
      record: async (event: ChangeEvent) => {
        recorded.push(event);
        if (event.seq === seq() && !holding) {
          holding = true;
          await released;
        }
      },
    };
  }

  // The journal's own wakeup: the realm's id on the channel.
  async function notify(realm: TestRealm) {
    await database.db.notify(REALM_CHANGE_EVENTS_CHANNEL, realm.id);
  }

  test('a wakeup naming a held realm reads its event at once', async (assert) => {
    let realm = await insertRealm(database.db, {
      url: 'http://localhost:4201/test-user/test-realm/',
    });
    let task = historian('task');
    await waitUntil(() => task.realms.has(realm.id), {
      what: 'the realm to load',
    });
    let seq = await insertEvent(dbAdapterQuerier(database.db), realm);
    await sleep(200);
    assert.deepEqual(recorded, [], 'nothing is read before the wakeup');
    await notify(realm);
    await waitUntil(() => recorded.length === 1, {
      timeoutMs: 1000,
      what: 'the event to be read on the wakeup',
    });
    assert.strictEqual(recorded[0].seq, seq);
  });

  test('a realm enabled after startup is loaded for its first event', async (assert) => {
    let task = historian('task');
    await waitUntil(() => task.held.length > 0, { what: 'the lease' });
    let realm = await insertRealm(database.db, {
      url: 'http://localhost:4201/test-user/late-realm/',
    });
    let seq = await insertEvent(dbAdapterQuerier(database.db), realm);
    await notify(realm);
    await waitUntil(() => recorded.length === 1, {
      timeoutMs: 1000,
      what: 'the late realm to be loaded and its event read',
    });
    assert.strictEqual(recorded[0].seq, seq);
    assert.true(task.realms.has(realm.id));
  });

  test("a wakeup for another task's shard is ignored", async (assert) => {
    let shardCount = 2;
    let [second, first] = await realmPerShard(shardCount);
    // Another holder takes the first free shard before the task starts; the
    // task, whose share is both shards, holds the other and keeps trying for
    // the first.
    let other = await otherHolder(shardCount);
    let task = historian('task', { shardCount, taskCount: 1 });
    // Its realm's load comes after the lease and right before the first
    // poll, so the events below arrive after that poll.
    await waitUntil(() => task.realms.has(first.id), {
      what: "the task's realm to load",
    });
    assert.deepEqual(other.held, [0]);
    assert.deepEqual(task.held, [1]);

    let querier = dbAdapterQuerier(database.db);
    let mine = await insertEvent(querier, first, 'mine.json');
    let theirs = await insertEvent(querier, second, 'theirs.json');
    await notify(second);
    await sleep(300);
    assert.deepEqual(
      recorded,
      [],
      "the other shard's wakeup doesn't wake the task",
    );
    await notify(first);
    await waitUntil(() => recorded.length === 1, {
      timeoutMs: 1000,
      what: 'the task to read its own realm',
    });
    assert.strictEqual(recorded[0].seq, mine);

    // The other holder goes away; the task gains shard 1 and reads the
    // event it passed over.
    await other.abandon();
    await waitUntil(() => task.held.length === 2, {
      what: 'the task to gain the second shard',
    });
    // The position moves back to the gained realm's cursor, so the task's
    // own event is read again on the way; its recorder is the one that
    // ignores it.
    await waitUntil(() => recorded.some((event) => event.seq === theirs), {
      timeoutMs: 2000,
      what: "the gained shard's event to be read",
    });
    assert.deepEqual(
      recorded.map((event) => event.seq),
      [mine, mine, theirs],
    );
  });

  test("a shard gained during a poll brings its realm's earlier events first", async (assert) => {
    let shardCount = 2;
    let [theirs, mine] = await realmPerShard(shardCount);
    let querier = dbAdapterQuerier(database.db);
    let before = await insertEvent(querier, theirs, 'before.json');
    let own = await insertEvent(querier, mine, 'own.json');
    let after = await insertEvent(querier, theirs, 'after.json');
    let other = await otherHolder(shardCount);
    // The poll is held at the task's own event until the task has gained the
    // other shard, so the gain falls between the other realm's two events.
    let recorder = holdAt(() => own);
    let task = historian('task', { shardCount, record: recorder.record });
    await waitUntil(() => recorder.holding, { what: 'the poll to be held' });
    assert.deepEqual(task.held, [1]);
    await other.abandon();
    await waitUntil(() => task.held.length === 2, {
      what: 'the task to gain the other shard',
    });
    recorder.release();
    await waitUntil(() => recorded.some((event) => event.seq === after), {
      timeoutMs: 2000,
      what: "the gained realm's later event",
    });
    assert.deepEqual(
      recorded
        .filter((event) => event.realmId === theirs.id)
        .map((event) => event.seq),
      [before, after],
      "the gained realm's event from before the gain is handed over, ahead of its later one",
    );
  });

  test('a wakeup that comes during a poll is kept', async (assert) => {
    let realm = await insertRealm(database.db, {
      url: 'http://localhost:4201/test-user/test-realm/',
    });
    let querier = dbAdapterQuerier(database.db);
    let first = await insertEvent(querier, realm, 'first.json');
    let recorder = holdAt(() => first);
    historian('task', { record: recorder.record });
    await waitUntil(() => recorder.holding, { what: 'the poll to be held' });
    let second = await insertEvent(querier, realm, 'second.json');
    await notify(realm);
    // Time for the wakeup to arrive while the poll is still held.
    await sleep(100);
    recorder.release();
    await waitUntil(() => recorded.some((event) => event.seq === second), {
      timeoutMs: 1000,
      what: 'the second event to be read on the wakeup',
    });
    assert.deepEqual(
      recorded.map((event) => event.seq),
      [first, second],
    );
  });

  test("a backlog for a realm that isn't recorded costs one load of the realms", async (assert) => {
    let realm = await insertRealm(database.db, {
      url: 'http://localhost:4201/test-user/test-realm/',
    });
    let db = database.another();
    let loads = 0;
    let execute = db.execute.bind(db);
    db.execute = (sql, options) => {
      if (sql.includes('FROM realm_history_state state')) {
        loads++;
      }
      return execute(sql, options);
    };
    let task = historian('task', { db });
    await waitUntil(() => task.realms.has(realm.id), {
      what: 'the realm to load',
    });
    let loadsAtStart = loads;
    // Events for a realm whose recording is off, as a realm disabled before
    // its events were read leaves them.
    let off = await insertRealm(database.db, {
      url: 'http://localhost:4201/test-user/off-realm/',
      diskId: 'test-user/off-realm',
      enabled: false,
    });
    let querier = dbAdapterQuerier(database.db);
    for (let i = 0; i < 5; i++) {
      await insertEvent(querier, off, `${i}.json`);
    }
    let last = await insertEvent(querier, realm, 'last.json');
    await notify(realm);
    await waitUntil(() => recorded.some((event) => event.seq === last), {
      timeoutMs: 1000,
      what: "the recorded realm's event after the backlog",
    });
    assert.strictEqual(
      loads - loadsAtStart,
      1,
      'the first of the five events loads the realms, and that load covers the rest',
    );
    assert.deepEqual(
      recorded.map((event) => event.seq),
      [last],
    );
  });

  test('a stop ends a poll between events and releases the lease', async (assert) => {
    let realm = await insertRealm(database.db, {
      url: 'http://localhost:4201/test-user/test-realm/',
    });
    let seen = 0;
    let task = new Historian({
      db: database.another(),
      historyRoot: join(root, 'history'),
      realmsRoot: join(root, 'realms'),
      heartbeat: new Heartbeat(),
      pollMs: POLL_MS,
      lease: {
        shardCount: 1,
        taskCount: 1,
        renewMs: RENEW_MS,
        expiryMs: EXPIRY_MS,
        holder: 'task',
      },
      recorderFor: () => ({
        record: async () => {
          seen++;
          if (seen === 2) {
            void task.stop();
          }
          await sleep(20);
        },
      }),
    });
    historians.push(task);
    let querier = dbAdapterQuerier(database.db);
    for (let i = 0; i < 10; i++) {
      await insertEvent(querier, realm, `${i}.json`);
    }
    await task.run();
    assert.strictEqual(seen, 2, 'the poll ended after the event in progress');
    let leases = await database.db.execute(
      `SELECT holder FROM realm_historian_leases`,
    );
    assert.deepEqual(leases, [], 'the lease was released');
  });
});
