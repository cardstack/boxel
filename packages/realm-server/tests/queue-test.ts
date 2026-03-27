import { module, test } from 'qunit';
import { createTestPgAdapter, prepareTestDB } from './helpers';

import {
  PgAdapter,
  PgQueuePublisher,
  PgQueueRunner,
} from '@cardstack/postgres';

import type {
  QueueCoalesceContext,
  QueuePublisher,
  QueueRunner,
} from '@cardstack/runtime-common';
import {
  Deferred,
  registerQueueJobDefinition,
  userInitiatedPriority,
} from '@cardstack/runtime-common';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import {
  INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
  makeIncrementalArgsWithCallerMetadata,
  mapIncrementalDoneResult,
  type IncrementalIndexEnqueueArgs,
} from '@cardstack/runtime-common/jobs/indexing';
import {
  FROM_SCRATCH_JOB_TIMEOUT_SEC,
  type FromScratchArgs,
  type FromScratchResult,
  type IncrementalDoneResult,
} from '@cardstack/runtime-common/tasks/indexer';
import queueTests from '@cardstack/runtime-common/tests/queue-test';
import { basename } from 'path';

module(basename(__filename), function () {
  module('queue', function (hooks) {
    let publisher: QueuePublisher;
    let runner: QueueRunner;
    let adapter: PgAdapter;

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
      publisher = new PgQueuePublisher(adapter);
      runner = new PgQueueRunner({ adapter, workerId: 'q1', maxTimeoutSec: 2 });
      await runner.start();
    });

    hooks.afterEach(async function () {
      await runner.destroy();
      await publisher.destroy();
      await adapter.close();
    });

    async function publishFromScratchIndexJob(args: {
      args: FromScratchArgs;
      priority: number;
    }) {
      return await publisher.publish<FromScratchResult>({
        jobType: 'from-scratch-index',
        concurrencyGroup: `indexing:${args.args.realmURL}`,
        timeout: FROM_SCRATCH_JOB_TIMEOUT_SEC,
        priority: args.priority,
        args: args.args,
      });
    }

    async function publishIncrementalIndexJob(args: {
      args: IncrementalIndexEnqueueArgs;
      clientRequestId: string | null;
      priority?: number;
    }) {
      let priority = args.priority ?? userInitiatedPriority;
      return await publisher.publish<IncrementalDoneResult>({
        jobType: 'incremental-index',
        concurrencyGroup: `indexing:${args.args.realmURL}`,
        timeout: INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
        priority,
        args: makeIncrementalArgsWithCallerMetadata(
          args.args,
          args.clientRequestId,
        ),
        mapResult: mapIncrementalDoneResult(args.clientRequestId),
      });
    }

    test('it can run a job', async function (assert) {
      await runSharedTest(queueTests, assert, { runner, publisher });
    });

    test(`a job can throw an exception`, async function (assert) {
      await runSharedTest(queueTests, assert, { runner, publisher });
    });

    test('jobs are processed serially within a particular queue', async function (assert) {
      await runSharedTest(queueTests, assert, { runner, publisher });
    });

    test('coalesce can join pending jobs and map waiter-specific results', async function (assert) {
      await runSharedTest(queueTests, assert, { runner, publisher });
    });

    test('coalesce can join pending jobs and map waiter-specific rejected results', async function (assert) {
      await runSharedTest(queueTests, assert, { runner, publisher });
    });

    test('coalesce does not join pending jobs that already have an active reservation', async function (assert) {
      await runner.destroy();

      let existingJob = await publisher.publish<number>({
        jobType: 'reserved-candidate',
        concurrencyGroup: 'reserved-group',
        timeout: 30,
        args: 1,
      });

      await adapter.execute(
        `INSERT INTO job_reservations (job_id, locked_until, worker_id)
         VALUES ($1, NOW() + INTERVAL '30 seconds', 'test-worker')`,
        { bind: [existingJob.id] },
      );

      let seenCandidateIds: number[] | undefined;
      registerQueueJobDefinition({
        jobType: 'reserved-candidate',
        coalesce: ({ incoming, candidates }: QueueCoalesceContext) => {
          seenCandidateIds = candidates.map((candidate) => candidate.id);
          let candidate = candidates[0];
          if (!candidate) {
            return { type: 'insert', job: incoming } as const;
          }
          return { type: 'join', jobId: candidate.id } as const;
        },
      });
      let joinedJob = await publisher.publish<number>({
        jobType: 'reserved-candidate',
        concurrencyGroup: 'reserved-group',
        timeout: 30,
        args: 2,
      });

      assert.deepEqual(
        seenCandidateIds,
        [],
        'reserved pending job is excluded from coalesce candidates',
      );
      assert.notStrictEqual(
        joinedJob.id,
        existingJob.id,
        'coalesce inserts a new canonical job instead of joining reserved job',
      );
    });

    test('coalesce does not join a currently running job in same concurrency group', async function (assert) {
      let started = new Deferred<void>();
      let release = new Deferred<void>();
      runner.register('blocking-job', async (arg: number) => {
        started.fulfill();
        await release.promise;
        return arg;
      });

      let runningJob = await publisher.publish<number>({
        jobType: 'blocking-job',
        concurrencyGroup: 'running-group',
        timeout: 30,
        args: 1,
      });
      await started.promise;

      registerQueueJobDefinition({
        jobType: 'blocking-job',
        coalesce: ({ incoming, candidates }: QueueCoalesceContext) => {
          let candidate = candidates[0];
          if (!candidate) {
            return { type: 'insert', job: incoming } as const;
          }
          return { type: 'join', jobId: candidate.id } as const;
        },
      });
      let coalescedJob = await publisher.publish<number>({
        jobType: 'blocking-job',
        concurrencyGroup: 'running-group',
        timeout: 30,
        args: 2,
      });

      assert.notStrictEqual(
        coalescedJob.id,
        runningJob.id,
        'coalesce does not join currently running/reserved job',
      );

      release.fulfill();
      let [runningResult, coalescedResult] = await Promise.all([
        runningJob.done,
        coalescedJob.done,
      ]);
      assert.strictEqual(runningResult, 1, 'running job result preserved');
      assert.strictEqual(
        coalescedResult,
        2,
        'newly inserted coalesced job result preserved',
      );
    });

    test('concurrent coalesce attempts converge to one canonical pending job', async function (assert) {
      await runner.destroy();

      registerQueueJobDefinition({
        jobType: 'coalesce-target',
        coalesce: ({ incoming, candidates }: QueueCoalesceContext) => {
          let candidate = candidates[0];
          if (!candidate) {
            return { type: 'insert', job: incoming } as const;
          }
          return { type: 'join', jobId: candidate.id } as const;
        },
      });

      let jobs = await Promise.all(
        [...new Array(20)].map((_, index) =>
          publisher.publish<number>({
            jobType: 'coalesce-target',
            concurrencyGroup: 'coalesce-convergence-group',
            timeout: 30,
            args: index,
          }),
        ),
      );

      let uniqueJobIds = [...new Set(jobs.map((job) => job.id))];
      assert.strictEqual(
        uniqueJobIds.length,
        1,
        'all concurrent coalesce calls converge to one canonical job id',
      );

      let rows = (await adapter.execute(
        `SELECT id
         FROM jobs
         WHERE concurrency_group='coalesce-convergence-group'
           AND status='unfulfilled'`,
      )) as { id: number }[];
      assert.strictEqual(
        rows.length,
        1,
        'only one pending job row exists for the converged coalesce group',
      );
    });

    test('incremental coalesce merges mixed operations and persists per-caller metadata', async function (assert) {
      await runner.destroy();

      let realmURL = 'http://example.com/coalesced/';
      let first = await publishIncrementalIndexJob({
        clientRequestId: 'request-1',
        args: {
          realmURL,
          realmUsername: 'owner',
          ignoreData: {},
          changes: [
            { url: `${realmURL}a`, operation: 'update' },
            { url: `${realmURL}b`, operation: 'update' },
          ],
        },
      });
      let second = await publishIncrementalIndexJob({
        clientRequestId: 'request-2',
        args: {
          realmURL,
          realmUsername: 'owner',
          ignoreData: {},
          changes: [
            { url: `${realmURL}b`, operation: 'delete' },
            { url: `${realmURL}c`, operation: 'update' },
          ],
        },
      });

      assert.strictEqual(
        first.id,
        second.id,
        'incremental enqueues coalesce onto one canonical pending job',
      );

      let [row] = (await adapter.execute(
        `SELECT job_type, args
         FROM jobs
         WHERE id = $1`,
        { bind: [first.id] },
      )) as {
        job_type: string;
        args: {
          changes: { url: string; operation: 'update' | 'delete' }[];
          coalescedCallers: {
            waiterId: string;
            clientRequestId: string | null;
          }[];
        };
      }[];
      assert.strictEqual(row.job_type, 'incremental-index');

      let operationByUrl = new Map(
        row.args.changes.map((change) => [change.url, change.operation]),
      );
      assert.deepEqual(
        [...operationByUrl.entries()].sort((a, b) => a[0].localeCompare(b[0])),
        [
          [`${realmURL}a`, 'update'],
          [`${realmURL}b`, 'delete'],
          [`${realmURL}c`, 'update'],
        ],
        'changes are unioned and delete dominates update for duplicate URL',
      );
      assert.deepEqual(
        row.args.coalescedCallers
          .map((caller) => caller.clientRequestId)
          .sort(),
        ['request-1', 'request-2'],
        'canonical job args persist coalesced per-caller request metadata',
      );
    });

    test('from-scratch does not coalesce onto pending incremental in same group', async function (assert) {
      await runner.destroy();

      let realmURL = 'http://example.com/no-mixed-coalesce/';
      let incremental = await publishIncrementalIndexJob({
        clientRequestId: 'request-1',
        args: {
          realmURL,
          realmUsername: 'owner',
          ignoreData: {},
          changes: [{ url: `${realmURL}a`, operation: 'update' }],
        },
      });
      let fromScratch = await publishFromScratchIndexJob({
        priority: 123,
        args: {
          realmURL,
          realmUsername: 'owner',
        },
      });

      assert.notStrictEqual(
        fromScratch.id,
        incremental.id,
        'mixed job types do not share canonical rows',
      );

      let rows = (await adapter.execute(
        `SELECT job_type
         FROM jobs
         WHERE concurrency_group = $1
           AND status = 'unfulfilled'
         ORDER BY created_at, id`,
        { bind: [`indexing:${realmURL}`] },
      )) as { job_type: string }[];
      assert.deepEqual(
        rows.map((row) => row.job_type),
        ['incremental-index', 'from-scratch-index'],
        'both pending rows are retained when job types differ',
      );
    });

    test('coalesced incremental waiters each receive their own clientRequestId in done payload', async function (assert) {
      await runner.destroy();

      let realmURL = 'http://example.com/done-shape/';
      let first = await publishIncrementalIndexJob({
        clientRequestId: 'request-1',
        args: {
          realmURL,
          realmUsername: 'owner',
          ignoreData: {},
          changes: [{ url: `${realmURL}a`, operation: 'update' }],
        },
      });
      let second = await publishIncrementalIndexJob({
        clientRequestId: 'request-2',
        args: {
          realmURL,
          realmUsername: 'owner',
          ignoreData: {},
          changes: [{ url: `${realmURL}b`, operation: 'delete' }],
        },
      });

      let worker = new PgQueueRunner({ adapter, workerId: 'coalesce-worker' });
      try {
        worker.register(
          'incremental-index',
          async (args: { changes: { url: string }[] }) => ({
            invalidations: args.changes.map((change) => change.url),
            ignoreData: {},
            stats: {
              instancesIndexed: 0,
              filesIndexed: 0,
              instanceErrors: 0,
              fileErrors: 0,
              totalIndexEntries: 0,
            },
          }),
        );
        await worker.start();
        let [firstResult, secondResult] = await Promise.all([
          first.done,
          second.done,
        ]);

        assert.strictEqual(firstResult.clientRequestId, 'request-1');
        assert.strictEqual(secondResult.clientRequestId, 'request-2');
        assert.deepEqual(
          firstResult.invalidations.sort(),
          secondResult.invalidations.sort(),
          'coalesced waiters share canonical execution result payload',
        );
      } finally {
        await worker.destroy();
      }
    });

    test('incremental does not coalesce onto pending from-scratch in same group', async function (assert) {
      await runner.destroy();

      let realmURL = 'http://example.com/no-mixed-coalesce-reverse/';
      let fromScratch = await publishFromScratchIndexJob({
        priority: 123,
        args: {
          realmURL,
          realmUsername: 'owner',
        },
      });
      let incremental = await publishIncrementalIndexJob({
        clientRequestId: 'request-1',
        args: {
          realmURL,
          realmUsername: 'owner',
          ignoreData: {},
          changes: [{ url: `${realmURL}a`, operation: 'update' }],
        },
      });

      assert.notStrictEqual(
        incremental.id,
        fromScratch.id,
        'mixed job types do not share canonical rows regardless of enqueue order',
      );

      let rows = (await adapter.execute(
        `SELECT job_type
         FROM jobs
         WHERE concurrency_group = $1
           AND status = 'unfulfilled'
         ORDER BY created_at, id`,
        { bind: [`indexing:${realmURL}`] },
      )) as { job_type: string }[];
      assert.deepEqual(
        rows.map((row) => row.job_type),
        ['from-scratch-index', 'incremental-index'],
        'both pending rows are retained when types differ (reverse enqueue order)',
      );
    });

    test('worker stops waiting for job after its been running longer than max time-out', async function (assert) {
      let events: string[] = [];
      let runs = 0;
      let logJob = async () => {
        let me = runs;
        events.push(`job${me} start`);
        if (runs++ === 0) {
          await new Promise((r) => setTimeout(r, 3000));
        }
        events.push(`job${me} finish`);
        return me;
      };

      runner.register('logJob', logJob);

      let job = await publisher.publish({
        jobType: 'logJob',
        concurrencyGroup: 'log-group',
        timeout: 1,
        args: null,
      });

      try {
        await job.done;
        throw new Error(`expected timeout to be thrown`);
      } catch (error: any) {
        assert.strictEqual(
          error.message,
          'Timed-out after 2s waiting for job 1 to complete',
        );
      }
    });

    // Concurrency control using different queues is only supported in pg-queue,
    // so these are not tests that are shared with the browser queue implementation.
    module('multiple queue clients', function (nestedHooks) {
      let runner2: QueueRunner;
      let adapter2: PgAdapter;
      nestedHooks.beforeEach(async function () {
        adapter2 = new PgAdapter();
        runner2 = new PgQueueRunner({ adapter: adapter2, workerId: 'q2' });
        await runner2.start();

        // Because we need tight timing control for this test, ensure both
        // adapters have active DB connections before measuring behavior.
        await adapter.execute('select 1');
        await adapter2.execute('select 1');
      });

      nestedHooks.afterEach(async function () {
        await runner2.destroy();
        await adapter2.close();
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

        let promiseForJob1 = publisher.publish({
          jobType: 'logJob',
          concurrencyGroup: 'log-group',
          timeout: 5000,
          args: 1,
        });
        // start the 2nd job before the first job finishes
        await new Promise((r) => setTimeout(r, 100));
        let promiseForJob2 = publisher.publish({
          jobType: 'logJob',
          concurrencyGroup: 'other-group',
          timeout: 5000,
          args: 2,
        });
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

        let promiseForJob1 = publisher.publish({
          jobType: 'logJob',
          concurrencyGroup: 'log-group',
          timeout: 5000,
          args: 1,
        });
        // start the 2nd job before the first job finishes
        await new Promise((r) => setTimeout(r, 100));
        let promiseForJob2 = publisher.publish({
          jobType: 'logJob',
          concurrencyGroup: 'log-group',
          timeout: 5000,
          args: 2,
        });
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

        let job = await publisher.publish({
          jobType: 'logJob',
          concurrencyGroup: 'log-group',
          timeout: 1,
          args: null,
        });

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

  module('queue - high priority worker', function (hooks) {
    let publisher: QueuePublisher;
    let runner: QueueRunner;
    let adapter: PgAdapter;

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
      publisher = new PgQueuePublisher(adapter);
      runner = new PgQueueRunner({
        adapter,
        workerId: 'q1',
        maxTimeoutSec: 1,
        priority: 10,
      });
      await runner.start();
    });

    hooks.afterEach(async function () {
      await runner.destroy();
      await publisher.destroy();
      await adapter.close();
    });

    test('worker can be set to only process jobs greater or equal to a particular priority', async function (assert) {
      let events: string[] = [];
      let logJob = async ({ name }: { name: string }) => {
        events.push(name);
      };
      runner.register('logJob', logJob);

      let lowPriorityJob = await publisher.publish({
        jobType: 'logJob',
        concurrencyGroup: null,
        timeout: 1,
        args: { name: 'low priority' },
        priority: 0,
      });
      let highPriorityJob1 = await publisher.publish({
        jobType: 'logJob',
        concurrencyGroup: 'logGroup',
        timeout: 1,
        args: { name: 'high priority 1' },
        priority: 10,
      });
      let highPriorityJob2 = await publisher.publish({
        jobType: 'logJob',
        concurrencyGroup: 'logGroup',
        timeout: 1,
        args: { name: 'high priority 2' },
        priority: 11,
      });

      await highPriorityJob1.done;
      await highPriorityJob2.done;
      await Promise.race([
        lowPriorityJob.done,
        // the low priority job will never get picked up, so we race it against a timeout
        new Promise((r) => setTimeout(r, 2)),
      ]);

      assert.deepEqual(
        events.sort(),
        ['high priority 1', 'high priority 2'],
        'only the high priority jobs were processed',
      );
    });
  });

  module(
    'queue - high priority worker and all priority worker',
    function (hooks) {
      let publisher: QueuePublisher;
      let allPriorityRunner: QueueRunner;
      let highPriorityRunner: QueueRunner;
      let adapter: PgAdapter;
      let adapter2: PgAdapter;

      hooks.beforeEach(async function () {
        prepareTestDB();
        adapter = await createTestPgAdapter();
        adapter2 = new PgAdapter();
        publisher = new PgQueuePublisher(adapter);
        allPriorityRunner = new PgQueueRunner({
          adapter,
          workerId: 'q1',
          maxTimeoutSec: 1,
          priority: 0,
        });
        highPriorityRunner = new PgQueueRunner({
          adapter: adapter2,
          workerId: 'hp1',
          priority: 100,
        });
        await allPriorityRunner.start();
        await highPriorityRunner.start();

        // Because we need tight timing control for this test, ensure both
        // adapters have active DB connections before measuring behavior.
        await adapter.execute('select 1');
        await adapter2.execute('select 1');
      });

      hooks.afterEach(async function () {
        await allPriorityRunner.destroy();
        await highPriorityRunner.destroy();
        await publisher.destroy();
        await adapter.close();
        await adapter2.close();
      });

      test('concurrency group enforces concurrency against running jobs', async function (assert) {
        // Emulate realm server start up with full indexing competing with
        // incremental indexing. make slow jobs with low priority so the
        // concurrency group we are testing is waiting on a low priority worker.
        // make another job with high priority worker that runs while the low
        // priority job with same concurrency group is still waiting.

        let events: string[] = [];

        let slowLogJob = async (jobNum: number) => {
          events.push(`job${jobNum} start`);
          await new Promise((r) => setTimeout(r, 500));
          events.push(`job${jobNum} finish`);
        };
        let fastLogJob = async (jobNum: number) => {
          events.push(`job${jobNum} start`);
          await new Promise((r) => setTimeout(r, 10));
          events.push(`job${jobNum} finish`);
        };

        allPriorityRunner.register('slowLogJob', slowLogJob);
        allPriorityRunner.register('fastLogJob', fastLogJob);
        highPriorityRunner.register('fastLogJob', fastLogJob);

        let promiseForSlowJob1 = publisher.publish({
          jobType: 'slowLogJob',
          concurrencyGroup: 'other-group',
          timeout: 5000,
          priority: 0,
          args: 1,
        });
        // start the 2nd slow job before the first job finishes
        await new Promise((r) => setTimeout(r, 100));
        let promiseForSlowJob2 = publisher.publish({
          jobType: 'slowLogJob',
          concurrencyGroup: 'log-group', // same concurrency group as the fast job
          timeout: 5000,
          priority: 0,
          args: 2,
        });
        // start the fast job after the 2nd slow job is published but before the
        // first job finishes
        await new Promise((r) => setTimeout(r, 100));
        let promiseForFastJob3 = publisher.publish({
          jobType: 'fastLogJob',
          concurrencyGroup: 'log-group', // same concurrency group as the waiting slow job
          timeout: 5000,
          priority: 100, // this is a high priority job so it should be picked up by the idle high priority runner immediately
          args: 3,
        });

        let [slowJob1, slowJob2, fastJob3] = await Promise.all([
          promiseForSlowJob1,
          promiseForSlowJob2,
          promiseForFastJob3,
        ]);
        await Promise.all([slowJob1.done, slowJob2.done, fastJob3.done]);

        assert.deepEqual(events, [
          'job1 start',
          // job 3 is a high priority job and it should not be blocked because
          // job 2 is waiting--concurrency group is based on running jobs not
          // waiting jobs
          'job3 start',
          'job3 finish',
          'job1 finish',
          'job2 start',
          'job2 finish',
        ]);
      });
    },
  );
});
