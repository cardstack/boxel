import { getPendingWaiterState } from '@ember/test-waiters';

import { module, test } from 'qunit';

import {
  LIVE_SEARCH_REFRESH_WINDOW_MS,
  LiveSearchRefreshScheduler,
} from '@cardstack/host/lib/live-search-refresh-scheduler';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module('Unit | live search refresh scheduler', function () {
  test('a prompt schedule pulls an armed flush earlier and flushes once', async function (assert) {
    let flushes = 0;
    let scheduler = new LiveSearchRefreshScheduler(() => flushes++);

    scheduler.schedule();
    scheduler.schedule({ prompt: true });
    await wait(0);
    assert.strictEqual(flushes, 1, 'flushed without waiting out the window');

    await wait(LIVE_SEARCH_REFRESH_WINDOW_MS * 2);
    assert.strictEqual(flushes, 1, 'the window flush was replaced');
    assert.false(getPendingWaiterState().pending > 0, 'nothing left pending');
  });

  test('a windowed schedule does not push an armed prompt flush later', async function (assert) {
    let flushes = 0;
    let scheduler = new LiveSearchRefreshScheduler(() => flushes++);

    scheduler.schedule({ prompt: true });
    scheduler.schedule();
    await wait(0);
    assert.strictEqual(flushes, 1, 'the prompt flush ran on time');

    await wait(LIVE_SEARCH_REFRESH_WINDOW_MS * 2);
    assert.strictEqual(flushes, 1, 'and only once');
  });

  test('cancel drops the armed flush and releases its waiter', async function (assert) {
    let flushes = 0;
    let scheduler = new LiveSearchRefreshScheduler(() => flushes++);

    scheduler.schedule();
    scheduler.schedule({ prompt: true });
    scheduler.cancel();
    assert.false(getPendingWaiterState().pending > 0, 'waiter released');

    await wait(LIVE_SEARCH_REFRESH_WINDOW_MS * 2);
    assert.strictEqual(flushes, 0, 'nothing flushed');
  });
});
