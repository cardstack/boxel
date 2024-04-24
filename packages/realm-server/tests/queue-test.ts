import { module, test } from 'qunit';
import { prepareTestDB } from './helpers';

import PgQueue from '../pg-queue';

import { type Queue } from '@cardstack/runtime-common';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import queueTests from '@cardstack/runtime-common/tests/queue-test';

module('queue', function (hooks) {
  let queue: Queue;

  hooks.beforeEach(async function () {
    prepareTestDB();
    queue = new PgQueue();
    await queue.start();
  });

  hooks.afterEach(async function () {
    await queue.destroy();
  });

  test('it can run a job', async function (assert) {
    await runSharedTest(queueTests, assert, { queue });
  });

  test(`a job can throw an exception`, async function (assert) {
    await runSharedTest(queueTests, assert, { queue });
  });

  test('jobs are processed serially within a particular queue', async function (assert) {
    await runSharedTest(queueTests, assert, { queue });
  });

  // Concurrency control using different queues is only supported in pg-queue,
  // so these are not tests that are shared with the browser queue implementation.
  module('multiple queue clients', function (nestedHooks) {
    let queue2: Queue;
    nestedHooks.beforeEach(async function () {
      queue2 = new PgQueue();
      await queue2.start();
    });

    nestedHooks.afterEach(async function () {
      await queue2.destroy();
    });

    test('jobs are processed serially within a particular queue across different queue clients', async function (assert) {
      assert.expect(8);
      let startedCount = 0;
      let completedCount = 0;
      let count = async (expectedStartedCount: number) => {
        assert.strictEqual(
          startedCount,
          expectedStartedCount,
          `the expected started count before job run, ${expectedStartedCount}, is correct`,
        );
        assert.strictEqual(
          completedCount,
          expectedStartedCount,
          `the expected completed count before job run, ${expectedStartedCount}, is correct`,
        );
        startedCount++;
        await new Promise((r) => setTimeout(r, 500));
        completedCount++;
        assert.strictEqual(
          startedCount,
          expectedStartedCount + 1,
          `the expected started count after job run, ${
            expectedStartedCount + 1
          }, is correct`,
        );
        assert.strictEqual(
          completedCount,
          expectedStartedCount + 1,
          `the expected completed count after job run, ${
            expectedStartedCount + 1
          }, is correct`,
        );
      };

      queue.register('count', count);
      queue2.register('count', count);

      let [job1, job2] = await Promise.all([
        queue.publish('count', 0, {
          queueName: 'serial-queue',
        }),
        queue2.publish('count', 1, {
          queueName: 'serial-queue',
        }),
      ]);

      await Promise.all([job2.done, job1.done]);
    });

    test('different queues are processed concurrently across different queue clients', async function (assert) {
      assert.expect(3);
      let completedCount = 0;
      let count = async (expectedCompletedCount: number) => {
        assert.strictEqual(
          completedCount,
          expectedCompletedCount,
          `the expected completed count before job run, ${expectedCompletedCount}, is correct`,
        );
        await new Promise((r) => setTimeout(r, 500));
        completedCount++;
      };

      queue.register('count', count);
      queue2.register('count', count);

      let [job1, job2] = await Promise.all([
        queue.publish('count', 0, {
          queueName: 'queue1',
        }),
        queue2.publish('count', 0, {
          queueName: 'queue2',
        }),
      ]);

      await Promise.all([job2.done, job1.done]);

      assert.strictEqual(
        completedCount,
        2,
        'the expected completed count after all jobs have run, 2, is correct',
      );
    });
  });
});
