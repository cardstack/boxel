import { module, test } from 'qunit';

import { type Queue } from '@cardstack/runtime-common';

import { BrowserQueue } from '@cardstack/host/lib/browser-queue';

module('Unit | queue | browser implementation', function (hooks) {
  let queue: Queue;

  hooks.beforeEach(async function () {
    queue = new BrowserQueue();
    queue.start();
  });

  hooks.afterEach(async function () {
    await queue.destroy();
  });

  test('it can run a job', async function (assert) {
    let job = await queue.publish<number>('increment', 17, {
      queueName: 'first-ephemeral-realm-incrementing',
    });
    queue.register('increment', async (a: number) => a + 1);
    let result = await job.done;
    assert.strictEqual(result, 18);
  });

  test(`a job can throw an exception`, async function (assert) {
    queue.register('boom', async () => {
      throw new Error('boom!');
    });
    let [errorJob, nonErrorJob] = await Promise.all([
      queue.publish<number>('boom', null),
      queue.publish<number>('increment', 17),
    ]);
    queue.register('increment', async (a: number) => a + 1);

    // assert that the error that was thrown does not prevent subsequent jobs
    // from running
    let [errorResults, nonErrorResults] = await Promise.allSettled([
      errorJob.done,
      nonErrorJob.done,
    ]);
    if (errorResults.status === 'rejected') {
      assert.strictEqual(errorResults.reason.message, 'boom!');
    } else {
      assert.ok(false, `expected 'errorJob' to be rejected`);
    }
    if (nonErrorResults.status === 'fulfilled') {
      assert.strictEqual(nonErrorResults.value, 18);
    } else {
      assert.ok(false, `expected 'nonErrorJob' to be fulfilled`);
    }
  });
});
