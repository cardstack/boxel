import { module, test } from 'qunit';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { setupDB } from './helpers';
import {
  hashRealmUrlForAdvisoryLock,
  withRealmWriteLock,
} from '../lib/realm-advisory-locks';

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

  module('withRealmWriteLock', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('runs the callback and returns its value', async function (assert) {
      const result = await withRealmWriteLock(
        dbAdapter,
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
      const p1 = withRealmWriteLock(dbAdapter, url, async () => {
        events.push('1-start');
        await new Promise((r) => setTimeout(r, 150));
        events.push('1-end');
      });
      // Give p1 a head start so it actually holds the lock first.
      await new Promise((r) => setTimeout(r, 20));
      const p2 = withRealmWriteLock(dbAdapter, url, async () => {
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

      const p1 = withRealmWriteLock(
        dbAdapter,
        'http://localhost:4201/a/',
        async () => {
          events.push('a-start');
          await new Promise((r) => setTimeout(r, 150));
          events.push('a-end');
        },
      );
      const p2 = withRealmWriteLock(
        dbAdapter,
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
        withRealmWriteLock(dbAdapter, url, async () => {
          throw new Error('deliberate failure');
        }),
        /deliberate failure/,
      );
      // A second acquisition should succeed immediately — if the lock leaked,
      // this would block forever (test timeout would fire).
      const result = await withRealmWriteLock(dbAdapter, url, async () => 'ok');
      assert.strictEqual(result, 'ok', 'lock released after prior failure');
    });
  });
});
