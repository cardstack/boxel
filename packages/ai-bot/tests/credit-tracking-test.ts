import { module, test } from 'qunit';
import FakeTimers from '@sinonjs/fake-timers';
import { waitForPendingCreditTracking } from '../lib/credit-tracking.ts';

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
});
