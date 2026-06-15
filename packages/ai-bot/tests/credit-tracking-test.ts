import { module, test } from 'qunit';
import FakeTimers from '@sinonjs/fake-timers';
import type { DBAdapter } from '@cardstack/runtime-common';
import {
  waitForPendingCreditTracking,
  scheduleFallbackCostTracking,
} from '../lib/credit-tracking.ts';

// Minimal in-memory DBAdapter that answers just the queries the billing
// spend path issues for a free-plan user with ample daily credits, and
// records every credits_ledger INSERT so tests can assert the debit.
function makeFakeAdapter() {
  let inserts: { sql: string; bind: unknown[] }[] = [];
  let adapter = {
    kind: 'pg' as const,
    isClosed: false,
    async execute(sql: string, opts?: { bind?: unknown[] }) {
      let bind = opts?.bind ?? [];
      if (sql.includes('INSERT INTO credits_ledger')) {
        inserts.push({ sql, bind });
        return [];
      }
      if (sql.includes('FROM users')) {
        return [
          {
            id: 'user-1',
            matrix_user_id: bind[0] ?? '@user:localhost',
            stripe_customer_id: null,
            stripe_customer_email: null,
            matrix_registration_token: null,
            session_room_id: null,
          },
        ];
      }
      if (sql.includes('FROM subscriptions')) {
        return []; // no active subscription => free plan
      }
      if (sql.includes('SUM(credit_amount)')) {
        return [{ sum: '1000' }]; // plenty of daily/extra credits
      }
      return [];
    },
    close: async () => {},
    getColumnNames: async () => [],
    notify: async () => {},
    withWriteLock: async (_realmUrl: string, fn: (q: undefined) => unknown) =>
      fn(undefined),
    withUserCostLock: async (_userId: string, fn: () => unknown) => fn(),
  };
  return { adapter: adapter as unknown as DBAdapter, inserts };
}

module('Credit Tracking', () => {
  test('waitForPendingCreditTracking does not block indefinitely on slow credit tracking', async (assert) => {
    let clock = FakeTimers.install();
    try {
      // Simulate fetchGenerationCostWithBackoff hanging (up to 10 min backoff)
      let slowPromise = new Promise<void>(() => {
        // Intentionally never resolves
      });

      let map = new Map<string, Promise<void>>();
      map.set('@user:localhost', slowPromise);

      let resolved = false;
      let resultPromise = waitForPendingCreditTracking(
        map,
        '@user:localhost',
      ).then(() => {
        resolved = true;
      });

      // Advance time past the expected timeout (fix uses 5s)
      await clock.tickAsync(6_000);

      assert.true(
        resolved,
        'Should resolve within a bounded time even if the credits promise is still pending — ' +
          'fetchGenerationCostWithBackoff can take up to 10 minutes, but new messages must not be blocked that long',
      );

      await resultPromise;
    } finally {
      clock.uninstall();
    }
  });

  test('waitForPendingCreditTracking resolves immediately when credits promise resolves quickly', async (assert) => {
    let resolveCredits!: () => void;
    let creditsPromise = new Promise<void>((resolve) => {
      resolveCredits = resolve;
    });

    let map = new Map<string, Promise<void>>();
    map.set('@user:localhost', creditsPromise);

    let resolved = false;
    let resultPromise = waitForPendingCreditTracking(
      map,
      '@user:localhost',
    ).then(() => {
      resolved = true;
    });

    resolveCredits();
    await resultPromise;

    assert.true(resolved, 'Should resolve when credits promise resolves');
  });

  test('waitForPendingCreditTracking returns error when credits promise rejects', async (assert) => {
    let rejectCredits!: (e: Error) => void;
    let creditsPromise = new Promise<void>((_resolve, reject) => {
      rejectCredits = reject;
    });

    let map = new Map<string, Promise<void>>();
    map.set('@user:localhost', creditsPromise);

    let resultPromise = waitForPendingCreditTracking(map, '@user:localhost');
    rejectCredits(new Error('billing API down'));
    let result = await resultPromise;

    assert.ok(result.error, 'Should return error when credits promise rejects');
  });

  test('waitForPendingCreditTracking resolves immediately when no pending promise exists', async (assert) => {
    let map = new Map<string, Promise<void>>();

    let result = await waitForPendingCreditTracking(map, '@user:localhost');

    assert.strictEqual(result.error, undefined, 'Should resolve with no error');
  });

  test('scheduleFallbackCostTracking registers, debits, then clears the map entry', async (assert) => {
    let { adapter, inserts } = makeFakeAdapter();
    let originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { total_cost: 0.005 } }),
    });
    try {
      let map = new Map<string, Promise<void>>();
      scheduleFallbackCostTracking({
        dbAdapter: adapter,
        matrixUserId: '@user:localhost',
        generationId: 'gen-1',
        openRouterApiKey: 'test-key',
        trackAiUsageCostPromises: map,
      });

      assert.ok(
        map.has('@user:localhost'),
        'fallback promise is registered synchronously so waitForPendingCreditTracking can observe it',
      );

      await map.get('@user:localhost');

      assert.strictEqual(
        inserts.length,
        1,
        'the fetched generation cost is debited',
      );
      assert.true(
        inserts[0].bind.includes(-5),
        'debit is 5 credits (0.005 USD * 1000)',
      );
      assert.false(
        map.has('@user:localhost'),
        'map entry is removed once the debit settles',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('scheduleFallbackCostTracking debits every scheduled fallback — no coalescing', async (assert) => {
    let { adapter, inserts } = makeFakeAdapter();
    let originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { total_cost: 0.005 } }),
    });
    try {
      let map = new Map<string, Promise<void>>();

      scheduleFallbackCostTracking({
        dbAdapter: adapter,
        matrixUserId: '@user:localhost',
        generationId: 'gen-1',
        openRouterApiKey: 'test-key',
        trackAiUsageCostPromises: map,
      });
      let first = map.get('@user:localhost');
      scheduleFallbackCostTracking({
        dbAdapter: adapter,
        matrixUserId: '@user:localhost',
        generationId: 'gen-2',
        openRouterApiKey: 'test-key',
        trackAiUsageCostPromises: map,
      });
      let second = map.get('@user:localhost');

      await Promise.all([first, second]);

      assert.strictEqual(
        inserts.length,
        2,
        'both same-user fallbacks are debited — the old in-memory barrier early-returned and silently dropped the second',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
