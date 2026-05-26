import { module, test } from 'qunit';
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import sinon from 'sinon';
import { PgAdapter, PgQueueRunner } from '@cardstack/postgres';
import { sumUpCreditsLedger } from '@cardstack/billing/billing-queries';
import * as boxelUIChangeChecker from '../../lib/boxel-ui-change-checker';
import { fetchRealmPermissions } from '@cardstack/runtime-common';
import {
  grafanaSecret,
  insertUser,
  matrixRegistrationSecret,
  matrixURL,
  realmSecretSeed,
} from '../helpers';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import {
  adminImpersonateUser,
  appendRealmToUserAccountData,
  loginAsMatrixAdmin,
  registerUser,
} from '../../synapse';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '@cardstack/runtime-common';
import { setupServerEndpointsTest, testRealmURL } from './helpers';
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
          '{"realmURL": "${testRealmURL.href}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          'indexing:${testRealmURL.href}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        let response = await context.request
          .post(`/_grafana-complete-job?job_id=${id}`)
          .set('Authorization', `Bearer ${grafanaSecret}`)
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

      test('grafana endpoint can target both pending and running jobs by job_id', async function (assert) {
        let [{ id: pendingJobId }] = (await context.dbAdapter
          .execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealmURL.href}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          'indexing:${testRealmURL.href}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        let [{ id: runningJobId }] = (await context.dbAdapter
          .execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealmURL.href}", "realmUsername":"node-test_realm"}',
          'incremental-index',
          'indexing:${testRealmURL.href}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        await context.dbAdapter.execute(`INSERT INTO job_reservations
        (job_id, locked_until ) VALUES (${runningJobId}, NOW() + INTERVAL '3 minutes')`);

        let pendingResponse = await context.request
          .post(`/_grafana-complete-job?job_id=${pendingJobId}`)
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(
          pendingResponse.status,
          204,
          'pending job cancel returns 204',
        );

        let runningResponse = await context.request
          .post(`/_grafana-complete-job?job_id=${runningJobId}`)
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(
          runningResponse.status,
          204,
          'running job cancel returns 204',
        );

        let [pendingJob] = await context.dbAdapter.execute(
          `SELECT status, result FROM jobs WHERE id = ${pendingJobId}`,
        );
        assert.strictEqual(
          pendingJob.status,
          'rejected',
          'pending job canceled',
        );
        assert.deepEqual(
          pendingJob.result,
          {
            status: 418,
            message: 'User initiated job cancellation',
          },
          'pending job has cancellation payload',
        );

        let [runningJob] = await context.dbAdapter.execute(
          `SELECT status, result FROM jobs WHERE id = ${runningJobId}`,
        );
        assert.strictEqual(
          runningJob.status,
          'rejected',
          'running job canceled',
        );
        assert.deepEqual(
          runningJob.result,
          {
            status: 418,
            message: 'User initiated job cancellation',
          },
          'running job has cancellation payload',
        );
      });

      test('can force job completion by reservation_id via grafana endpoint', async function (assert) {
        let [{ id: jobId }] = (await context.dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealmURL.href}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          'indexing:${testRealmURL.href}',
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
        let response = await context.request
          .post(`/_grafana-complete-job?reservation_id=${reservationId}`)
          .set('Authorization', `Bearer ${grafanaSecret}`)
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
          '{"realmURL": "${testRealmURL.href}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          'indexing:${testRealmURL.href}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        await context.dbAdapter.execute(`INSERT INTO job_reservations
        (job_id, locked_until ) VALUES (${jobId}, NOW() + INTERVAL '3 minutes')`);
        await context.dbAdapter.execute(`INSERT INTO job_reservations
        (job_id, locked_until ) VALUES (${jobId}, NOW() + INTERVAL '2 minutes')`);
        let response = await context.request
          .post(`/_grafana-complete-job?job_id=${jobId}`)
          .set('Authorization', `Bearer ${grafanaSecret}`)
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

        let response = await context.request
          .post(`/_grafana-complete-job?reservation_id=${reservationId}`)
          .set('Authorization', `Bearer ${grafanaSecret}`)
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
          '{"realmURL": "${testRealmURL.href}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          'indexing:${testRealmURL.href}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        let response = await context.request
          .post(`/_grafana-complete-job?job_id=${id}`)
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

      // Grafana operator endpoints: POST-only, `Authorization: Bearer
      // <secret>` only. Bearer parsing follows RFC 6750 — scheme name is
      // case-insensitive, any 1+ whitespace separator is allowed.
      async function insertCancellableJob(): Promise<string> {
        let [{ id }] = (await context.dbAdapter.execute(`INSERT INTO jobs
        (args, job_type, concurrency_group, timeout, priority)
        VALUES
        (
          '{"realmURL": "${testRealmURL.href}", "realmUsername":"node-test_realm"}',
          'from-scratch-index',
          'indexing:${testRealmURL.href}',
          180,
          0
        ) RETURNING id`)) as { id: string }[];
        return id;
      }
      async function assertJobRejected(assert: Assert, id: string) {
        let [job] = await context.dbAdapter.execute(
          `SELECT status FROM jobs WHERE id = ${id}`,
        );
        assert.strictEqual(job.status, 'rejected', 'job was rejected');
      }

      test('grafana endpoint accepts POST with Authorization: Bearer header', async function (assert) {
        let id = await insertCancellableJob();
        let response = await context.request
          .post(`/_grafana-complete-job?job_id=${id}`)
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 204, 'HTTP 204 response');
        await assertJobRejected(assert, id);
      });

      test('grafana endpoint rejects POST with bare-secret Authorization header (no Bearer prefix)', async function (assert) {
        let id = await insertCancellableJob();
        let response = await context.request
          .post(`/_grafana-complete-job?job_id=${id}`)
          .set('Authorization', grafanaSecret)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
        let [job] = await context.dbAdapter.execute(
          `SELECT status FROM jobs WHERE id = ${id}`,
        );
        assert.strictEqual(
          job.status,
          'unfulfilled',
          'job not touched on auth failure',
        );
      });

      test('grafana endpoint rejects GET (POST-only routing)', async function (assert) {
        let id = await insertCancellableJob();
        let response = await context.request
          .get(`/_grafana-complete-job?job_id=${id}`)
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 404, 'HTTP 404 status');
        let [job] = await context.dbAdapter.execute(
          `SELECT status FROM jobs WHERE id = ${id}`,
        );
        assert.strictEqual(
          job.status,
          'unfulfilled',
          'job not touched on missing route',
        );
      });

      test('grafana endpoint rejects POST with wrong Bearer token', async function (assert) {
        let id = await insertCancellableJob();
        let response = await context.request
          .post(`/_grafana-complete-job?job_id=${id}`)
          .set('Authorization', 'Bearer not-the-real-secret')
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
        assert.true(
          response.text.includes('Token invalid'),
          'reports invalid token (not missing-header) when an Authorization header is present but wrong',
        );
        let [job] = await context.dbAdapter.execute(
          `SELECT status FROM jobs WHERE id = ${id}`,
        );
        assert.strictEqual(
          job.status,
          'unfulfilled',
          'job not touched on auth failure',
        );
      });

      test('grafana endpoint accepts lowercase scheme + extra whitespace in Bearer header', async function (assert) {
        let id = await insertCancellableJob();
        let response = await context.request
          .post(`/_grafana-complete-job?job_id=${id}`)
          .set('Authorization', `  bearer   ${grafanaSecret}  `)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 204, 'HTTP 204 response');
        await assertJobRejected(assert, id);
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

        let response = await context.request
          .post(`/_grafana-add-credit?user=${user.matrixUserId}&credit=1000`)
          .set('Authorization', `Bearer ${grafanaSecret}`)
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
        let response = await context.request
          .post(`/_grafana-add-credit?credit=1000`)
          .set('Authorization', `Bearer ${grafanaSecret}`)
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
        let response = await context.request
          .post(
            `/_grafana-add-credit?user=${user.matrixUserId}&credit=a+million+dollars`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let sum = await sumUpCreditsLedger(context.dbAdapter, {
          creditType: ['extra_credit', 'extra_credit_used'],
          userId: user.id,
        });
        assert.strictEqual(sum, 0, `user has 0 extra credit`);
      });

      test("returns 400 when calling grafana add credit endpoint when user doesn't exist", async function (assert) {
        let response = await context.request
          .post(`/_grafana-add-credit?user=nobody&credit=1000`)
          .set('Authorization', `Bearer ${grafanaSecret}`)
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
        let response = await context.request
          .post(`/_grafana-add-credit?user=${user.matrixUserId}&credit=1000`)
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
          let response = await context.request
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
          assert.strictEqual(response.status, 202, 'HTTP 202 status');
          realmURL = response.body.data.id;
        }
        let initialJobs = await context.dbAdapter.execute('select * from jobs');
        assert.strictEqual(
          initialJobs.length,
          2,
          'number of jobs initially is correct',
        );
        let staleModuleForTargetRealmURL = `${realmURL}stale-module-${uuidv4()}.gts`;
        let staleModuleForOtherRealmURL = `${testRealmURL.href}stale-module-${uuidv4()}.gts`;
        await context.dbAdapter.execute(
          `INSERT INTO modules (url, file_alias, definitions, deps, created_at, resolved_realm_url, cache_scope, auth_user_id)
           VALUES ('${staleModuleForTargetRealmURL}', '${staleModuleForTargetRealmURL}', '{}', '[]', ${Date.now()}, '${realmURL}', 'public', '')`,
        );
        await context.dbAdapter.execute(
          `INSERT INTO modules (url, file_alias, definitions, deps, created_at, resolved_realm_url, cache_scope, auth_user_id)
           VALUES ('${staleModuleForOtherRealmURL}', '${staleModuleForOtherRealmURL}', '{}', '[]', ${Date.now()}, '${testRealmURL.href}', 'public', '')`,
        );
        let seededTargetRowsBefore = await context.dbAdapter.execute(
          `SELECT * FROM modules WHERE url = '${staleModuleForTargetRealmURL}'`,
        );
        let seededOtherRowsBefore = await context.dbAdapter.execute(
          `SELECT * FROM modules WHERE url = '${staleModuleForOtherRealmURL}'`,
        );
        assert.strictEqual(
          seededTargetRowsBefore.length,
          1,
          'stale target realm module row was seeded',
        );
        assert.strictEqual(
          seededOtherRowsBefore.length,
          1,
          'stale other realm module row was seeded',
        );
        {
          let realmPath = realmURL.substring(
            new URL(testRealmURL.origin).href.length,
          );
          let response = await context.request
            .post(`/_grafana-reindex?realm=${realmPath}`)
            .set('Authorization', `Bearer ${grafanaSecret}`)
            .set('Content-Type', 'application/json');
          assert.deepEqual(response.body, {
            fileErrors: 0,
            filesIndexed: 2,
            instanceErrors: 0,
            instancesIndexed: 2,
            totalIndexEntries: 4,
          });
        }
        let seededTargetRowsAfter = await context.dbAdapter.execute(
          `SELECT * FROM modules WHERE url = '${staleModuleForTargetRealmURL}'`,
        );
        let seededOtherRowsAfter = await context.dbAdapter.execute(
          `SELECT * FROM modules WHERE url = '${staleModuleForOtherRealmURL}'`,
        );
        assert.strictEqual(
          seededTargetRowsAfter.length,
          0,
          'realm reindex clears stale modules for the reindexed realm',
        );
        assert.strictEqual(
          seededOtherRowsAfter.length,
          1,
          'realm reindex keeps modules for other realms',
        );
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
            // The grafana reindex path passes clearLastModified: true so
            // every file in boxel_index re-renders even when its mtime
            // hasn't changed. Surfaced in args so the from-scratch
            // coalesce can refuse to attach this kind of publish to an
            // already-running same-realm from-scratch.
            clearLastModified: true,
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
          let response = await context.request
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
          assert.strictEqual(response.status, 202, 'HTTP 202 status');
          realmURL = response.body.data.id;
        }
        let initialJobs = await context.dbAdapter.execute('select * from jobs');
        {
          let response = await context.request
            .post(`/_grafana-reindex?realm=${encodeURIComponent(realmURL)}`)
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
        let response = await context.request
          .post('/_post-deployment')
          .set('Content-Type', 'application/json');

        assert.strictEqual(
          response.status,
          401,
          'HTTP 401 status for missing auth header',
        );
      });

      test('post-deployment endpoint rejects incorrect authorization', async function (assert: Assert) {
        let response = await context.request
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
        let registryOnlyRealmURL = `http://localhost:4201/registry-only-${uuidv4()}/`;

        try {
          await context.dbAdapter.execute(`INSERT INTO realm_registry
            (url, kind, disk_id, owner_username, pinned)
            VALUES
            (
              '${testRealmURL.href}',
              'source',
              'node-test/pre-mounted-${uuidv4()}',
              'node-test',
              false
            )
            ON CONFLICT (url) DO NOTHING`);
          await context.dbAdapter.execute(`INSERT INTO realm_registry
            (url, kind, disk_id, owner_username, pinned)
            VALUES
            (
              '${registryOnlyRealmURL}',
              'source',
              'owner/registry-only-${uuidv4()}',
              'owner',
              false
            )`);

          // Seed a modules row to verify it gets cleared
          await context.dbAdapter.execute(
            `INSERT INTO modules (url, file_alias, definitions, deps, created_at, resolved_realm_url, cache_scope, auth_user_id)
             VALUES ('http://example.com/test-module', 'http://example.com/test-module', '{}', '[]', ${Date.now()}, 'http://example.com/', 'public', '')`,
          );
          let modulesBefore = await context.dbAdapter.execute(
            'SELECT * FROM modules',
          );
          assert.ok(
            modulesBefore.length > 0,
            'modules table has rows before deployment',
          );

          let initialJobs =
            await context.dbAdapter.execute('select * from jobs');
          let initialJobCount = initialJobs.length;

          let response = await context.request
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

          let modulesAfter = await context.dbAdapter.execute(
            'SELECT * FROM modules',
          );
          assert.strictEqual(
            modulesAfter.length,
            0,
            'modules table is empty after deployment',
          );

          let finalJobs = await context.dbAdapter.execute('select * from jobs');
          assert.strictEqual(
            finalJobs.length,
            initialJobCount + 1,
            'a new full-reindex job was created when checksums differ',
          );

          let reindexJob = finalJobs.find(
            (job) => job.job_type === 'full-reindex',
          ) as
            | {
                job_type: string;
                concurrency_group: string;
                timeout: number;
                args: { realmUrls: string[] };
              }
            | undefined;
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
            assert.ok(
              reindexJob.args.realmUrls.includes(registryOnlyRealmURL),
              'job args include registry-only realm URLs',
            );
            assert.ok(
              reindexJob.args.realmUrls.includes(testRealmURL.href),
              'job args still include mounted realms',
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

      test('post-deployment endpoint clears modules cache even when checksums match', async function (assert: Assert) {
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
          // Seed a modules row to verify it gets cleared even without reindex
          await context.dbAdapter.execute(
            `INSERT INTO modules (url, file_alias, definitions, deps, created_at, resolved_realm_url, cache_scope, auth_user_id)
             VALUES ('http://example.com/test-module', 'http://example.com/test-module', '{}', '[]', ${Date.now()}, 'http://example.com/', 'public', '')`,
          );
          let modulesBefore = await context.dbAdapter.execute(
            'SELECT * FROM modules',
          );
          assert.ok(
            modulesBefore.length > 0,
            'modules table has rows before deployment',
          );

          let initialJobs =
            await context.dbAdapter.execute('select * from jobs');
          let initialJobCount = initialJobs.length;

          let response = await context.request
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

          let modulesAfter = await context.dbAdapter.execute(
            'SELECT * FROM modules',
          );
          assert.strictEqual(
            modulesAfter.length,
            0,
            'modules table is empty after deployment even when checksums match',
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
        let registryOnlyRealmURL = `http://localhost:4201/registry-only-${uuidv4()}/`;
        {
          let response = await context.request
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
          assert.strictEqual(response.status, 202, 'HTTP 202 status');
          realmURL = response.body.data.id;
        }
        await context.dbAdapter.execute(`INSERT INTO realm_registry
          (url, kind, disk_id, owner_username, pinned)
          VALUES
          (
            '${testRealmURL.href}',
            'source',
            'node-test/pre-mounted-${uuidv4()}',
            'node-test',
            false
          )
          ON CONFLICT (url) DO NOTHING`);
        await context.dbAdapter.execute(`INSERT INTO realm_registry
          (url, kind, disk_id, owner_username, pinned)
          VALUES
          (
            '${registryOnlyRealmURL}',
            'source',
            'owner/registry-only-${uuidv4()}',
            'owner',
            false
          )`);
        let initialJobs = await context.dbAdapter.execute('select * from jobs');
        assert.strictEqual(
          initialJobs.length,
          2,
          'number of jobs initially is correct',
        );
        let staleModuleForRealmOneURL = `${testRealmURL.href}stale-module-${uuidv4()}.gts`;
        let staleModuleForRealmTwoURL = `${realmURL}stale-module-${uuidv4()}.gts`;
        await context.dbAdapter.execute(
          `INSERT INTO modules (url, file_alias, definitions, deps, created_at, resolved_realm_url, cache_scope, auth_user_id)
           VALUES ('${staleModuleForRealmOneURL}', '${staleModuleForRealmOneURL}', '{}', '[]', ${Date.now()}, '${testRealmURL.href}', 'public', '')`,
        );
        await context.dbAdapter.execute(
          `INSERT INTO modules (url, file_alias, definitions, deps, created_at, resolved_realm_url, cache_scope, auth_user_id)
           VALUES ('${staleModuleForRealmTwoURL}', '${staleModuleForRealmTwoURL}', '{}', '[]', ${Date.now()}, '${realmURL}', 'public', '')`,
        );
        let seededRowsBefore = await context.dbAdapter.execute(
          `SELECT * FROM modules WHERE url IN ('${staleModuleForRealmOneURL}', '${staleModuleForRealmTwoURL}')`,
        );
        assert.strictEqual(
          seededRowsBefore.length,
          2,
          'stale module rows were seeded before full reindex',
        );
        {
          let response = await context.request
            .post(`/_grafana-full-reindex`)
            .set('Authorization', `Bearer ${grafanaSecret}`)
            .set('Content-Type', 'application/json');
          assert.ok(
            response.body.realms.includes(registryOnlyRealmURL),
            'response includes registry-only realms',
          );
          assert.ok(
            response.body.realms.includes(testRealmURL.href),
            'response still includes existing mounted realms',
          );
          assert.ok(
            response.body.realms.includes(realmURL),
            'response includes newly created realms too',
          );
        }
        let seededRowsAfter = await context.dbAdapter.execute(
          `SELECT * FROM modules WHERE url IN ('${staleModuleForRealmOneURL}', '${staleModuleForRealmTwoURL}')`,
        );
        assert.strictEqual(
          seededRowsAfter.length,
          0,
          'full reindex clears stale module rows for all realms',
        );
        let finalJobs = await context.dbAdapter.execute('select * from jobs');
        assert.strictEqual(
          finalJobs.length,
          3,
          'realm full reindex job was created',
        );
        let jobs = finalJobs.slice(2) as {
          job_type: string;
          concurrency_group: string;
          args: { realmUrls: string[] };
        }[];
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
        assert.ok(
          jobs[0].args.realmUrls.includes(registryOnlyRealmURL),
          'job args include registry-only realms',
        );
        assert.ok(
          jobs[0].args.realmUrls.includes(testRealmURL.href),
          'job args still include existing mounted realms',
        );
        assert.ok(
          jobs[0].args.realmUrls.includes(realmURL),
          'job args include newly created realms too',
        );
      });

      test('full reindex clears all modules cache entries', async function (assert) {
        let endpoint = `test-realm-${uuidv4()}`;
        let owner = 'realm/bot';
        let ownerUserId = `@${owner}:localhost`;
        let botRealmURL: string;
        {
          let response = await context.request
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
                    name: 'Bot Realm',
                    endpoint,
                  },
                },
              }),
            );
          assert.strictEqual(response.status, 202, 'HTTP 202 status');
          botRealmURL = response.body.data.id;
        }

        let staleModuleForNonBotRealmURL = `${testRealmURL.href}stale-module-${uuidv4()}.gts`;
        let staleModuleForBotRealmURL = `${botRealmURL}stale-module-${uuidv4()}.gts`;
        await context.dbAdapter.execute(
          `INSERT INTO modules (url, file_alias, definitions, deps, created_at, resolved_realm_url, cache_scope, auth_user_id)
           VALUES ('${staleModuleForNonBotRealmURL}', '${staleModuleForNonBotRealmURL}', '{}', '[]', ${Date.now()}, '${testRealmURL.href}', 'public', '')`,
        );
        await context.dbAdapter.execute(
          `INSERT INTO modules (url, file_alias, definitions, deps, created_at, resolved_realm_url, cache_scope, auth_user_id)
           VALUES ('${staleModuleForBotRealmURL}', '${staleModuleForBotRealmURL}', '{}', '[]', ${Date.now()}, '${botRealmURL}', 'public', '')`,
        );

        let response = await context.request
          .post(`/_grafana-full-reindex`)
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');

        let staleRowsForNonBotRealm = await context.dbAdapter.execute(
          `SELECT * FROM modules WHERE url = '${staleModuleForNonBotRealmURL}'`,
        );
        let staleRowsForBotRealm = await context.dbAdapter.execute(
          `SELECT * FROM modules WHERE url = '${staleModuleForBotRealmURL}'`,
        );
        assert.strictEqual(
          staleRowsForNonBotRealm.length,
          0,
          'full reindex clears stale module rows for non-bot realms',
        );
        assert.strictEqual(
          staleRowsForBotRealm.length,
          0,
          'full reindex clears stale module rows for bot realms too',
        );
      });

      test('returns 401 when calling grafana full reindex endpoint without a grafana secret', async function (assert) {
        let initialJobs = await context.dbAdapter.execute('select * from jobs');
        {
          let response = await context.request
            .post(`/_grafana-full-reindex`)
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

      test('grants read-only via grafana upsert-realm-user-permission endpoint', async function (assert) {
        let user = '@op-test:localhost';
        let response = await context.request
          .post(
            `/_grafana-upsert-realm-user-permission` +
              `?realm=${encodeURIComponent(testRealmURL.href)}` +
              `&user=${encodeURIComponent(user)}` +
              `&read=true&write=false`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let perms = await fetchRealmPermissions(
          context.dbAdapter,
          testRealmURL,
        );
        assert.deepEqual(perms[user], ['read'], 'user has read only');
      });

      test('grants read+write via grafana upsert-realm-user-permission endpoint', async function (assert) {
        let user = '@op-test-rw:localhost';
        let response = await context.request
          .post(
            `/_grafana-upsert-realm-user-permission` +
              `?realm=${encodeURIComponent(testRealmURL.href)}` +
              `&user=${encodeURIComponent(user)}` +
              `&read=true&write=true`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let perms = await fetchRealmPermissions(
          context.dbAdapter,
          testRealmURL,
        );
        assert.deepEqual(
          perms[user].sort(),
          ['read', 'write'],
          'user has read+write',
        );
      });

      test('upserts: re-grant on the same user updates instead of duplicating', async function (assert) {
        let user = '@op-test-upsert:localhost';
        let url = (read: string, write: string) =>
          `/_grafana-upsert-realm-user-permission` +
          `?realm=${encodeURIComponent(testRealmURL.href)}` +
          `&user=${encodeURIComponent(user)}` +
          `&read=${read}&write=${write}`;
        // First call: read only.
        await context.request
          .post(url('true', 'false'))
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        // Second call: upgrade to read+write.
        let response = await context.request
          .post(url('true', 'true'))
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let perms = await fetchRealmPermissions(
          context.dbAdapter,
          testRealmURL,
        );
        assert.deepEqual(
          perms[user].sort(),
          ['read', 'write'],
          'second call replaced the first',
        );
      });

      test('normalises realm URL — trailing slash and stripped querystring/hash', async function (assert) {
        let user = '@op-test-normalize:localhost';
        // Pass a URL without trailing slash + with extraneous querystring +
        // fragment. Both should be normalised before insert so the row keys
        // exactly to the canonical realm root the runtime consults.
        let raw = testRealmURL.href.replace(/\/$/, '') + '?token=secret#frag';
        let response = await context.request
          .post(
            `/_grafana-upsert-realm-user-permission` +
              `?realm=${encodeURIComponent(raw)}` +
              `&user=${encodeURIComponent(user)}` +
              `&read=true&write=false`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.notOk(
          response.body.message?.includes('token=secret'),
          'response message does not echo the raw querystring',
        );
        let perms = await fetchRealmPermissions(
          context.dbAdapter,
          testRealmURL,
        );
        assert.deepEqual(
          perms[user],
          ['read'],
          'permission written under the canonical realm URL',
        );
      });

      test('rejects write-only (write requires read)', async function (assert) {
        let user = '@op-test-bad:localhost';
        let response = await context.request
          .post(
            `/_grafana-upsert-realm-user-permission` +
              `?realm=${encodeURIComponent(testRealmURL.href)}` +
              `&user=${encodeURIComponent(user)}` +
              `&read=false&write=true`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 400, 'HTTP 400 status');
      });

      test('rejects read=false write=false (use the delete flow to revoke)', async function (assert) {
        let user = '@op-test-revoke:localhost';
        let response = await context.request
          .post(
            `/_grafana-upsert-realm-user-permission` +
              `?realm=${encodeURIComponent(testRealmURL.href)}` +
              `&user=${encodeURIComponent(user)}` +
              `&read=false&write=false`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 400, 'HTTP 400 status');
      });

      test('rejects non-boolean read/write flags', async function (assert) {
        let response = await context.request
          .post(
            `/_grafana-upsert-realm-user-permission` +
              `?realm=${encodeURIComponent(testRealmURL.href)}` +
              `&user=${encodeURIComponent('@op-test:localhost')}` +
              `&read=TRUE&write=false`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 400, 'HTTP 400 status');
      });

      test('rejects missing realm param', async function (assert) {
        let response = await context.request
          .post(
            `/_grafana-upsert-realm-user-permission` +
              `?user=${encodeURIComponent('@op-test:localhost')}` +
              `&read=true&write=false`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 400, 'HTTP 400 status');
      });

      test('rejects non-URL realm param', async function (assert) {
        let response = await context.request
          .post(
            `/_grafana-upsert-realm-user-permission` +
              `?realm=not-a-url` +
              `&user=${encodeURIComponent('@op-test:localhost')}` +
              `&read=true&write=false`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 400, 'HTTP 400 status');
      });

      test('returns 401 without a grafana secret', async function (assert) {
        let response = await context.request
          .post(
            `/_grafana-upsert-realm-user-permission` +
              `?realm=${encodeURIComponent(testRealmURL.href)}` +
              `&user=${encodeURIComponent('@op-test:localhost')}` +
              `&read=true&write=false`,
          )
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('returns 404 on GET (POST-only routing)', async function (assert) {
        let response = await context.request
          .get(
            `/_grafana-upsert-realm-user-permission` +
              `?realm=${encodeURIComponent(testRealmURL.href)}` +
              `&user=${encodeURIComponent('@op-test:localhost')}` +
              `&read=true&write=false`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 404, 'HTTP 404 status');
      });

      test("grafana upsert syncs realm to granted user's app.boxel.realms account_data", async function (assert) {
        // Register a fresh matrix user so the admin-impersonate step
        // resolves and we own the entire pre/post account_data state for
        // this test (no carryover from other suites poking the same uid).
        let localpart = `grafana-grant-${uuidv4().slice(0, 8)}`;
        let userId = `@${localpart}:localhost`;
        await registerUser({
          matrixURL,
          displayname: localpart,
          username: localpart,
          password: 'password',
          registrationSecret: matrixRegistrationSecret,
        });

        let response = await context.request
          .post(
            `/_grafana-upsert-realm-user-permission` +
              `?realm=${encodeURIComponent(testRealmURL.href)}` +
              `&user=${encodeURIComponent(userId)}` +
              `&read=true&write=false`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.notOk(
          response.body.matrixAccountDataWarning,
          `no matrix warning: ${response.body.matrixAccountDataWarning}`,
        );
        assert.true(
          response.body.appendedToAccountData,
          'response signals a fresh append',
        );

        // Read the user's account_data back over matrix to confirm the
        // workspace list now contains the granted realm.
        let adminToken = await loginAsMatrixAdmin({
          matrixURL,
          adminUsername: 'admin',
          adminPassword: 'password',
        });
        let userToken = await adminImpersonateUser({
          matrixURL,
          adminAccessToken: adminToken,
          userId,
        });
        let accountDataResponse = await fetch(
          `${matrixURL.href}_matrix/client/v3/user/${encodeURIComponent(
            userId,
          )}/account_data/${APP_BOXEL_REALMS_EVENT_TYPE}`,
          { headers: { Authorization: `Bearer ${userToken}` } },
        );
        assert.strictEqual(
          accountDataResponse.status,
          200,
          'account_data row exists',
        );
        let body = (await accountDataResponse.json()) as { realms?: string[] };
        assert.deepEqual(
          body.realms,
          [testRealmURL.href],
          'realm appears in the user account_data',
        );
      });

      test('grafana upsert is idempotent on the account_data side', async function (assert) {
        let localpart = `grafana-grant-idem-${uuidv4().slice(0, 8)}`;
        let userId = `@${localpart}:localhost`;
        await registerUser({
          matrixURL,
          displayname: localpart,
          username: localpart,
          password: 'password',
          registrationSecret: matrixRegistrationSecret,
        });

        let firstResponse = await context.request
          .post(
            `/_grafana-upsert-realm-user-permission` +
              `?realm=${encodeURIComponent(testRealmURL.href)}` +
              `&user=${encodeURIComponent(userId)}` +
              `&read=true&write=false`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(firstResponse.status, 200, 'first call HTTP 200');
        assert.true(
          firstResponse.body.appendedToAccountData,
          'first call appends',
        );

        // Same user, same realm, second time — the realm should already
        // be in account_data and the handler should skip the PUT.
        let secondResponse = await context.request
          .post(
            `/_grafana-upsert-realm-user-permission` +
              `?realm=${encodeURIComponent(testRealmURL.href)}` +
              `&user=${encodeURIComponent(userId)}` +
              `&read=true&write=true`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(secondResponse.status, 200, 'second call HTTP 200');
        assert.false(
          secondResponse.body.appendedToAccountData,
          'second call does not re-append',
        );

        // And the account_data should still contain the realm exactly
        // once — no duplicate entry from the re-grant.
        let adminToken = await loginAsMatrixAdmin({
          matrixURL,
          adminUsername: 'admin',
          adminPassword: 'password',
        });
        let userToken = await adminImpersonateUser({
          matrixURL,
          adminAccessToken: adminToken,
          userId,
        });
        let accountDataResponse = await fetch(
          `${matrixURL.href}_matrix/client/v3/user/${encodeURIComponent(
            userId,
          )}/account_data/${APP_BOXEL_REALMS_EVENT_TYPE}`,
          { headers: { Authorization: `Bearer ${userToken}` } },
        );
        assert.strictEqual(
          accountDataResponse.status,
          200,
          'account_data GET returned 200',
        );
        let body = (await accountDataResponse.json()) as { realms?: string[] };
        assert.deepEqual(
          body.realms,
          [testRealmURL.href],
          'realm appears exactly once after two upserts',
        );
      });

      test('appendRealmToUserAccountData preserves prior entries', async function (assert) {
        // Direct exercise of the helper: pre-seed an unrelated realm in
        // a fresh user's account_data, then ensure the new realm is
        // appended without dropping or reordering existing entries.
        let localpart = `grafana-grant-preserve-${uuidv4().slice(0, 8)}`;
        let userId = `@${localpart}:localhost`;
        await registerUser({
          matrixURL,
          displayname: localpart,
          username: localpart,
          password: 'password',
          registrationSecret: matrixRegistrationSecret,
        });
        let priorRealm = 'http://other-realm.example/r/';

        let adminToken = await loginAsMatrixAdmin({
          matrixURL,
          adminUsername: 'admin',
          adminPassword: 'password',
        });
        let userToken = await adminImpersonateUser({
          matrixURL,
          adminAccessToken: adminToken,
          userId,
        });
        let seed = await fetch(
          `${matrixURL.href}_matrix/client/v3/user/${encodeURIComponent(
            userId,
          )}/account_data/${APP_BOXEL_REALMS_EVENT_TYPE}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${userToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ realms: [priorRealm] }),
          },
        );
        assert.strictEqual(seed.status, 200, 'seed PUT succeeded');

        let result = await appendRealmToUserAccountData({
          matrixURL,
          userId,
          userAccessToken: userToken,
          realmURL: testRealmURL.href,
        });
        assert.false(result.alreadyPresent, 'realm was not already present');

        let after = await fetch(
          `${matrixURL.href}_matrix/client/v3/user/${encodeURIComponent(
            userId,
          )}/account_data/${APP_BOXEL_REALMS_EVENT_TYPE}`,
          { headers: { Authorization: `Bearer ${userToken}` } },
        );
        assert.strictEqual(
          after.status,
          200,
          'account_data GET returned 200',
        );
        let body = (await after.json()) as { realms?: string[] };
        assert.deepEqual(
          body.realms,
          [priorRealm, testRealmURL.href],
          'new realm appended after prior entry',
        );
      });
    },
  );
});
