import QUnit from 'qunit';
const { module, test } = QUnit;
import type { LeaseLostError } from '../src/lease.ts';
import { LeaseManager, shardOf } from '../src/lease.ts';
import { setupTestDatabase, sleep, waitUntil } from './helpers.ts';

const RENEW_MS = 50;
const EXPIRY_MS = 300;

module('lease', (hooks) => {
  let database = setupTestDatabase(hooks);
  let managers: LeaseManager[] = [];
  // QUnit runs afterEach hooks last-registered first, so the managers stop
  // their timers before the database closes.
  hooks.afterEach(async () => {
    for (let created of managers.splice(0)) {
      await created.abandon();
    }
  });

  function manager(
    holder: string,
    { shardCount = 1, taskCount = 1 } = {},
  ): LeaseManager {
    let created = new LeaseManager(database.another(), {
      shardCount,
      taskCount,
      renewMs: RENEW_MS,
      expiryMs: EXPIRY_MS,
      holder,
    });
    managers.push(created);
    return created;
  }

  async function holderOf(shard: number): Promise<string | undefined> {
    let rows = await database.db.execute(
      `SELECT holder FROM realm_historian_leases WHERE shard = $1`,
      { bind: [String(shard)] },
    );
    return rows[0]?.holder as string | undefined;
  }

  test('one task holds shard 0 and a second task waits', async (assert) => {
    let first = manager('first');
    let second = manager('second');
    await first.start(() => {});
    await second.start(() => {});
    assert.deepEqual(first.held, [0], 'the first task holds the shard');
    assert.deepEqual(second.held, [], 'the second task holds nothing');
    await sleep(RENEW_MS * 4);
    assert.deepEqual(second.held, [], 'the second task keeps waiting');
    assert.strictEqual(await holderOf(0), 'first');
  });

  test('a holder that stops renewing loses the shard at the expiry', async (assert) => {
    let first = manager('first');
    let second = manager('second');
    await first.start(() => {});
    await second.start(() => {});
    let abandonedAt = Date.now();
    await first.abandon();
    await waitUntil(() => second.held.length > 0, {
      what: 'the second task to take the shard',
    });
    let waited = Date.now() - abandonedAt;
    assert.deepEqual(second.held, [0]);
    assert.true(
      waited >= EXPIRY_MS - RENEW_MS,
      `the shard was taken only once the lease expired (after ${waited}ms)`,
    );
    assert.strictEqual(await holderOf(0), 'second');
  });

  test('a released shard is taken on the next tick', async (assert) => {
    let first = manager('first');
    let second = manager('second');
    await first.start(() => {});
    await second.start(() => {});
    let releasedAt = Date.now();
    await first.stop();
    await waitUntil(() => second.held.length > 0, {
      what: 'the second task to take the shard',
    });
    let waited = Date.now() - releasedAt;
    assert.true(
      waited < EXPIRY_MS,
      `the shard was taken before the lease would have expired (after ${waited}ms)`,
    );
    assert.strictEqual(await holderOf(0), 'second');
  });

  test('a shard taken by another holder is reported lost', async (assert) => {
    let first = manager('first');
    let lost: LeaseLostError | undefined;
    await first.start((error) => (lost = error));
    await database.db.execute(
      `UPDATE realm_historian_leases
       SET holder = 'intruder', expires_at = now() + interval '1 hour'
       WHERE shard = '0'`,
    );
    await waitUntil(() => lost !== undefined, { what: 'the loss report' });
    assert.deepEqual(lost!.shards, [0]);
    assert.deepEqual(first.held, [], 'the task holds nothing after the loss');
    assert.strictEqual(
      await holderOf(0),
      'intruder',
      'the lost row is left to its new holder',
    );
  });

  test('the tasks of one service share the shards evenly', async (assert) => {
    let first = manager('first', { shardCount: 4, taskCount: 2 });
    let second = manager('second', { shardCount: 4, taskCount: 2 });
    await first.start(() => {});
    await second.start(() => {});
    assert.deepEqual(first.held, [0, 1]);
    assert.deepEqual(second.held, [2, 3]);
  });

  test('shardOf is stable and within range', (assert) => {
    let ids = [
      '0b7c3a1e-6d2f-4a5b-9c8d-1e2f3a4b5c6d',
      '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a',
      '12345678-9abc-4def-8123-456789abcdef',
      'fedcba98-7654-4321-8fed-cba987654321',
    ];
    let shards = ids.map((id) => shardOf(id, 64));
    assert.deepEqual(
      shards,
      ids.map((id) => shardOf(id, 64)),
      'the same id hashes to the same shard',
    );
    assert.true(shards.every((shard) => shard >= 0 && shard < 64));
    assert.true(
      new Set(shards).size > 1,
      'different ids land in different shards',
    );
    assert.true(ids.every((id) => shardOf(id, 1) === 0));
  });
});
