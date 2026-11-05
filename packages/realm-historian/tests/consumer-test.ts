import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  dbAdapterQuerier,
  type ChangeEvent,
  type Querier,
} from '@cardstack/runtime-common';
import {
  Consumer,
  JOURNAL_START,
  type ReadPosition,
  comparePositions,
  currentHorizon,
  positionOfCursors,
} from '../src/consumer.ts';
import { cursorsOf, loadRecordedRealms } from '../src/realms.ts';
import {
  insertEvent,
  insertEventAt,
  insertRealm,
  setCursor,
  setupTestDatabase,
  sleep,
  type TestRealm,
} from './helpers.ts';

module('consumer', (hooks) => {
  let database = setupTestDatabase(hooks);
  let realm: TestRealm;
  let recorded: ChangeEvent[];
  let consumer: Consumer;

  hooks.beforeEach(async () => {
    realm = await insertRealm(database.db, {
      url: 'http://localhost:4201/test-user/test-realm/',
    });
    recorded = [];
    consumer = new Consumer(
      {
        db: database.db,
        recorderFor: (realmId) =>
          realmId === realm.id
            ? { record: async (event) => void recorded.push(event) }
            : undefined,
      },
      JOURNAL_START,
    );
  });

  function querier(): Querier {
    return dbAdapterQuerier(database.db);
  }

  // Runs `fn` on a transaction that stays open until the returned `commit`
  // is called.
  function openTransaction(fn: (tx: Querier) => Promise<void>) {
    let other = database.another();
    let release!: () => void;
    let released = new Promise<void>((resolve) => (release = resolve));
    let done = other.withTransaction(async (tx) => {
      await fn(tx);
      await released;
    });
    return {
      commit: async () => {
        release();
        await done;
      },
    };
  }

  test('an event in an open transaction holds back a later committed one', async (assert) => {
    let firstSeq!: number;
    let open = openTransaction(async (tx) => {
      firstSeq = await insertEvent(tx, realm, 'first.json');
    });
    await sleep(50);
    let secondSeq = await insertEvent(querier(), realm, 'second.json');
    assert.true(secondSeq > firstSeq, 'the later event has the higher seq');

    assert.strictEqual(
      await consumer.poll(),
      0,
      'nothing is read while the earlier transaction is open',
    );
    assert.deepEqual(consumer.position, JOURNAL_START);

    await open.commit();
    assert.strictEqual(await consumer.poll(), 2);
    assert.deepEqual(
      recorded.map((event) => event.seq),
      [firstSeq, secondSeq],
      'both events arrive, in seq order',
    );
    assert.strictEqual(consumer.position.seq, secondSeq);
    assert.deepEqual(recorded[0].changes, [
      { path: 'first.json', status: 'M' },
    ]);
    assert.strictEqual(recorded[0].realmURL, realm.url);
    assert.strictEqual(recorded[0].author, '@test-user:localhost');
    assert.strictEqual(recorded[0].channel, 'api');
  });

  test('an older transaction that takes the later seq is still read', async (assert) => {
    let other = await insertRealm(database.db, {
      url: 'http://localhost:4201/other-user/other-realm/',
      diskId: 'other-user/other-realm',
    });
    let all: ChangeEvent[] = [];
    consumer = new Consumer(
      {
        db: database.db,
        recorderFor: () => ({ record: async (event) => void all.push(event) }),
      },
      JOURNAL_START,
    );
    // The older transaction takes its xid with a write of its own, then the
    // newer one inserts its event first, so the lower seq belongs to the
    // newer xid.
    let olderSeq!: number;
    let older = openTransaction(async (tx) => {
      await tx([`SELECT pg_current_xact_id()`]);
      await sleep(50);
      let newerSeq!: number;
      let newer = openTransaction(async (newerTx) => {
        newerSeq = await insertEvent(newerTx, other, 'newer.json');
      });
      await sleep(50);
      olderSeq = await insertEvent(tx, realm, 'older.json');
      assert.true(olderSeq > newerSeq, 'the older xid got the later seq');
      // The older transaction commits first; the newer one stays open.
      setTimeout(() => newer.commit(), 300);
    });
    await older.commit();

    assert.strictEqual(
      await consumer.poll(),
      1,
      'the committed older transaction is read while the newer one is open',
    );
    assert.strictEqual(all[0].changes[0].path, 'older.json');
    assert.strictEqual(
      consumer.position.seq,
      olderSeq,
      'the position is past the lower seq that is still in flight',
    );
    await sleep(400);
    assert.strictEqual(
      await consumer.poll(),
      1,
      'the newer transaction, with the lower seq, is read once it commits',
    );
    assert.deepEqual(
      all.map((event) => event.changes[0].path),
      ['older.json', 'newer.json'],
      'both events arrive, in transaction order',
    );
  });

  test("one realm's overlapping writes arrive in (xid, seq) order, and a restart resumes from the pair", async (assert) => {
    // Two writes to different files of one realm overlap; the older
    // transaction takes its xid first and its seq last.
    let olderAt!: ReadPosition;
    let newerAt!: ReadPosition;
    let newer!: ReturnType<typeof openTransaction>;
    let older = openTransaction(async (tx) => {
      await tx([`SELECT pg_current_xact_id()`]);
      await sleep(50);
      newer = openTransaction(async (newerTx) => {
        newerAt = await insertEventAt(newerTx, realm, 'b.json');
      });
      await sleep(50);
      olderAt = await insertEventAt(tx, realm, 'a.json');
    });
    await older.commit();
    assert.true(olderAt.seq > newerAt.seq, 'the older xid got the later seq');
    assert.true(
      comparePositions(olderAt, newerAt) < 0,
      'and the lower position',
    );

    assert.strictEqual(await consumer.poll(), 1, 'the older write is read');
    assert.deepEqual(
      recorded.map((event) => event.changes[0].path),
      ['a.json'],
    );
    assert.deepEqual(consumer.position, olderAt);

    // The recorder sets the cursor to the pair it recorded, and the task
    // restarts from it after the newer write commits.
    await setCursor(database.db, realm, olderAt);
    await newer.commit();
    let realms = await loadRecordedRealms({
      db: database.db,
      realmsRoot: '/realms',
      shardCount: 1,
      holds: () => true,
    });
    assert.deepEqual(realms.get(realm.id)!.cursor, olderAt);
    let restarted = new Consumer(
      {
        db: database.db,
        recorderFor: () => ({
          record: async (event) => void recorded.push(event),
        }),
      },
      positionOfCursors(cursorsOf(realms.values())),
    );
    assert.strictEqual(
      await restarted.poll(),
      1,
      'the newer write, with the lower seq, is read after the restart',
    );
    assert.deepEqual(
      recorded.map((event) => event.changes[0].path),
      ['a.json', 'b.json'],
      'the realm gets its events in (xid, seq) order',
    );
    assert.deepEqual(restarted.position, newerAt);
  });

  test("events for a realm the task doesn't record are passed over", async (assert) => {
    let otherRealm = await insertRealm(database.db, {
      url: 'http://localhost:4201/other-user/other-realm/',
      diskId: 'other-user/other-realm',
    });
    await insertEvent(querier(), otherRealm);
    let mine = await insertEvent(querier(), realm);
    assert.strictEqual(await consumer.poll(), 2, 'both events are read');
    assert.deepEqual(
      recorded.map((event) => event.seq),
      [mine],
      'only the recorded realm gets its event',
    );
    assert.strictEqual(consumer.position.seq, mine);
  });

  test('a full batch is followed by another query at once', async (assert) => {
    consumer = new Consumer(
      {
        db: database.db,
        batchSize: 2,
        recorderFor: () => ({
          record: async (event) => void recorded.push(event),
        }),
      },
      JOURNAL_START,
    );
    for (let i = 0; i < 5; i++) {
      await insertEvent(querier(), realm, `${i}.json`);
    }
    assert.strictEqual(await consumer.poll(), 5);
    assert.strictEqual(recorded.length, 5);
  });

  test('a poll stops between events when told to', async (assert) => {
    for (let i = 0; i < 5; i++) {
      await insertEvent(querier(), realm, `${i}.json`);
    }
    let budget = 2;
    assert.strictEqual(await consumer.poll(() => budget-- > 0), 2);
    assert.strictEqual(recorded.length, 2);
    assert.strictEqual(consumer.position.seq, recorded[1].seq);
    assert.strictEqual(await consumer.poll(), 3, 'the rest follows');
  });

  test('the position starts at the lowest cursor, or the beginning', async (assert) => {
    let other = await insertRealm(database.db, {
      url: 'http://localhost:4201/other-user/other-realm/',
      diskId: 'other-user/other-realm',
    });
    await insertRealm(database.db, {
      url: 'http://localhost:4201/other-user/off-realm/',
      diskId: 'other-user/off-realm',
      enabled: false,
    });
    await insertRealm(database.db, {
      url: 'http://localhost:4201/other-user/published-realm/',
      kind: 'published',
      diskId: 'published-id',
    });
    let mineAt = await insertEventAt(querier(), realm);
    let otherAt = await insertEventAt(querier(), other);
    await setCursor(database.db, realm, mineAt);
    await setCursor(database.db, other, otherAt);
    let realms = await loadRecordedRealms({
      db: database.db,
      realmsRoot: '/realms',
      shardCount: 1,
      holds: () => true,
    });
    assert.deepEqual(
      [...realms.values()].map((loaded) => loaded.url).sort(),
      [
        'http://localhost:4201/other-user/other-realm/',
        'http://localhost:4201/test-user/test-realm/',
      ],
      'only enabled, unpublished realms are loaded',
    );
    assert.strictEqual(
      realms.get(realm.id)!.directory,
      '/realms/test-user/test-realm',
    );
    assert.deepEqual(realms.get(realm.id)!.cursor, mineAt);
    let position = positionOfCursors(cursorsOf(realms.values()));
    assert.deepEqual(position, mineAt, 'the lowest cursor');
    assert.deepEqual(
      positionOfCursors([mineAt, JOURNAL_START]),
      JOURNAL_START,
      'a realm that has recorded nothing starts from the beginning',
    );
    assert.deepEqual(positionOfCursors([]), JOURNAL_START);
    assert.true(
      comparePositions(position, {
        xid: await currentHorizon(database.db),
        seq: 0,
      }) < 0,
      'a committed event lies below the horizon',
    );
  });
});
