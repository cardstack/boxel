import { module, test } from 'qunit';
import { prepareTestDB } from './helpers';

import { PgQueueRunner, PgQueuePublisher } from '../pg-queue';
import PgAdapter from '../pg-adapter';

import {
  type QueuePublisher,
  type QueueRunner,
} from '@cardstack/runtime-common';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import queueTests from '@cardstack/runtime-common/tests/queue-test';

module('queue', function (hooks) {
  let publisher: QueuePublisher;
  let runner: QueueRunner;
  let adapter: PgAdapter;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = new PgAdapter();
    publisher = new PgQueuePublisher(adapter);
    runner = new PgQueueRunner(adapter, 'q1');
    await runner.start();
  });

  hooks.afterEach(async function () {
    await runner.destroy();
    await publisher.destroy();
  });

  test('it can run a job', async function (assert) {
    await runSharedTest(queueTests, assert, { runner, publisher });
  });

  test(`a job can throw an exception`, async function (assert) {
    await runSharedTest(queueTests, assert, { runner, publisher });
  });

  test('jobs are processed serially within a particular queue', async function (assert) {
    await runSharedTest(queueTests, assert, { runner, publisher });
  });

  // Concurrency control using different queues is only supported in pg-queue,
  // so these are not tests that are shared with the browser queue implementation.
  module('multiple queue clients', function (nestedHooks) {
    let runner2: QueueRunner;
    let adapter2: PgAdapter;
    nestedHooks.beforeEach(async function () {
      adapter2 = new PgAdapter();
      runner2 = new PgQueueRunner(adapter2, 'q2');
      await runner2.start();

      // Because we need tight timing control for this test, we don't want any
      // concurrent migrations and their retries altering the timing. This
      // ensures both adapters have gotten fully past that and are quiescent.
      await adapter.execute('select 1');
      await adapter2.execute('select 1');
    });

    nestedHooks.afterEach(async function () {
      await runner2.destroy();
    });

    test('jobs in different concurrency groups can run in parallel', async function (assert) {
      let events: string[] = [];

      let logJob = async (jobNum: number) => {
        events.push(`job${jobNum} start`);
        await new Promise((r) => setTimeout(r, 500));
        events.push(`job${jobNum} finish`);
      };

      runner.register('logJob', logJob);
      runner2.register('logJob', logJob);

      let promiseForJob1 = publisher.publish('logJob', 'log-group', 5000, 1);
      // start the 2nd job before the first job finishes
      await new Promise((r) => setTimeout(r, 100));
      let promiseForJob2 = publisher.publish('logJob', 'other-group', 5000, 2);
      let [job1, job2] = await Promise.all([promiseForJob1, promiseForJob2]);

      await Promise.all([job1.done, job2.done]);
      assert.deepEqual(events, [
        'job1 start',
        'job2 start',
        'job1 finish',
        'job2 finish',
      ]);
    });

    test('jobs are processed serially within a particular queue across different queue clients', async function (assert) {
      let events: string[] = [];

      let logJob = async (jobNum: number) => {
        events.push(`job${jobNum} start`);
        await new Promise((r) => setTimeout(r, 500));
        events.push(`job${jobNum} finish`);
      };

      runner.register('logJob', logJob);
      runner2.register('logJob', logJob);

      let promiseForJob1 = publisher.publish('logJob', 'log-group', 5000, 1);
      // start the 2nd job before the first job finishes
      await new Promise((r) => setTimeout(r, 100));
      let promiseForJob2 = publisher.publish('logJob', 'log-group', 5000, 2);
      let [job1, job2] = await Promise.all([promiseForJob1, promiseForJob2]);

      await Promise.all([job1.done, job2.done]);
      assert.deepEqual(events, [
        'job1 start',
        'job1 finish',
        'job2 start',
        'job2 finish',
      ]);
    });

    test('job can timeout; timed out job is picked up by another worker', async function (assert) {
      let events: string[] = [];
      let runs = 0;
      let logJob = async () => {
        let me = runs;
        events.push(`job${me} start`);
        if (runs++ === 0) {
          await new Promise((r) => setTimeout(r, 2000));
        }
        events.push(`job${me} finish`);
        return me;
      };

      runner.register('logJob', logJob);
      runner2.register('logJob', logJob);

      let job = await publisher.publish('logJob', 'log-group', 1, null);

      // just after our job has timed out, kick the queue so that another worker
      // will notice it. Otherwise we'd be stuck until the polling comes around.
      await new Promise((r) => setTimeout(r, 1100));
      await adapter.execute('NOTIFY jobs');

      let result = await job.done;

      assert.strictEqual(result, 1);

      // at this point the long-running first job is still stuck. it will
      // eventually also log "job0 finish", but that is absorbed by our test
      // afterEach
      assert.deepEqual(events, ['job0 start', 'job1 start', 'job1 finish']);
    });
  });
});
