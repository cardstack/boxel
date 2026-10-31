import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  DBRateLimitStore,
  counterKey,
  isRateLimitUnavailable,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

const KEY = counterKey('share-a', '@caller:localhost');
const OTHER_KEY = counterKey('share-a', '@other:localhost');
// Three at once, then one every ten seconds.
const BUCKET = { burst: 3, refillPerMinute: 6 };
const DAILY = { period: 'day' as const, limit: 3 };
const MONTHLY = { period: 'month' as const, limit: 5 };
// 2027-01-31T23:00:00Z: an hour before both a day and a month turn.
const START_MS = Date.UTC(2027, 0, 31, 23);
const NEXT_DAY_S = Date.UTC(2027, 1, 1) / 1000;

module(basename(import.meta.filename), function () {
  module('DBRateLimitStore', function (hooks) {
    let dbAdapter: PgAdapter;
    let nowMs: number;
    let store: DBRateLimitStore;

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
        nowMs = START_MS;
        store = new DBRateLimitStore(dbAdapter, { now: () => nowMs });
      },
    });

    module('token buckets', function () {
      test('admits a burst, then one take per refill', async function (assert) {
        for (let remaining of [2, 1, 0]) {
          assert.deepEqual(await store.take(KEY, BUCKET), {
            admitted: true,
            remaining,
          });
        }
        assert.deepEqual(
          await store.take(KEY, BUCKET),
          { admitted: false, retryAfterSeconds: 10 },
          'an empty bucket refuses and says when a token is back',
        );
        nowMs += 4_000;
        assert.deepEqual(
          await store.take(KEY, BUCKET),
          { admitted: false, retryAfterSeconds: 6 },
          'a refused take spends nothing, so the wait only shrinks',
        );
        nowMs += 6_000;
        assert.deepEqual(
          await store.take(KEY, BUCKET),
          { admitted: true, remaining: 0 },
          'one token refilled after ten seconds',
        );
        assert.false((await store.take(KEY, BUCKET)).admitted);
        nowMs += 60_000;
        assert.deepEqual(
          await store.take(KEY, BUCKET),
          { admitted: true, remaining: 2 },
          'a bucket refills no further than its burst',
        );
      });

      test('a take of several tokens is all or nothing', async function (assert) {
        assert.deepEqual(await store.take(KEY, BUCKET, 2), {
          admitted: true,
          remaining: 1,
        });
        assert.deepEqual(
          await store.take(KEY, BUCKET, 2),
          { admitted: false, retryAfterSeconds: 10 },
          'one token short: none taken, and told when the second is back',
        );
        assert.deepEqual(await store.take(KEY, BUCKET, 1), {
          admitted: true,
          remaining: 0,
        });
        assert.false(
          (await store.take(OTHER_KEY, BUCKET, 4)).admitted,
          'more than the burst is never admitted',
        );
      });

      test('a peek says what a take would, and takes nothing', async function (assert) {
        assert.deepEqual(
          await store.peek(KEY, BUCKET),
          { admitted: true, remaining: 3 },
          'a key nothing has taken from is a full bucket',
        );
        await store.take(KEY, BUCKET, 3);
        assert.deepEqual(await store.peek(KEY, BUCKET), {
          admitted: false,
          retryAfterSeconds: 10,
        });
        nowMs += 10_000;
        assert.deepEqual(await store.peek(KEY, BUCKET), {
          admitted: true,
          remaining: 1,
        });
        assert.deepEqual(
          await store.peek(KEY, BUCKET),
          { admitted: true, remaining: 1 },
          'peeking twice leaves the bucket where it was',
        );
        assert.deepEqual(
          await store.peek(KEY, BUCKET, 2),
          { admitted: false, retryAfterSeconds: 10 },
          'a peek of several tokens waits for all of them',
        );
      });

      test('a refund puts back what a take took, never past a full bucket', async function (assert) {
        await store.take(KEY, BUCKET, 3);
        assert.true(await store.refund(KEY, BUCKET, 2));
        assert.deepEqual(await store.peek(KEY, BUCKET), {
          admitted: true,
          remaining: 2,
        });
        assert.true(await store.refund(KEY, BUCKET, 3));
        assert.deepEqual(
          await store.peek(KEY, BUCKET),
          { admitted: true, remaining: 3 },
          'a refund stops at the burst',
        );
      });

      test('each key has its own bucket', async function (assert) {
        await store.take(KEY, BUCKET, 3);
        assert.false((await store.take(KEY, BUCKET)).admitted);
        assert.deepEqual(await store.take(OTHER_KEY, BUCKET), {
          admitted: true,
          remaining: 2,
        });
      });

      test('a clock behind the bucket refills nothing and moves nothing back', async function (assert) {
        await store.take(KEY, BUCKET, 2);
        let [{ expires_at: expiresAt }] = await dbAdapter.execute(
          `SELECT expires_at FROM rate_limit_buckets WHERE bucket_key = '${KEY}'`,
        );
        nowMs = START_MS - 60_000;
        assert.deepEqual(
          await store.take(KEY, BUCKET),
          { admitted: true, remaining: 0 },
          'a process whose clock lags can take what is there, and is handed nothing more',
        );
        assert.deepEqual(
          await dbAdapter.execute(
            `SELECT expires_at FROM rate_limit_buckets WHERE bucket_key = '${KEY}'`,
          ),
          [{ expires_at: expiresAt }],
          'nor does it bring forward when the row can be swept',
        );
        nowMs = START_MS + 10_000;
        assert.deepEqual(
          await store.take(KEY, BUCKET),
          { admitted: true, remaining: 0 },
          'refill is counted from the later refill time',
        );
        assert.false((await store.take(KEY, BUCKET)).admitted);
      });

      test('takes from two stores on the database never exceed the burst', async function (assert) {
        let another = new DBRateLimitStore(dbAdapter, { now: () => nowMs });
        let outcomes = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            (i % 2 ? store : another).take(KEY, BUCKET),
          ),
        );
        assert.strictEqual(
          outcomes.filter((o) => o.admitted).length,
          BUCKET.burst,
        );
        nowMs += 10_000;
        assert.true(
          (await another.take(KEY, BUCKET)).admitted,
          'and both see the same refill',
        );
        assert.false((await store.take(KEY, BUCKET)).admitted);
      });

      test('a take that is not a whole number of tokens is refused outright', async function (assert) {
        for (let cost of [0, -1, 1.5]) {
          await assert.rejects(
            store.take(KEY, BUCKET, cost),
            /whole number of at least one/,
          );
        }
        await assert.rejects(
          store.take(KEY, { burst: 3, refillPerMinute: 0 }),
          /positive rate/,
        );
        assert.deepEqual(
          await store.take(KEY, BUCKET),
          { admitted: true, remaining: 2 },
          'and none of them moved the bucket',
        );
      });
    });

    module('budgets', function () {
      test('a daily budget is spent, refused, then reset at midnight UTC', async function (assert) {
        let resetsAt = NEXT_DAY_S;
        for (let used = 1; used <= DAILY.limit; used++) {
          assert.deepEqual(await store.spend(KEY, DAILY), {
            admitted: true,
            used,
            resetsAt,
          });
        }
        assert.deepEqual(
          await store.spend(KEY, DAILY),
          { admitted: false, retryAfterSeconds: 3600 },
          'spent: refused until the day turns',
        );
        assert.deepEqual(
          await store.budget(KEY, DAILY),
          { admitted: false, retryAfterSeconds: 3600 },
          'and asking says the same without spending',
        );
        nowMs = NEXT_DAY_S * 1000;
        assert.deepEqual(
          await store.budget(KEY, DAILY),
          { admitted: true, used: 0, resetsAt: NEXT_DAY_S + 86_400 },
          'a new day has nothing spent',
        );
        assert.deepEqual(await store.spend(KEY, DAILY), {
          admitted: true,
          used: 1,
          resetsAt: NEXT_DAY_S + 86_400,
        });
      });

      test('a monthly budget resets on the first of the month', async function (assert) {
        assert.deepEqual(await store.spend(KEY, MONTHLY, 5), {
          admitted: true,
          used: 5,
          resetsAt: NEXT_DAY_S,
        });
        nowMs = START_MS - 20 * 86_400_000;
        assert.false(
          (await store.spend(KEY, MONTHLY)).admitted,
          'still spent earlier in the same month',
        );
        nowMs = NEXT_DAY_S * 1000;
        assert.deepEqual(await store.spend(KEY, MONTHLY), {
          admitted: true,
          used: 1,
          resetsAt: Date.UTC(2027, 2, 1) / 1000,
        });
      });

      test('an unspend takes back units in the period they were spent in', async function (assert) {
        let spent = await store.spend(KEY, DAILY, 2);
        assert.true(spent.admitted);
        let { resetsAt } = spent as { resetsAt: number };
        assert.true(await store.unspend(KEY, { period: 'day', resetsAt }));
        assert.deepEqual(await store.budget(KEY, DAILY), {
          admitted: true,
          used: 1,
          resetsAt,
        });
        assert.true(await store.unspend(KEY, { period: 'day', resetsAt }, 5));
        assert.strictEqual(
          ((await store.budget(KEY, DAILY)) as { used: number }).used,
          0,
          'never below zero',
        );

        await store.spend(KEY, DAILY);
        nowMs = NEXT_DAY_S * 1000;
        await store.spend(KEY, DAILY);
        await store.unspend(KEY, { period: 'day', resetsAt });
        assert.strictEqual(
          ((await store.budget(KEY, DAILY)) as { used: number }).used,
          1,
          "an unspend for a period that has turned leaves the new period's count alone",
        );
      });

      test('day and month budgets of one key are counted apart', async function (assert) {
        await store.spend(KEY, DAILY, 3);
        assert.false((await store.spend(KEY, DAILY)).admitted);
        assert.deepEqual(await store.spend(KEY, MONTHLY), {
          admitted: true,
          used: 1,
          resetsAt: NEXT_DAY_S,
        });
        assert.true((await store.spend(OTHER_KEY, DAILY)).admitted);
      });

      test('a spend of several units is all or nothing', async function (assert) {
        await store.spend(KEY, DAILY, 2);
        assert.false((await store.spend(KEY, DAILY, 2)).admitted);
        assert.deepEqual(await store.spend(KEY, DAILY, 1), {
          admitted: true,
          used: 3,
          resetsAt: NEXT_DAY_S,
        });
      });

      test('spends from two stores on the database never exceed the budget', async function (assert) {
        let another = new DBRateLimitStore(dbAdapter, { now: () => nowMs });
        let outcomes = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            (i % 2 ? store : another).spend(KEY, DAILY),
          ),
        );
        assert.strictEqual(
          outcomes.filter((o) => o.admitted).length,
          DAILY.limit,
        );
      });
    });

    module('when the store is unavailable', function () {
      test('a take and a peek are refused as unavailable', async function (assert) {
        await dbAdapter.execute('DROP TABLE rate_limit_buckets');
        let outcome = await store.take(KEY, BUCKET);
        assert.deepEqual(outcome, { admitted: false, unavailable: true });
        assert.true(isRateLimitUnavailable(outcome));
        assert.deepEqual(await store.peek(KEY, BUCKET), {
          admitted: false,
          unavailable: true,
        });
      });

      test('a spend and a budget read are refused as unavailable', async function (assert) {
        await dbAdapter.execute('DROP TABLE rate_limit_budgets');
        assert.deepEqual(await store.spend(KEY, DAILY), {
          admitted: false,
          unavailable: true,
        });
        assert.deepEqual(await store.budget(KEY, DAILY), {
          admitted: false,
          unavailable: true,
        });
      });

      test('a refusal for want of capacity is not unavailable', async function (assert) {
        await store.take(KEY, BUCKET, 3);
        assert.false(isRateLimitUnavailable(await store.take(KEY, BUCKET)));
      });
    });

    test('ended budgets and refilled buckets are swept', async function (assert) {
      await store.spend(KEY, DAILY);
      await store.take(KEY, BUCKET);
      nowMs = NEXT_DAY_S * 1000;
      for (let i = 0; i < DBRateLimitStore.SWEEP_EVERY; i++) {
        await store.spend(OTHER_KEY, { period: 'day', limit: 1_000 });
      }
      // The sweep runs without being awaited by the spend that triggered it.
      let left: Record<string, unknown>[] = [];
      for (let attempt = 0; attempt < 50; attempt++) {
        left = [
          ...(await dbAdapter.execute(
            `SELECT budget_key FROM rate_limit_budgets WHERE budget_key = '${KEY}'`,
          )),
          ...(await dbAdapter.execute(
            `SELECT bucket_key FROM rate_limit_buckets WHERE bucket_key = '${KEY}'`,
          )),
        ];
        if (left.length === 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.strictEqual(left.length, 0, "the key's rows are gone");
      assert.deepEqual(
        (
          await dbAdapter.execute(
            `SELECT count FROM rate_limit_budgets WHERE budget_key = '${OTHER_KEY}'`,
          )
        ).map((row) => Number(row.count)),
        [DBRateLimitStore.SWEEP_EVERY],
        'a budget in its current period is kept with its count',
      );
      assert.deepEqual(
        await store.take(OTHER_KEY, BUCKET, 3),
        { admitted: true, remaining: 0 },
        'and so is a bucket still refilling',
      );
      for (let i = 0; i < DBRateLimitStore.SWEEP_EVERY; i++) {
        await store.spend(OTHER_KEY, { period: 'day', limit: 1_000 });
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.false(
        (await store.take(OTHER_KEY, BUCKET)).admitted,
        'a sweep leaves a bucket that is not yet full',
      );
    });
  });
});
