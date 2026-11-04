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
const EXPIRY_MS = 300;
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
    { shardCount = 1, taskCount = 1 } = {},
  ): Historian {
    let created = new Historian({
      db: database.another(),
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
      recorderFor: () => ({
        record: async (event) => void recorded.push(event),
      }),
    });
    historians.push(created);
    created.run().catch(() => {});
    return created;
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
    let realms: TestRealm[] = [];
    for (let i = 0; realms.length < 2 && i < 50; i++) {
      let realm = await insertRealm(database.db, {
        url: `http://localhost:4201/test-user/realm-${i}/`,
        diskId: `test-user/realm-${i}`,
      });
      let shard = shardOf(realm.id, shardCount);
      if (!realms.some((known) => shardOf(known.id, shardCount) === shard)) {
        realms.push(realm);
      }
    }
    // Another holder takes the first free shard before the task starts; the
    // task, whose share is both shards, holds the other and keeps trying for
    // the first.
    let other = new LeaseManager(database.another(), {
      shardCount,
      taskCount: 2,
      renewMs: RENEW_MS,
      expiryMs: EXPIRY_MS,
      holder: 'other',
    });
    managers.push(other);
    await other.start(() => {});
    let task = historian('task', { shardCount, taskCount: 1 });
    await waitUntil(() => task.held.length === 1, { what: 'the lease' });
    assert.deepEqual(other.held, [0]);
    assert.deepEqual(task.held, [1]);
    let first = realms.find((realm) => shardOf(realm.id, shardCount) === 1)!;
    let second = realms.find((realm) => shardOf(realm.id, shardCount) === 0)!;

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
