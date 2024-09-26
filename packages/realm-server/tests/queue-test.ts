import { module, test } from 'qunit';
import { prepareTestDB } from './helpers';

import PgQueue from '../pg-queue';
import PgAdapter from '../pg-adapter';

import { type Queue } from '@cardstack/runtime-common';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import queueTests from '@cardstack/runtime-common/tests/queue-test';

module('queue', function (hooks) {
  let queue: Queue;
  let adapter: PgAdapter;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = new PgAdapter();
    queue = new PgQueue(adapter, 'q1');
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
    let adapter2: PgAdapter;
    nestedHooks.beforeEach(async function () {
      adapter2 = new PgAdapter();
      queue2 = new PgQueue(adapter2, 'q2');
      await queue2.start();

      // Because we need tight timing control for this test, we don't want any
      // concurrent migrations and their retries altering the timing. This
      // ensures both adapters have gotten fully past that and are quiescent.
      await adapter.execute('select 1');
      await adapter2.execute('select 1');
    });

    nestedHooks.afterEach(async function () {
      await queue2.destroy();
    });

    test('jobs are processed serially within a particular queue across different queue clients', async function (assert) {
      let events: string[] = [];

      let count = async (jobNum: number) => {
        events.push(`job${jobNum} start`);
        await new Promise((r) => setTimeout(r, 500));
        events.push(`job${jobNum} finish`);
      };

      queue.register('count', count);
      queue2.register('count', count);

      let promiseForJob1 = queue.publish('count', 'count-group', 5000, 1);
      // start the 2nd job before the first job finishes
      await new Promise((r) => setTimeout(r, 100));
      let promiseForJob2 = queue2.publish('count', 'count-group', 5000, 2);
      let [job1, job2] = await Promise.all([promiseForJob1, promiseForJob2]);

      await Promise.all([job1.done, job2.done]);
      assert.deepEqual(events, [
        'job1 start',
        'job1 finish',
        'job2 start',
        'job2 finish',
      ]);
    });

    // test: job can timeout; timed out job is picked up by another worker
    // test: jobs can be run concurrently if they have different concurrency group values
    // test: completed jobs are not re-run

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
        queue.publish('count', 'count-group', 5, 0),
        queue2.publish('count', 'count-group', 5, 0),
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
