import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { DBAnonymousRateLimiter } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

const REALM = 'http://127.0.0.1:4444/feedback/';
const OTHER_REALM = 'http://127.0.0.1:4444/articles/';
const CALLER = '192.0.2.10';
const OTHER_CALLER = '192.0.2.11';
const LIMIT = { requests: 3, windowSeconds: 60 };
// A window boundary, in epoch milliseconds, so a test knows how far the
// window has to run.
const WINDOW_START_MS = 1_800_000_000 * 1000;

module(basename(import.meta.filename), function () {
  module('DBAnonymousRateLimiter', function (hooks) {
    let dbAdapter: PgAdapter;
    let nowMs: number;
    let limiter: DBAnonymousRateLimiter;

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
        nowMs = WINDOW_START_MS;
        limiter = new DBAnonymousRateLimiter(dbAdapter, { now: () => nowMs });
      },
    });

    function charge(
      overrides: Partial<{
        realmURL: string;
        clientIP: string;
        cost: number;
        limit: typeof LIMIT;
      }> = {},
    ) {
      return limiter.charge({
        realmURL: REALM,
        clientIP: CALLER,
        limit: LIMIT,
        cost: 1,
        ...overrides,
      });
    }

    test('admits a caller up to the limit, then refuses until the window turns', async function (assert) {
      for (let expected = 1; expected <= LIMIT.requests; expected++) {
        assert.deepEqual(await charge(), { admitted: true, count: expected });
      }
      nowMs += 15_000;
      assert.deepEqual(
        await charge(),
        { admitted: false, retryAfterSeconds: 45 },
        'refused, told when the window turns, and not counted',
      );
      assert.deepEqual(
        await charge(),
        { admitted: false, retryAfterSeconds: 45 },
        'a refused retry does not push the count further over',
      );
      nowMs = WINDOW_START_MS + LIMIT.windowSeconds * 1000;
      assert.deepEqual(
        await charge(),
        { admitted: true, count: 1 },
        'a new window starts a new count',
      );
    });

    test('each realm counts a caller on its own', async function (assert) {
      for (let i = 0; i < LIMIT.requests; i++) {
        await charge();
      }
      assert.false((await charge()).admitted, 'over the limit in one realm');
      assert.deepEqual(
        await charge({ realmURL: OTHER_REALM }),
        { admitted: true, count: 1 },
        'and untouched in another',
      );
    });

    test('each caller address is counted on its own', async function (assert) {
      for (let i = 0; i < LIMIT.requests; i++) {
        await charge();
      }
      assert.false((await charge()).admitted);
      assert.deepEqual(await charge({ clientIP: OTHER_CALLER }), {
        admitted: true,
        count: 1,
      });
    });

    test('a charge for several invocations is taken whole or not at all', async function (assert) {
      assert.deepEqual(await charge({ cost: 2 }), { admitted: true, count: 2 });
      assert.deepEqual(
        await charge({ cost: 2 }),
        { admitted: false, retryAfterSeconds: 60 },
        'two more would go over, so none are taken',
      );
      assert.deepEqual(
        await charge({ cost: 1 }),
        { admitted: true, count: 3 },
        'the one that still fits is admitted',
      );
      assert.false(
        (await charge({ clientIP: OTHER_CALLER, cost: 4 })).admitted,
        'a charge larger than the whole limit is never admitted',
      );
    });

    test('a charge that is not a whole number of invocations is refused outright', async function (assert) {
      for (let cost of [0, -5, 1.5]) {
        await assert.rejects(
          charge({ cost }),
          /whole number of invocations/,
          `a cost of ${cost} is not a charge`,
        );
      }
      assert.deepEqual(
        await charge(),
        { admitted: true, count: 1 },
        'and none of them moved the count',
      );
    });

    test('every limiter on the database shares the count', async function (assert) {
      let another = new DBAnonymousRateLimiter(dbAdapter, { now: () => nowMs });
      await charge();
      await another.charge({
        realmURL: REALM,
        clientIP: CALLER,
        limit: LIMIT,
        cost: 1,
      });
      assert.deepEqual(await charge(), { admitted: true, count: 3 });
      assert.false(
        (
          await another.charge({
            realmURL: REALM,
            clientIP: CALLER,
            limit: LIMIT,
            cost: 1,
          })
        ).admitted,
      );
    });

    test('concurrent charges never admit more than the limit', async function (assert) {
      let outcomes = await Promise.all(
        Array.from({ length: 10 }, () => charge()),
      );
      assert.strictEqual(
        outcomes.filter((o) => o.admitted).length,
        LIMIT.requests,
      );
    });

    test('a window that has ended is swept', async function (assert) {
      await charge();
      nowMs += LIMIT.windowSeconds * 1000;
      for (let i = 0; i < DBAnonymousRateLimiter.SWEEP_EVERY; i++) {
        await charge({
          clientIP: OTHER_CALLER,
          limit: { ...LIMIT, requests: 1_000 },
        });
      }
      // The sweep runs without being awaited by the charge that triggered it.
      let rows: Record<string, unknown>[] = [];
      for (let attempt = 0; attempt < 50; attempt++) {
        rows = await dbAdapter.execute(
          `SELECT client_ip FROM anonymous_rate_limits WHERE client_ip = '${CALLER}'`,
        );
        if (rows.length === 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.strictEqual(rows.length, 0, "the ended window's row is gone");
    });
  });
});
