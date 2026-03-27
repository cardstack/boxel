import { module, test } from 'qunit';
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import { Deferred } from '@cardstack/runtime-common';
import { PgAdapter, PgQueueRunner } from '@cardstack/postgres';
import { createJWT, setupPermissionedRealmCached, waitUntil } from '../helpers';
import type { PgAdapter as TestPgAdapter } from '@cardstack/postgres';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module(
    'Realm-specific Endpoints | POST _cancel-indexing-job',
    function (hooks) {
      let testRealm: Realm;
      let request: SuperTest<Test>;
      let dbAdapter: TestPgAdapter;
      let publisher: QueuePublisher;
      let runner: QueueRunner;

      function onRealmSetup(args: {
        testRealm: Realm;
        request: SuperTest<Test>;
        dbAdapter: TestPgAdapter;
        publisher: QueuePublisher;
        runner: QueueRunner;
      }) {
        testRealm = args.testRealm;
        request = args.request;
        dbAdapter = args.dbAdapter;
        publisher = args.publisher;
        runner = args.runner;
      }

      setupPermissionedRealmCached(hooks, {
        permissions: {
          writer: ['read', 'write'],
          reader: ['read'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      test('returns 401 without JWT for private realm', async function (assert) {
        let response = await request
          .post('/_cancel-indexing-job')
          .set('Accept', 'application/json');

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('returns 403 for user without write access', async function (assert) {
        let response = await request
          .post('/_cancel-indexing-job')
          .set('Accept', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'reader', ['read'])}`,
          );

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('cancels running indexing jobs but does not cancel pending indexing jobs', async function (assert) {
        let concurrencyGroup = `indexing:${testRealm.url}`;
        let [{ id: runningJobId }] = (await dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealm.url}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          '${concurrencyGroup}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        await dbAdapter.execute(`INSERT INTO job_reservations
        (job_id, locked_until ) VALUES (${runningJobId}, NOW() + INTERVAL '3 minutes')`);
        let [{ id: pendingJobId }] = (await dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealm.url}", "realmUsername":"node-test_realm"}',
          'incremental-index',
          '${concurrencyGroup}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];

        let response = await request
          .post('/_cancel-indexing-job')
          .set('Accept', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
          );

        assert.strictEqual(response.status, 204, 'HTTP 204 response');

        let [runningJob] = await dbAdapter.execute(
          `SELECT status, result, finished_at FROM jobs WHERE id = ${runningJobId}`,
        );
        assert.strictEqual(
          runningJob.status,
          'rejected',
          'running job was canceled',
        );
        assert.deepEqual(
          runningJob.result,
          {
            status: 418,
            message: 'User initiated job cancellation',
          },
          'running job result is cancellation payload',
        );
        assert.ok(runningJob.finished_at, 'running job has finish time');

        let runningReservations = await dbAdapter.execute(
          `SELECT id FROM job_reservations WHERE job_id = ${runningJobId} AND completed_at IS NULL`,
        );
        assert.strictEqual(
          runningReservations.length,
          0,
          'running job reservations were completed',
        );

        let [pendingJob] = await dbAdapter.execute(
          `SELECT status, result, finished_at FROM jobs WHERE id = ${pendingJobId}`,
        );
        assert.strictEqual(
          pendingJob.status,
          'unfulfilled',
          'pending job was not canceled',
        );
        assert.strictEqual(
          pendingJob.result,
          null,
          'pending job result unchanged',
        );
        assert.strictEqual(
          pendingJob.finished_at,
          null,
          'pending job finish time unchanged',
        );
      });

      test('returns 204 and does nothing when there is no running indexing job', async function (assert) {
        let concurrencyGroup = `indexing:${testRealm.url}`;
        let [{ id: pendingJobId }] = (await dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealm.url}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          '${concurrencyGroup}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];

        let response = await request
          .post('/_cancel-indexing-job')
          .set('Accept', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
          );

        assert.strictEqual(response.status, 204, 'HTTP 204 response');

        let [pendingJob] = await dbAdapter.execute(
          `SELECT status, result, finished_at FROM jobs WHERE id = ${pendingJobId}`,
        );
        assert.strictEqual(
          pendingJob.status,
          'unfulfilled',
          'pending job remains unfulfilled',
        );
        assert.strictEqual(
          pendingJob.result,
          null,
          'pending job result unchanged',
        );
        assert.strictEqual(
          pendingJob.finished_at,
          null,
          'pending job finish time unchanged',
        );
      });

      test('cancels both running and pending jobs when cancelPending is true', async function (assert) {
        let concurrencyGroup = `indexing:${testRealm.url}`;

        // Create a running job (with active reservation)
        let [{ id: runningJobId }] = (await dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealm.url}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          '${concurrencyGroup}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        await dbAdapter.execute(`INSERT INTO job_reservations
        (job_id, locked_until ) VALUES (${runningJobId}, NOW() + INTERVAL '3 minutes')`);

        // Create a pending job (no reservation)
        let [{ id: pendingJobId }] = (await dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealm.url}", "realmUsername":"node-test_realm"}',
          'incremental-index',
          '${concurrencyGroup}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];

        let response = await request
          .post('/_cancel-indexing-job')
          .set('Accept', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
          )
          .send({ cancelPending: true });

        assert.strictEqual(response.status, 204, 'HTTP 204 response');

        // Running job should be cancelled
        let [runningJob] = await dbAdapter.execute(
          `SELECT status, result, finished_at FROM jobs WHERE id = ${runningJobId}`,
        );
        assert.strictEqual(
          runningJob.status,
          'rejected',
          'running job was canceled',
        );
        assert.deepEqual(
          runningJob.result,
          {
            status: 418,
            message: 'User initiated job cancellation',
          },
          'running job result is cancellation payload',
        );
        assert.ok(runningJob.finished_at, 'running job has finish time');

        // Pending job should ALSO be cancelled
        let [pendingJob] = await dbAdapter.execute(
          `SELECT status, result, finished_at FROM jobs WHERE id = ${pendingJobId}`,
        );
        assert.strictEqual(
          pendingJob.status,
          'rejected',
          'pending job was also canceled when cancelPending is true',
        );
        assert.deepEqual(
          pendingJob.result,
          {
            status: 418,
            message: 'User initiated job cancellation',
          },
          'pending job result is cancellation payload',
        );
        assert.ok(pendingJob.finished_at, 'pending job has finish time');
      });

      test('default behavior (no body) only cancels running jobs, not pending', async function (assert) {
        let concurrencyGroup = `indexing:${testRealm.url}`;

        let [{ id: runningJobId }] = (await dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealm.url}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          '${concurrencyGroup}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        await dbAdapter.execute(`INSERT INTO job_reservations
        (job_id, locked_until ) VALUES (${runningJobId}, NOW() + INTERVAL '3 minutes')`);

        let [{ id: pendingJobId }] = (await dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealm.url}", "realmUsername":"node-test_realm"}',
          'incremental-index',
          '${concurrencyGroup}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];

        // No body — default behavior
        let response = await request
          .post('/_cancel-indexing-job')
          .set('Accept', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
          );

        assert.strictEqual(response.status, 204, 'HTTP 204 response');

        let [runningJob] = await dbAdapter.execute(
          `SELECT status FROM jobs WHERE id = ${runningJobId}`,
        );
        assert.strictEqual(runningJob.status, 'rejected', 'running job canceled');

        let [pendingJob] = await dbAdapter.execute(
          `SELECT status FROM jobs WHERE id = ${pendingJobId}`,
        );
        assert.strictEqual(
          pendingJob.status,
          'unfulfilled',
          'pending job NOT canceled when cancelPending is not set',
        );
      });

      test('does not treat expired reservations as running jobs', async function (assert) {
        let concurrencyGroup = `indexing:${testRealm.url}`;
        let [{ id: jobId }] = (await dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealm.url}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          '${concurrencyGroup}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        await dbAdapter.execute(`INSERT INTO job_reservations
        (job_id, locked_until ) VALUES (${jobId}, NOW() - INTERVAL '1 minutes')`);

        let response = await request
          .post('/_cancel-indexing-job')
          .set('Accept', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
          );

        assert.strictEqual(response.status, 204, 'HTTP 204 response');
        let [job] = await dbAdapter.execute(
          `SELECT status, result, finished_at FROM jobs WHERE id = ${jobId}`,
        );
        assert.strictEqual(
          job.status,
          'unfulfilled',
          'job with expired reservation is not canceled',
        );
        assert.strictEqual(job.result, null, 'job result remains unchanged');
        assert.strictEqual(
          job.finished_at,
          null,
          'job finish time remains unchanged',
        );
      });

      test('worker can continue to process new jobs after canceling a running indexing job', async function (assert) {
        let jobStarted = new Deferred<void>();
        let releaseJob = new Deferred<void>();
        let jobFinished = new Deferred<void>();
        let events: string[] = [];

        runner.register(
          'blocking-job',
          async ({ jobNum }: { jobNum: number }) => {
            events.push(`job${jobNum} start`);
            if (jobNum === 1) {
              jobStarted.fulfill();
              await releaseJob.promise;
            }
            events.push(`job${jobNum} finish`);
            if (jobNum === 1) {
              jobFinished.fulfill();
            }
            return jobNum;
          },
        );

        let concurrencyGroup = `indexing:${testRealm.url}`;
        let job1 = await publisher.publish({
          jobType: 'blocking-job',
          concurrencyGroup,
          timeout: 30,
          args: { jobNum: 1 },
        });
        let job1Outcome = job1.done.then(
          (result) => ({ outcome: 'resolved' as const, result }),
          (error) => ({ outcome: 'rejected' as const, error }),
        );

        await jobStarted.promise;
        await waitUntil(async () => {
          let rows = await dbAdapter.execute(
            `SELECT id FROM job_reservations WHERE job_id = ${job1.id} AND completed_at IS NULL`,
          );
          return rows.length > 0;
        });

        let response = await request
          .post('/_cancel-indexing-job')
          .set('Accept', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
          );
        assert.strictEqual(response.status, 204, 'HTTP 204 response');

        let [job1Record] = await dbAdapter.execute(
          `SELECT status FROM jobs WHERE id = ${job1.id}`,
        );
        assert.strictEqual(
          job1Record.status,
          'rejected',
          'running job canceled',
        );

        let adapter2 = new PgAdapter();
        let runner2 = new PgQueueRunner({
          adapter: adapter2,
          workerId: 'cancel-indexing-job-test-worker-2',
        });
        runner2.register(
          'blocking-job',
          async ({ jobNum }: { jobNum: number }) => {
            events.push(`job${jobNum} start`);
            events.push(`job${jobNum} finish`);
            return jobNum;
          },
        );
        await runner2.start();

        try {
          let job2 = await publisher.publish({
            jobType: 'blocking-job',
            concurrencyGroup,
            timeout: 30,
            args: { jobNum: 2 },
          });
          let job2Result = await job2.done;
          assert.strictEqual(job2Result, 2, 'next job completed');
        } finally {
          releaseJob.fulfill();
          await jobFinished.promise;
          await runner2.destroy();
          await adapter2.close();
        }

        let outcome = await job1Outcome;
        assert.strictEqual(
          outcome.outcome,
          'rejected',
          'job1 outcome is rejected',
        );
        if (outcome.outcome === 'rejected') {
          assert.deepEqual(
            outcome.error,
            {
              status: 418,
              message: 'User initiated job cancellation',
            },
            'job1 cancellation payload is correct',
          );
        }
        assert.deepEqual(events, [
          'job1 start',
          'job2 start',
          'job2 finish',
          'job1 finish',
        ]);
      });
    },
  );
});
