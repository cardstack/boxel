import { module, test } from 'qunit';
import { basename } from 'path';
import {
  hashRealmUrlForAdvisoryLock,
  hashUserIdForCostLock,
  type PgAdapter,
} from '@cardstack/postgres';
import { setupDB } from './helpers';

module(basename(__filename), function () {
  module('hashRealmUrlForAdvisoryLock', function () {
    test('is deterministic', function (assert) {
      const url = 'http://localhost:4201/luke/my-realm/';
      assert.strictEqual(
        hashRealmUrlForAdvisoryLock(url),
        hashRealmUrlForAdvisoryLock(url),
      );
    });

    test('yields different keys for different URLs', function (assert) {
      assert.notStrictEqual(
        hashRealmUrlForAdvisoryLock('http://localhost:4201/a/'),
        hashRealmUrlForAdvisoryLock('http://localhost:4201/b/'),
      );
    });

    test('returns a string parseable as a signed 64-bit integer', function (assert) {
      const key = hashRealmUrlForAdvisoryLock(
        'http://localhost:4201/luke/my-realm/',
      );
      // Should be a decimal integer string, possibly negative.
      assert.ok(
        /^-?\d+$/.test(key),
        `key is a decimal integer string (got ${key})`,
      );
      const asBigInt = BigInt(key);
      // Within signed int64 range: [-(2^63), 2^63 - 1]
      const MAX = 2n ** 63n - 1n;
      const MIN = -(2n ** 63n);
      assert.ok(asBigInt <= MAX, 'within int64 upper bound');
      assert.ok(asBigInt >= MIN, 'within int64 lower bound');
    });
  });

  module('PgAdapter.withWriteLock', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('runs the callback and returns its value', async function (assert) {
      const result = await dbAdapter.withWriteLock(
        'http://localhost:4201/x/',
        async () => 42,
      );
      assert.strictEqual(result, 42);
    });

    test('serializes two concurrent callers for the same URL', async function (assert) {
      const url = 'http://localhost:4201/serialize/';
      const events: string[] = [];

      // First caller grabs the lock and holds it for a bit. Second caller
      // tries to acquire concurrently and should only run after the first
      // releases. We verify by appending to a shared array in a specific
      // order and checking the final ordering.
      const p1 = dbAdapter.withWriteLock(url, async () => {
        events.push('1-start');
        await new Promise((r) => setTimeout(r, 150));
        events.push('1-end');
      });
      // Give p1 a head start so it actually holds the lock first.
      await new Promise((r) => setTimeout(r, 20));
      const p2 = dbAdapter.withWriteLock(url, async () => {
        events.push('2-start');
        events.push('2-end');
      });

      await Promise.all([p1, p2]);

      assert.deepEqual(
        events,
        ['1-start', '1-end', '2-start', '2-end'],
        'second caller runs only after first releases the lock',
      );
    });

    test('runs concurrent callers for different URLs in parallel', async function (assert) {
      const events: string[] = [];

      const p1 = dbAdapter.withWriteLock(
        'http://localhost:4201/a/',
        async () => {
          events.push('a-start');
          await new Promise((r) => setTimeout(r, 150));
          events.push('a-end');
        },
      );
      const p2 = dbAdapter.withWriteLock(
        'http://localhost:4201/b/',
        async () => {
          events.push('b-start');
          await new Promise((r) => setTimeout(r, 20));
          events.push('b-end');
        },
      );

      await Promise.all([p1, p2]);

      // B should complete before A-end because they run in parallel and
      // B's critical section is much shorter. If they had serialized on
      // the same lock, B would only start after A finished.
      const aEndIdx = events.indexOf('a-end');
      const bEndIdx = events.indexOf('b-end');
      assert.ok(
        bEndIdx < aEndIdx,
        `b-end (${bEndIdx}) should come before a-end (${aEndIdx}) under parallel execution; events: ${events.join(',')}`,
      );
    });

    test('releases the lock when the callback throws', async function (assert) {
      const url = 'http://localhost:4201/throw/';
      await assert.rejects(
        dbAdapter.withWriteLock(url, async () => {
          throw new Error('deliberate failure');
        }),
        /deliberate failure/,
      );
      // A second acquisition should succeed immediately — if the lock leaked,
      // this would block forever (test timeout would fire).
      const result = await dbAdapter.withWriteLock(url, async () => 'ok');
      assert.strictEqual(result, 'ok', 'lock released after prior failure');
    });
  });

  module('hashUserIdForCostLock', function () {
    test('is deterministic', function (assert) {
      const userId = '@alice:localhost';
      assert.strictEqual(
        hashUserIdForCostLock(userId),
        hashUserIdForCostLock(userId),
      );
    });

    test('yields different keys for different user ids', function (assert) {
      assert.notStrictEqual(
        hashUserIdForCostLock('@alice:localhost'),
        hashUserIdForCostLock('@bob:localhost'),
      );
    });

    test('is namespaced away from the realm-write lock space', function (assert) {
      // A user id and a realm URL string that happened to be equal would
      // still derive different lock keys, so user-cost contention can never
      // serialize on a realm-write lock and vice versa.
      const shared = '@alice:localhost';
      assert.notStrictEqual(
        hashUserIdForCostLock(shared),
        hashRealmUrlForAdvisoryLock(shared),
      );
    });

    test('returns a string parseable as a signed 64-bit integer', function (assert) {
      const key = hashUserIdForCostLock('@alice:localhost');
      assert.ok(
        /^-?\d+$/.test(key),
        `key is a decimal integer string (got ${key})`,
      );
      const asBigInt = BigInt(key);
      const MAX = 2n ** 63n - 1n;
      const MIN = -(2n ** 63n);
      assert.ok(asBigInt <= MAX, 'within int64 upper bound');
      assert.ok(asBigInt >= MIN, 'within int64 lower bound');
    });
  });

  module('PgAdapter.withUserCostLock', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('runs the callback and returns its value', async function (assert) {
      const result = await dbAdapter.withUserCostLock(
        '@alice:localhost',
        async () => 42,
      );
      assert.strictEqual(result, 42);
    });

    test('serializes two concurrent callers for the same user id', async function (assert) {
      const userId = '@alice:localhost';
      const events: string[] = [];

      const p1 = dbAdapter.withUserCostLock(userId, async () => {
        events.push('1-start');
        await new Promise((r) => setTimeout(r, 150));
        events.push('1-end');
      });
      // Give p1 a head start so it actually holds the lock first.
      await new Promise((r) => setTimeout(r, 20));
      const p2 = dbAdapter.withUserCostLock(userId, async () => {
        events.push('2-start');
        events.push('2-end');
      });

      await Promise.all([p1, p2]);

      assert.deepEqual(
        events,
        ['1-start', '1-end', '2-start', '2-end'],
        'second caller runs only after first releases the lock',
      );
    });

    test('runs concurrent callers for different user ids in parallel', async function (assert) {
      const events: string[] = [];

      const p1 = dbAdapter.withUserCostLock('@alice:localhost', async () => {
        events.push('a-start');
        await new Promise((r) => setTimeout(r, 150));
        events.push('a-end');
      });
      const p2 = dbAdapter.withUserCostLock('@bob:localhost', async () => {
        events.push('b-start');
        await new Promise((r) => setTimeout(r, 20));
        events.push('b-end');
      });

      await Promise.all([p1, p2]);

      // B should complete before A-end because they run in parallel and
      // B's critical section is much shorter.
      const aEndIdx = events.indexOf('a-end');
      const bEndIdx = events.indexOf('b-end');
      assert.ok(
        bEndIdx < aEndIdx,
        `b-end (${bEndIdx}) should come before a-end (${aEndIdx}) under parallel execution; events: ${events.join(',')}`,
      );
    });

    test('releases the lock when the callback throws', async function (assert) {
      const userId = '@alice:localhost';
      await assert.rejects(
        dbAdapter.withUserCostLock(userId, async () => {
          throw new Error('deliberate failure');
        }),
        /deliberate failure/,
      );
      const result = await dbAdapter.withUserCostLock(userId, async () => 'ok');
      assert.strictEqual(result, 'ok', 'lock released after prior failure');
    });

    test('many concurrent same-user callers serialize without overlapping critical sections', async function (assert) {
      // The pool-footprint argument behind the in-process coalescer: N
      // concurrent same-user callers in one process should only ever have
      // ONE of them inside the advisory-lock-held critical section at a
      // time. We assert this by pushing per-caller start/end events: if
      // serialized, the sequence is [a,a,b,b,c,c,...]; if N requests
      // were piling up against the lock (each pinning its own pool
      // client), starts would interleave across callers.
      const userId = '@coalesce:localhost';
      const N = 8;
      const order: number[] = [];
      const work = (i: number) =>
        dbAdapter.withUserCostLock(userId, async () => {
          order.push(i);
          await new Promise((r) => setTimeout(r, 25));
          order.push(i);
          return i;
        });
      const results = await Promise.all(
        Array.from({ length: N }, (_, i) => work(i)),
      );
      assert.deepEqual(
        results,
        Array.from({ length: N }, (_, i) => i),
        'each caller observes its own result',
      );
      for (let i = 0; i < order.length; i += 2) {
        assert.strictEqual(
          order[i],
          order[i + 1],
          `start/end events for one caller are adjacent at ${i}/${i + 1}; full order: ${order.join(',')}`,
        );
      }
    });

    test('a prior caller failing does not poison the in-process chain', async function (assert) {
      // The chain marches on after a failure — the next same-user caller
      // takes its turn instead of inheriting the rejection.
      const userId = '@chain-resilience:localhost';
      await assert.rejects(
        dbAdapter.withUserCostLock(userId, async () => {
          throw new Error('first caller exploded');
        }),
        /first caller exploded/,
      );
      const result = await dbAdapter.withUserCostLock(userId, async () => 'ok');
      assert.strictEqual(result, 'ok');
    });

    test('does not serialize against the realm-write lock', async function (assert) {
      // Even if a user id string equals a realm URL string (it never does
      // in practice, but the namespacing guarantees it), the two lock
      // spaces are disjoint. We assert that by holding a withWriteLock and
      // a withUserCostLock on the same string concurrently — they must run
      // in parallel, not serialize.
      const shared = 'http://localhost:4201/shared/';
      const events: string[] = [];

      const writePromise = dbAdapter.withWriteLock(shared, async () => {
        events.push('write-start');
        await new Promise((r) => setTimeout(r, 100));
        events.push('write-end');
      });
      await new Promise((r) => setTimeout(r, 10));
      const costPromise = dbAdapter.withUserCostLock(shared, async () => {
        events.push('cost-start');
        events.push('cost-end');
      });

      await Promise.all([writePromise, costPromise]);

      // cost-* should slot in between write-start and write-end because
      // the locks are in different namespaces.
      assert.deepEqual(
        events,
        ['write-start', 'cost-start', 'cost-end', 'write-end'],
        'realm-write and user-cost lock spaces are disjoint',
      );
    });
  });
});
