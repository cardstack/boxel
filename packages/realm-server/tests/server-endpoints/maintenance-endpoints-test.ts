import { module, test } from 'qunit';
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import sinon from 'sinon';
import { PgAdapter, PgQueueRunner } from '@cardstack/postgres';
import { sumUpCreditsLedger } from '@cardstack/billing/billing-queries';
import * as boxelUIChangeChecker from '../../lib/boxel-ui-change-checker';
import { grafanaSecret, insertUser, realmSecretSeed } from '../helpers';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import { setupServerEndpointsTest, testRealm2URL } from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`server-endpoints/${basename(__filename)}`, function () {
  module(
    'Realm Server Endpoints (not specific to one realm)',
    function (hooks) {
      let context = setupServerEndpointsTest(hooks);

      test('can force job completion by job_id via grafana endpoint', async function (assert) {
        let [{ id }] = (await context.dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealm2URL.href}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          'indexing:${testRealm2URL.href}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        let response = await context.request2
          .get(
            `/_grafana-complete-job?authHeader=${grafanaSecret}&job_id=${id}`,
          )
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 204, 'HTTP 204 response');
        let [job] = await context.dbAdapter.execute(
          `SELECT * FROM jobs WHERE id = ${id}`,
        );
        assert.strictEqual(job.status, 'rejected', 'job status is correct');
        assert.deepEqual(
          job.result,
          {
            status: 418,
            message: 'User initiated job cancellation',
          },
          'job result is correct',
        );
        assert.ok(job.finished_at, 'job was marked with finish time');
      });

      test('can force job completion by reservation_id via grafana endpoint', async function (assert) {
        let [{ id: jobId }] = (await context.dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealm2URL.href}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          'indexing:${testRealm2URL.href}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        let [{ id: reservationId }] = (await context.dbAdapter
          .execute(`INSERT INTO job_reservations
        (job_id, locked_until ) VALUES (${jobId}, NOW() + INTERVAL '3 minutes') RETURNING id`)) as {
          id: string;
        }[];
        await context.dbAdapter.execute(`INSERT INTO job_reservations
        (job_id, locked_until ) VALUES (${jobId}, NOW() + INTERVAL '2 minutes')`);
        let response = await context.request2
          .get(
            `/_grafana-complete-job?authHeader=${grafanaSecret}&reservation_id=${reservationId}`,
          )
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 204, 'HTTP 204 response');
        let reservations = await context.dbAdapter.execute(
          `SELECT * FROM job_reservations WHERE job_id = ${jobId} AND completed_at IS NULL`,
        );
        assert.strictEqual(
          reservations.length,
          0,
          'all reservations are completed',
        );
        let [job] = await context.dbAdapter.execute(
          `SELECT * FROM jobs WHERE id = ${jobId}`,
        );
        assert.strictEqual(job.status, 'rejected', 'job status is correct');
        assert.deepEqual(
          job.result,
          {
            status: 418,
            message: 'User initiated job cancellation',
          },
          'job result is correct',
        );
        assert.ok(job.finished_at, 'job was marked with finish time');
      });

      test('can force job completion by job_id where reservation id exists via grafana endpoint', async function (assert) {
        let [{ id: jobId }] = (await context.dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealm2URL.href}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          'indexing:${testRealm2URL.href}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        await context.dbAdapter.execute(`INSERT INTO job_reservations
        (job_id, locked_until ) VALUES (${jobId}, NOW() + INTERVAL '3 minutes')`);
        await context.dbAdapter.execute(`INSERT INTO job_reservations
        (job_id, locked_until ) VALUES (${jobId}, NOW() + INTERVAL '2 minutes')`);
        let response = await context.request2
          .get(
            `/_grafana-complete-job?authHeader=${grafanaSecret}&job_id=${jobId}`,
          )
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 204, 'HTTP 204 response');
        let reservations = await context.dbAdapter.execute(
          `SELECT * FROM job_reservations WHERE job_id = ${jobId} AND completed_at IS NULL`,
        );
        assert.strictEqual(
          reservations.length,
          0,
          'all reservations are completed',
        );
        let [job] = await context.dbAdapter.execute(
          `SELECT * FROM jobs WHERE id = ${jobId}`,
        );
        assert.strictEqual(job.status, 'rejected', 'job status is correct');
        assert.deepEqual(
          job.result,
          {
            status: 418,
            message: 'User initiated job cancellation',
          },
          'job result is correct',
        );
        assert.ok(job.finished_at, 'job was marked with finish time');
      });

      test('can cancel a running job by reservation_id and allow the next job to run', async function (assert) {
        let jobStartedResolve: (() => void) | undefined;
        let jobFinishedResolve: (() => void) | undefined;
        let releaseJobResolve: (() => void) | undefined;
        let jobStarted = new Promise<void>((resolve) => {
          jobStartedResolve = resolve;
        });
        let jobFinished = new Promise<void>((resolve) => {
          jobFinishedResolve = resolve;
        });
        let releaseJob = new Promise<void>((resolve) => {
          releaseJobResolve = resolve;
        });
        let events: string[] = [];

        context.runner.register(
          'blocking-job',
          async ({ jobNum }: { jobNum: number }) => {
            events.push(`job${jobNum} start`);
            if (jobNum === 1) {
              jobStartedResolve?.();
              await releaseJob;
            }
            events.push(`job${jobNum} finish`);
            if (jobNum === 1) {
              jobFinishedResolve?.();
            }
            return jobNum;
          },
        );

        let job1 = await context.publisher.publish({
          jobType: 'blocking-job',
          concurrencyGroup: 'grafana-cancel-group',
          timeout: 30,
          args: { jobNum: 1 },
        });
        let job1Outcome = job1.done.then(
          (result) => ({ outcome: 'resolved' as const, result }),
          (error) => ({ outcome: 'rejected' as const, error }),
        );

        await jobStarted;
        let [reservation] = await context.dbAdapter.execute(
          `SELECT id FROM job_reservations WHERE job_id = ${job1.id} AND completed_at IS NULL`,
        );
        let reservationId = reservation?.id;
        assert.ok(reservationId, 'reservation exists for running job');

        let response = await context.request2
          .get(
            `/_grafana-complete-job?authHeader=${grafanaSecret}&reservation_id=${reservationId}`,
          )
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 204, 'HTTP 204 response');

        let reservations = await context.dbAdapter.execute(
          `SELECT id FROM job_reservations WHERE job_id = ${job1.id} AND completed_at IS NULL`,
        );
        assert.strictEqual(
          reservations.length,
          0,
          'running reservation cleared',
        );

        let adapter2 = new PgAdapter();
        let runner2 = new PgQueueRunner({
          adapter: adapter2,
          workerId: 'test-worker-2',
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
          let job2 = await context.publisher.publish({
            jobType: 'blocking-job',
            concurrencyGroup: 'grafana-cancel-group',
            timeout: 30,
            args: { jobNum: 2 },
          });
          let job2Result = await job2.done;
          assert.strictEqual(job2Result, 2, 'next job completed');
        } finally {
          releaseJobResolve?.();
          await jobFinished;
          await runner2.destroy();
          await adapter2.close();
        }

        let outcome = await job1Outcome;
        assert.strictEqual(outcome.outcome, 'rejected', 'running job canceled');
        if (outcome.outcome === 'rejected') {
          assert.deepEqual(
            outcome.error,
            {
              status: 418,
              message: 'User initiated job cancellation',
            },
            'cancellation result is correct',
          );
        } else {
          assert.ok(false, 'expected running job to be canceled');
        }
        assert.deepEqual(events, [
          'job1 start',
          'job2 start',
          'job2 finish',
          'job1 finish',
        ]);
      });

      test('returns 401 when calling grafana job completion endpoint without a grafana secret', async function (assert) {
        let [{ id }] = (await context.dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealm2URL.href}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          'indexing:${testRealm2URL.href}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        let response = await context.request2
          .get(`/_grafana-complete-job?job_id=${id}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
        let [job] = await context.dbAdapter.execute(
          `SELECT * FROM jobs WHERE id = ${id}`,
        );
        assert.strictEqual(job.status, 'unfulfilled', 'job status is correct');
        assert.strictEqual(
          job.finished_at,
          null,
          'job was not marked with finish time',
        );
      });

      test('can add user credit via grafana endpoint', async function (assert) {
        let user = await insertUser(
          context.dbAdapter,
          'user@test',
          'cus_123',
          'user@test.com',
        );
        let sum = await sumUpCreditsLedger(context.dbAdapter, {
          creditType: ['extra_credit', 'extra_credit_used'],
          userId: user.id,
        });
        assert.strictEqual(sum, 0, `user has 0 extra credit`);

        let response = await context.request2
          .get(
            `/_grafana-add-credit?authHeader=${grafanaSecret}&user=${user.matrixUserId}&credit=1000`,
          )
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          response.body,
          {
            message: `Added 1000 credits to user '${user.matrixUserId}'`,
          },
          `response body is correct`,
        );
        sum = await sumUpCreditsLedger(context.dbAdapter, {
          creditType: ['extra_credit', 'extra_credit_used'],
          userId: user.id,
        });
        assert.strictEqual(sum, 1000, `user has 1000 extra credit`);
      });

      test('returns 400 when calling grafana add credit endpoint without a user', async function (assert) {
        let response = await context.request2
          .get(`/_grafana-add-credit?authHeader=${grafanaSecret}&credit=1000`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 400, 'HTTP 400 status');
      });

      test('returns 400 when calling grafana add credit endpoint with credit amount that is not a number', async function (assert) {
        let user = await insertUser(
          context.dbAdapter,
          'user@test',
          'cus_123',
          'user@test.com',
        );
        let response = await context.request2
          .get(
            `/_grafana-add-credit?authHeader=${grafanaSecret}&user=${user.matrixUserId}&credit=a+million+dollars`,
          )
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let sum = await sumUpCreditsLedger(context.dbAdapter, {
          creditType: ['extra_credit', 'extra_credit_used'],
          userId: user.id,
        });
        assert.strictEqual(sum, 0, `user has 0 extra credit`);
      });

      test("returns 400 when calling grafana add credit endpoint when user doesn't exist", async function (assert) {
        let response = await context.request2
          .get(
            `/_grafana-add-credit?authHeader=${grafanaSecret}&user=nobody&credit=1000`,
          )
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 400, 'HTTP 400 status');
      });

      test('returns 401 when calling grafana add credit endpoint without a grafana secret', async function (assert) {
        let user = await insertUser(
          context.dbAdapter,
          'user@test',
          'cus_123',
          'user@test.com',
        );
        let response = await context.request2
          .get(`/_grafana-add-credit?user=${user.matrixUserId}&credit=1000`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
        let sum = await sumUpCreditsLedger(context.dbAdapter, {
          creditType: ['extra_credit', 'extra_credit_used'],
          userId: user.id,
        });
        assert.strictEqual(sum, 0, `user has 0 extra credit`);
      });

      test('can reindex a realm via grafana endpoint', async function (assert) {
        let endpoint = `test-realm-${uuidv4()}`;
        let owner = 'mango';
        let ownerUserId = `@${owner}:localhost`;
        let realmURL: string;
        {
          let response = await context.request2
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: ownerUserId, sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: {
                    name: 'Test Realm',
                    endpoint,
                  },
                },
              }),
            );
          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          realmURL = response.body.data.id;
        }
        let initialJobs = await context.dbAdapter.execute('select * from jobs');
        assert.strictEqual(
          initialJobs.length,
          2,
          'number of jobs initially is correct',
        );
        {
          let realmPath = realmURL.substring(
            new URL(testRealm2URL.origin).href.length,
          );
          let response = await context.request2
            .get(
              `/_grafana-reindex?authHeader=${grafanaSecret}&realm=${realmPath}`,
            )
            .set('Content-Type', 'application/json');
          assert.deepEqual(response.body, {
            fileErrors: 0,
            filesIndexed: 2,
            instanceErrors: 0,
            instancesIndexed: 2,
            totalIndexEntries: 4,
          });
        }
        let finalJobs = await context.dbAdapter.execute('select * from jobs');
        assert.strictEqual(finalJobs.length, 3, 'an index job was created');
        let job = finalJobs.pop()!;
        assert.strictEqual(
          job.job_type,
          'from-scratch-index',
          'job type is correct',
        );
        assert.strictEqual(
          job.concurrency_group,
          `indexing:${realmURL}`,
          'concurrency group is correct',
        );
        assert.strictEqual(
          job.status,
          'resolved',
          'job completed successfully',
        );
        assert.ok(job.finished_at, 'job was marked with a finish time');
        assert.deepEqual(
          job.args,
          {
            realmURL,
            realmUsername: owner,
          },
          'realm args are correct',
        );
      });

      test('returns 401 when calling grafana reindex endpoint without a grafana secret', async function (assert) {
        let endpoint = `test-realm-${uuidv4()}`;
        let owner = 'mango';
        let ownerUserId = `@${owner}:localhost`;
        let realmURL: string;
        {
          let response = await context.request2
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: ownerUserId, sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: {
                    name: 'Test Realm',
                    endpoint,
                  },
                },
              }),
            );
          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          realmURL = response.body.data.id;
        }
        let initialJobs = await context.dbAdapter.execute('select * from jobs');
        {
          let response = await context.request2
            .get(`/_grafana-reindex?realm=${encodeURIComponent(realmURL)}`)
            .set('Content-Type', 'application/json');
          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        }
        let finalJobs = await context.dbAdapter.execute('select * from jobs');
        assert.strictEqual(
          finalJobs.length,
          initialJobs.length,
          'an index job was not created',
        );
      });

      test('post-deployment endpoint requires authorization header', async function (assert: Assert) {
        let response = await context.request2
          .post('/_post-deployment')
          .set('Content-Type', 'application/json');

        assert.strictEqual(
          response.status,
          401,
          'HTTP 401 status for missing auth header',
        );
      });

      test('post-deployment endpoint rejects incorrect authorization', async function (assert: Assert) {
        let response = await context.request2
          .post('/_post-deployment')
          .set('Content-Type', 'application/json')
          .set('Authorization', 'wrong-secret');

        assert.strictEqual(
          response.status,
          401,
          'HTTP 401 status for wrong auth header',
        );
      });

      test('post-deployment endpoint triggers full reindex when checksums differ', async function (assert: Assert) {
        let compareCurrentBoxelUIChecksumStub = sinon
          .stub(boxelUIChangeChecker, 'compareCurrentBoxelUIChecksum')
          .resolves({
            previousChecksum: 'old-checksum-123',
            currentChecksum: 'new-checksum-456',
          });
        let writeCurrentBoxelUIChecksumStub = sinon.stub(
          boxelUIChangeChecker,
          'writeCurrentBoxelUIChecksum',
        );

        try {
          let initialJobs =
            await context.dbAdapter.execute('select * from jobs');
          let initialJobCount = initialJobs.length;

          let response = await context.request2
            .post('/_post-deployment')
            .set('Content-Type', 'application/json')
            .set('Authorization', "mum's the word");

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.deepEqual(
            response.body,
            {
              previousChecksum: 'old-checksum-123',
              currentChecksum: 'new-checksum-456',
            },
            'response body contains checksum comparison result',
          );

          let finalJobs = await context.dbAdapter.execute('select * from jobs');
          assert.strictEqual(
            finalJobs.length,
            initialJobCount + 1,
            'a new full-reindex job was created when checksums differ',
          );

          let reindexJob = finalJobs.find(
            (job) => job.job_type === 'full-reindex',
          );
          assert.ok(reindexJob, 'full-reindex job exists');
          if (reindexJob) {
            assert.strictEqual(
              reindexJob.concurrency_group,
              'full-reindex-group',
              'job has correct concurrency group',
            );
            assert.strictEqual(
              reindexJob.timeout,
              360,
              'job has correct timeout (6 minutes)',
            );
          }

          assert.ok(
            writeCurrentBoxelUIChecksumStub.calledOnce,
            'writeCurrentBoxelUIChecksum was called',
          );
          assert.ok(
            writeCurrentBoxelUIChecksumStub.calledWith('new-checksum-456'),
            'writeCurrentBoxelUIChecksum called with new checksum',
          );
        } finally {
          compareCurrentBoxelUIChecksumStub.restore();
          writeCurrentBoxelUIChecksumStub.restore();
        }
      });

      test('post-deployment endpoint ignores reindex when checksums match', async function (assert: Assert) {
        let compareCurrentBoxelUIChecksumStub = sinon
          .stub(boxelUIChangeChecker, 'compareCurrentBoxelUIChecksum')
          .resolves({
            previousChecksum: 'same-checksum-789',
            currentChecksum: 'same-checksum-789',
          });
        let writeCurrentBoxelUIChecksumStub = sinon.stub(
          boxelUIChangeChecker,
          'writeCurrentBoxelUIChecksum',
        );

        try {
          let initialJobs =
            await context.dbAdapter.execute('select * from jobs');
          let initialJobCount = initialJobs.length;

          let response = await context.request2
            .post('/_post-deployment')
            .set('Content-Type', 'application/json')
            .set('Authorization', "mum's the word");

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.deepEqual(
            response.body,
            {
              previousChecksum: 'same-checksum-789',
              currentChecksum: 'same-checksum-789',
            },
            'response body contains checksum comparison result',
          );

          let finalJobs = await context.dbAdapter.execute('select * from jobs');
          assert.strictEqual(
            finalJobs.length,
            initialJobCount,
            'no new job was created when checksums are the same',
          );

          assert.ok(
            writeCurrentBoxelUIChecksumStub.notCalled,
            'writeCurrentBoxelUIChecksum was not called when checksums are same',
          );
        } finally {
          compareCurrentBoxelUIChecksumStub.restore();
          writeCurrentBoxelUIChecksumStub.restore();
        }
      });

      test('can reindex all realms via grafana endpoint', async function (assert) {
        let endpoint = `test-realm-${uuidv4()}`;
        let owner = 'mango';
        let ownerUserId = `@${owner}:localhost`;
        let realmURL: string;
        {
          let response = await context.request2
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: ownerUserId, sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: {
                    name: 'Test Realm',
                    endpoint,
                  },
                },
              }),
            );
          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          realmURL = response.body.data.id;
        }
        let initialJobs = await context.dbAdapter.execute('select * from jobs');
        assert.strictEqual(
          initialJobs.length,
          2,
          'number of jobs initially is correct',
        );
        {
          let response = await context.request2
            .get(`/_grafana-full-reindex?authHeader=${grafanaSecret}`)
            .set('Content-Type', 'application/json');
          assert.deepEqual(
            response.body.realms,
            [testRealm2URL.href, realmURL],
            'indexed realms are correct',
          );
        }
        let finalJobs = await context.dbAdapter.execute('select * from jobs');
        assert.strictEqual(
          finalJobs.length,
          3,
          'realm full reindex job was created',
        );
        let jobs = finalJobs.slice(2);
        assert.strictEqual(
          jobs[0].job_type,
          'full-reindex',
          'job type is correct',
        );
        assert.strictEqual(
          jobs[0].concurrency_group,
          `full-reindex-group`,
          'concurrency group is correct',
        );
      });

      test('returns 401 when calling grafana full reindex endpoint without a grafana secret', async function (assert) {
        let initialJobs = await context.dbAdapter.execute('select * from jobs');
        {
          let response = await context.request2
            .get(`/_grafana-full-reindex`)
            .set('Content-Type', 'application/json');
          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        }
        let finalJobs = await context.dbAdapter.execute('select * from jobs');
        assert.strictEqual(
          finalJobs.length,
          initialJobs.length,
          'an index job was not created',
        );
      });
    },
  );
});
