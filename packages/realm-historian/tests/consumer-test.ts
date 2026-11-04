import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  dbAdapterQuerier,
  type ChangeEvent,
  type Querier,
} from '@cardstack/runtime-common';
import { Consumer, journalTail } from '../src/consumer.ts';
import { loadRecordedRealms, lowestCursor } from '../src/realms.ts';
import {
  insertEvent,
  insertRealm,
  setupTestDatabase,
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
      0,
    );
  });

  function querier(): Querier {
    return dbAdapterQuerier(database.db);
  }

  test('an event in an open transaction holds back a later committed one', async (assert) => {
    let other = database.another();
    let release!: () => void;
    let released = new Promise<void>((resolve) => (release = resolve));
    let firstSeq!: number;
    let open = other.withTransaction(async (tx) => {
      firstSeq = await insertEvent(tx, realm, 'first.json');
      await released;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    let secondSeq = await insertEvent(querier(), realm, 'second.json');
    assert.true(secondSeq > firstSeq, 'the later event has the higher seq');

    assert.strictEqual(
      await consumer.poll(),
      0,
      'nothing is read while the earlier transaction is open',
    );
    assert.strictEqual(consumer.readPosition, 0);

    release();
    await open;
    assert.strictEqual(await consumer.poll(), 2);
    assert.deepEqual(
      recorded.map((event) => event.seq),
      [firstSeq, secondSeq],
      'both events arrive, in seq order',
    );
    assert.strictEqual(consumer.readPosition, secondSeq);
    assert.deepEqual(recorded[0].changes, [
      { path: 'first.json', status: 'M' },
    ]);
    assert.strictEqual(recorded[0].realmURL, realm.url);
    assert.strictEqual(recorded[0].author, '@test-user:localhost');
    assert.strictEqual(recorded[0].channel, 'api');
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
    assert.strictEqual(consumer.readPosition, mine);
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
      0,
    );
    for (let i = 0; i < 5; i++) {
      await insertEvent(querier(), realm, `${i}.json`);
    }
    assert.strictEqual(await consumer.poll(), 5);
    assert.strictEqual(recorded.length, 5);
  });

  test('the read position starts at the lowest enabled cursor', async (assert) => {
    await insertRealm(database.db, {
      url: 'http://localhost:4201/other-user/other-realm/',
      diskId: 'other-user/other-realm',
      cursorSeq: 7,
    });
    await insertRealm(database.db, {
      url: 'http://localhost:4201/other-user/off-realm/',
      diskId: 'other-user/off-realm',
      enabled: false,
      cursorSeq: 1,
    });
    await insertRealm(database.db, {
      url: 'http://localhost:4201/other-user/published-realm/',
      kind: 'published',
      diskId: 'published-id',
      cursorSeq: 2,
    });
    await database.db.execute(
      `UPDATE realm_history_state SET cursor_seq = 9 WHERE realm_id = $1`,
      { bind: [realm.id] },
    );
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
    assert.strictEqual(lowestCursor(realms.values()), 7);
    assert.strictEqual(lowestCursor([]), undefined);
  });

  test('the journal tail is the newest seq, or 0 when empty', async (assert) => {
    assert.strictEqual(await journalTail(database.db), 0);
    let seq = await insertEvent(querier(), realm);
    assert.strictEqual(await journalTail(database.db), seq);
  });
});
