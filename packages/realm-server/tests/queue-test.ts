import { module, test } from 'qunit';
import { prepareTestDB } from './helpers';

import PgQueue from '../pg-queue';
import PgAdapter from '../pg-adapter';

import { type Queue } from '@cardstack/runtime-common';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import queueTests from '@cardstack/runtime-common/tests/queue-test';
import { assert } from '@ember/debug';

module('queue', function (hooks) {
  let queue: Queue;
  let adapter: PgAdapter;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = new PgAdapter();
    queue = new PgQueue(adapter, 'q1');
    // await queue.start();
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
      // await queue2.start();

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
      assert.expect(8);
      let startedCount = 0;
      let completedCount = 0;
      let count = async (expectedStartedCount: number) => {
        assert.strictEqual(
          startedCount,
          expectedStartedCount,
          `For Queue #${
            expectedStartedCount + 1
          }, the expected started count before job run, ${expectedStartedCount}, is correct`,
        );
        assert.strictEqual(
          completedCount,
          expectedStartedCount,
          `For Queue #${
            expectedStartedCount + 1
          }, the expected completed count before job run, ${expectedStartedCount}, is correct`,
        );
        startedCount++;
        await new Promise((r) => setTimeout(r, 500));
        completedCount++;
        assert.strictEqual(
          startedCount,
          expectedStartedCount + 1,
          `For Queue #${
            expectedStartedCount + 1
          }, the expected started count after job run, ${
            expectedStartedCount + 1
          }, is correct`,
        );
        assert.strictEqual(
          completedCount,
          expectedStartedCount + 1,
          `For Queue #${
            expectedStartedCount + 1
          }, the expected completed count after job run, ${
            expectedStartedCount + 1
          }, is correct`,
        );
      };

      queue.register('count', count);
      queue2.register('count', count);

      let promiseForJob1 = queue.publish('count', 'count-group', 5, 0);
      // start the 2nd job before the first job finishes
      await new Promise((r) => setTimeout(r, 100));
      let promiseForJob2 = queue2.publish('count', 'count-group', 5, 1);
      let [job1, job2] = await Promise.all([promiseForJob1, promiseForJob2]);

      await Promise.all([job1.done, job2.done]);
    });

    test('transaction level behavior', async function (assert) {
      await adapter.execute(
        `INSERT INTO jobs (job_type, concurrency_group, timeout, status, args) VALUES ('hello', 'hello', 50000, 'unfulfilled', '{}'::jsonb)`,
      );

      await adapter.execute('BEGIN');
      await adapter.execute('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      await adapter2.execute('BEGIN');
      await adapter2.execute('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

      await adapter.execute('SELECT * FROM jobs');
      await adapter.execute('SELECT * FROM job_reservations');
      await adapter.execute(
        `INSERT INTO job_reservations (job_id, locked_until, worker_id) VALUES (1, '2025-09-25T00:00:00.000Z', 'worker1')`,
      );

      await adapter2.execute('SELECT * FROM jobs');
      await adapter2.execute('SELECT * FROM job_reservations');
      await adapter2.execute(
        `INSERT INTO job_reservations (job_id, locked_until, worker_id) VALUES (1, '2025-09-26T00:00:00.000Z', 'worker2')`,
      );

      await adapter.execute('COMMIT');
      await adapter2.execute('COMMIT');
    });

    // eslint-disable-next-line qunit/no-only
    test.only('transaction level behavior withConnection', async function (assert) {
      await adapter.execute(
        `INSERT INTO jobs (job_type, concurrency_group, timeout, status, args) VALUES ('hello', 'hello', 50000, 'unfulfilled', '{}'::jsonb)`,
      );

      await adapter.withConnection(async (query1) => {
        await adapter2.withConnection(async (query2) => {
          await query1(['BEGIN']);
          await query1(['SET TRANSACTION ISOLATION LEVEL SERIALIZABLE']);
          await query2(['BEGIN']);
          await query2(['SET TRANSACTION ISOLATION LEVEL SERIALIZABLE']);

          let results1 = await query1([
            `WITH pending_jobs as (
      select * from jobs where status='unfulfilled'
    ), valid_reservations as (
      select * from job_reservations where locked_until > NOW() and completed_at is null
    )
    select j.* from pending_jobs j where j.id not in (select job_id from valid_reservations) ORDER BY j.created_at LIMIT 1
    `,
          ]);
          let results2 = await query2([
            `WITH pending_jobs as (
            select * from jobs where status='unfulfilled'
          ), valid_reservations as (
            select * from job_reservations where locked_until > NOW() and completed_at is null
          )
          select j.* from pending_jobs j where j.id not in (select job_id from valid_reservations) ORDER BY j.created_at LIMIT 1
          `,
          ]);
          console.log({ results2 });
          console.log({ results1 });
          if (results1.length > 0) {
            console.log('inserting job reservation with client1');
            await query1([
              `INSERT INTO job_reservations (job_id, locked_until, worker_id) VALUES (1, '2025-09-25T00:00:00.000Z', 'worker1')`,
            ]);
          }
          if (results2.length > 0) {
            console.log('inserting job reservation with client2');
            await query2([
              `INSERT INTO job_reservations (job_id, locked_until, worker_id) VALUES (1, '2025-09-26T00:00:00.000Z', 'worker2')`,
            ]);
          }
          await query1(['COMMIT']);
          await query2(['COMMIT']);
        });
      });
      assert.ok(true);
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
