import { module, test } from 'qunit';
import { createTestPgAdapter, prepareTestDB } from './helpers/index.ts';

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

module(basename(import.meta.filename), function () {
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
      args: Omit<FromScratchArgs, 'clearLastModified'> & {
        clearLastModified?: boolean;
      };
      priority: number;
    }) {
      return await publisher.publish<FromScratchResult>({
        jobType: 'from-scratch-index',
        concurrencyGroup: `indexing:${args.args.realmURL}`,
        timeout: FROM_SCRATCH_JOB_TIMEOUT_SEC,
        priority: args.priority,
        args: { clearLastModified: false, ...args.args },
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

    test('from-scratch dedup: a duplicate publish for an in-flight from-scratch attaches as a late waiter', async function (assert) {
      // From-scratch reindex is the maximal indexing operation for a
      // realm: any same-realm from-scratch already running subsumes a
      // second concurrent from-scratch by definition. A worker
      // claiming the first publish before the second arrives must not
      // force a second canonical row, because the second caller's
      // result is already covered by what the in-flight job will
      // produce.
      await runner.destroy();
      let realmURL = 'http://example.com/from-scratch-in-flight-dedup/';
      let started = new Deferred<void>();
      let release = new Deferred<void>();

      let worker = new PgQueueRunner({
        adapter,
        workerId: 'from-scratch-in-flight-worker',
      });
      worker.register('from-scratch-index', async () => {
        started.fulfill();
        await release.promise;
        return {
          invalidations: [],
          ignoreData: {},
          stats: {
            instancesIndexed: 0,
            filesIndexed: 0,
            instanceErrors: 0,
            fileErrors: 0,
            totalIndexEntries: 0,
          },
        };
      });

      try {
        await worker.start();

        let first = await publishFromScratchIndexJob({
          priority: 0,
          args: {
            realmURL,
            realmUsername: 'owner',
          },
        });
        // Wait for the worker to actually claim the job — that moves
        // the row from `candidates` to `inFlightCandidates`, which is
        // the precondition for the pending-candidate path to miss and
        // the in-flight fallback to fire.
        await started.promise;

        let second = await publishFromScratchIndexJob({
          priority: userInitiatedPriority,
          args: {
            realmURL,
            realmUsername: 'owner',
          },
        });

        assert.strictEqual(
          first.id,
          second.id,
          'duplicate publish reuses the in-flight job id instead of creating a new row',
        );

        let rows = (await adapter.execute(
          `SELECT id
             FROM jobs
             WHERE concurrency_group = $1
               AND status = 'unfulfilled'`,
          { bind: [`indexing:${realmURL}`] },
        )) as { id: number }[];
        assert.strictEqual(
          rows.length,
          1,
          'only one from-scratch-index row exists; duplicate did not enqueue a second job',
        );

        release.fulfill();
        await Promise.all([first.done, second.done]);
      } finally {
        release.fulfill();
        await worker.destroy();
      }
    });

    test('from-scratch dedup: a clearLastModified publish does NOT attach to an in-flight from-scratch', async function (assert) {
      // A clearLastModified publish has already nulled
      // boxel_index.last_modified for the realm so the next from-scratch
      // pass re-renders every row. An already-running from-scratch read
      // its mtimes snapshot before that clear, so joining the running
      // job would let the caller observe a successful job that did NOT
      // re-render the swapped files (e.g. a publish-realm caller would
      // return ok despite never having indexed the new content).
      await runner.destroy();
      let realmURL = 'http://example.com/from-scratch-clear-last-modified/';
      let started = new Deferred<void>();
      let release = new Deferred<void>();

      let worker = new PgQueueRunner({
        adapter,
        workerId: 'from-scratch-clear-worker',
      });
      worker.register('from-scratch-index', async () => {
        started.fulfill();
        await release.promise;
        return {
          invalidations: [],
          ignoreData: {},
          stats: {
            instancesIndexed: 0,
            filesIndexed: 0,
            instanceErrors: 0,
            fileErrors: 0,
            totalIndexEntries: 0,
          },
        };
      });

      try {
        await worker.start();

        let first = await publishFromScratchIndexJob({
          priority: 0,
          args: { realmURL, realmUsername: 'owner' },
        });
        await started.promise;

        // Second publish flags clearLastModified — must not coalesce
        // onto the running first job.
        let second = await publishFromScratchIndexJob({
          priority: userInitiatedPriority,
          args: {
            realmURL,
            realmUsername: 'owner',
            clearLastModified: true,
          },
        });

        assert.notStrictEqual(
          first.id,
          second.id,
          'clearLastModified publish does not attach to the in-flight job',
        );

        let rows = (await adapter.execute(
          `SELECT id, status
             FROM jobs
             WHERE concurrency_group = $1
             ORDER BY id`,
          { bind: [`indexing:${realmURL}`] },
        )) as { id: number; status: string }[];
        assert.strictEqual(
          rows.length,
          2,
          'a fresh row is inserted for the clearLastModified publish',
        );

        release.fulfill();
        await Promise.all([first.done, second.done]);
      } finally {
        release.fulfill();
        await worker.destroy();
      }
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

    test('incremental dedup: a duplicate publish for an in-flight job attaches as a late waiter', async function (assert) {
      // Closes the staging-observed race where the PATCH-path enqueue
      // gets claimed by the worker before the file-watcher echo can
      // pre-claim coalesce. Without dedup, a second 'incremental-index'
      // row is inserted for the same change set and the worker runs the
      // same indexing pass twice. With dedup, the second publish reuses
      // the running job's id and registers a late waiter.
      await runner.destroy();
      let realmURL = 'http://example.com/in-flight-dedup-identical/';
      let started = new Deferred<void>();
      let release = new Deferred<void>();

      let worker = new PgQueueRunner({
        adapter,
        workerId: 'in-flight-dedup-worker',
      });
      worker.register(
        'incremental-index',
        async (args: { changes: { url: string }[] }) => {
          started.fulfill();
          await release.promise;
          return {
            invalidations: args.changes.map((change) => change.url),
            ignoreData: {},
            stats: {
              instancesIndexed: 0,
              filesIndexed: 0,
              instanceErrors: 0,
              fileErrors: 0,
              totalIndexEntries: 0,
            },
          };
        },
      );

      try {
        await worker.start();

        let first = await publishIncrementalIndexJob({
          clientRequestId: 'request-1',
          args: {
            realmURL,
            realmUsername: 'owner',
            ignoreData: {},
            changes: [{ url: `${realmURL}a`, operation: 'update' }],
          },
        });
        // Wait for the worker to actually claim and start running the
        // job before publishing the duplicate, otherwise we'd be testing
        // pre-claim coalesce instead.
        await started.promise;

        let second = await publishIncrementalIndexJob({
          clientRequestId: 'request-2',
          args: {
            realmURL,
            realmUsername: 'owner',
            ignoreData: {},
            changes: [{ url: `${realmURL}a`, operation: 'update' }],
          },
        });

        assert.strictEqual(
          first.id,
          second.id,
          'duplicate publish reuses the in-flight job id instead of creating a new row',
        );

        let rows = (await adapter.execute(
          `SELECT id
             FROM jobs
             WHERE concurrency_group = $1
               AND status = 'unfulfilled'`,
          { bind: [`indexing:${realmURL}`] },
        )) as { id: number }[];
        assert.strictEqual(
          rows.length,
          1,
          'only one incremental-index row exists; duplicate did not enqueue a second job',
        );

        release.fulfill();
        let [firstResult, secondResult] = await Promise.all([
          first.done,
          second.done,
        ]);
        assert.strictEqual(firstResult.clientRequestId, 'request-1');
        assert.strictEqual(secondResult.clientRequestId, 'request-2');
        assert.deepEqual(firstResult.invalidations, [`${realmURL}a`]);
        assert.deepEqual(secondResult.invalidations, [`${realmURL}a`]);
      } finally {
        release.fulfill();
        await worker.destroy();
      }
    });

    test('incremental dedup: an incoming subset of the in-flight change set attaches as a late waiter', async function (assert) {
      // Subset case: in-flight job is processing [a,b] and a new publish
      // arrives for just [a]. The running indexing pass already covers
      // url a, so the new caller can reuse it.
      await runner.destroy();
      let realmURL = 'http://example.com/in-flight-dedup-subset/';
      let started = new Deferred<void>();
      let release = new Deferred<void>();

      let worker = new PgQueueRunner({
        adapter,
        workerId: 'in-flight-dedup-subset-worker',
      });
      worker.register(
        'incremental-index',
        async (args: { changes: { url: string }[] }) => {
          started.fulfill();
          await release.promise;
          return {
            invalidations: args.changes.map((change) => change.url),
            ignoreData: {},
            stats: {
              instancesIndexed: 0,
              filesIndexed: 0,
              instanceErrors: 0,
              fileErrors: 0,
              totalIndexEntries: 0,
            },
          };
        },
      );

      try {
        await worker.start();

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
        await started.promise;

        let second = await publishIncrementalIndexJob({
          clientRequestId: 'request-2',
          args: {
            realmURL,
            realmUsername: 'owner',
            ignoreData: {},
            changes: [{ url: `${realmURL}a`, operation: 'update' }],
          },
        });

        assert.strictEqual(
          first.id,
          second.id,
          'subset publish reuses the in-flight job id',
        );

        let rows = (await adapter.execute(
          `SELECT id
             FROM jobs
             WHERE concurrency_group = $1
               AND status = 'unfulfilled'`,
          { bind: [`indexing:${realmURL}`] },
        )) as { id: number }[];
        assert.strictEqual(rows.length, 1);

        release.fulfill();
        let [firstResult, secondResult] = await Promise.all([
          first.done,
          second.done,
        ]);
        assert.strictEqual(firstResult.clientRequestId, 'request-1');
        assert.strictEqual(secondResult.clientRequestId, 'request-2');
      } finally {
        release.fulfill();
        await worker.destroy();
      }
    });

    test('incremental dedup: incoming with a non-covered url enqueues a new job', async function (assert) {
      // The running job is not a superset, so the late publish must
      // enqueue its own job. Otherwise the new url would never be
      // indexed.
      await runner.destroy();
      let realmURL = 'http://example.com/in-flight-dedup-different/';
      let started = new Deferred<void>();
      let release = new Deferred<void>();

      let invocations = 0;
      let worker = new PgQueueRunner({
        adapter,
        workerId: 'in-flight-dedup-diff-worker',
      });
      worker.register(
        'incremental-index',
        async (args: { changes: { url: string }[] }) => {
          invocations += 1;
          if (invocations === 1) {
            started.fulfill();
            await release.promise;
          }
          return {
            invalidations: args.changes.map((change) => change.url),
            ignoreData: {},
            stats: {
              instancesIndexed: 0,
              filesIndexed: 0,
              instanceErrors: 0,
              fileErrors: 0,
              totalIndexEntries: 0,
            },
          };
        },
      );

      try {
        await worker.start();

        let first = await publishIncrementalIndexJob({
          clientRequestId: 'request-1',
          args: {
            realmURL,
            realmUsername: 'owner',
            ignoreData: {},
            changes: [{ url: `${realmURL}a`, operation: 'update' }],
          },
        });
        await started.promise;

        let second = await publishIncrementalIndexJob({
          clientRequestId: 'request-2',
          args: {
            realmURL,
            realmUsername: 'owner',
            ignoreData: {},
            changes: [{ url: `${realmURL}b`, operation: 'update' }],
          },
        });

        assert.notStrictEqual(
          first.id,
          second.id,
          'non-covered publish does not attach to the in-flight job',
        );

        let rows = (await adapter.execute(
          `SELECT id, args
             FROM jobs
             WHERE concurrency_group = $1
               AND status = 'unfulfilled'
             ORDER BY id`,
          { bind: [`indexing:${realmURL}`] },
        )) as { id: number; args: { changes: { url: string }[] } }[];
        assert.strictEqual(
          rows.length,
          2,
          'two distinct rows exist when the in-flight changes do not cover the incoming changes',
        );
      } finally {
        release.fulfill();
        await worker.destroy();
      }
    });

    test('incremental dedup: operation mismatch enqueues a new job even when urls match', async function (assert) {
      // An in-flight `update` on url X does not satisfy a new `delete`
      // on the same X — they are different operations and must run as
      // separate work.
      await runner.destroy();
      let realmURL = 'http://example.com/in-flight-dedup-op-mismatch/';
      let started = new Deferred<void>();
      let release = new Deferred<void>();

      let invocations = 0;
      let worker = new PgQueueRunner({
        adapter,
        workerId: 'in-flight-dedup-op-worker',
      });
      worker.register(
        'incremental-index',
        async (args: { changes: { url: string }[] }) => {
          invocations += 1;
          if (invocations === 1) {
            started.fulfill();
            await release.promise;
          }
          return {
            invalidations: args.changes.map((change) => change.url),
            ignoreData: {},
            stats: {
              instancesIndexed: 0,
              filesIndexed: 0,
              instanceErrors: 0,
              fileErrors: 0,
              totalIndexEntries: 0,
            },
          };
        },
      );

      try {
        await worker.start();

        let first = await publishIncrementalIndexJob({
          clientRequestId: 'request-1',
          args: {
            realmURL,
            realmUsername: 'owner',
            ignoreData: {},
            changes: [{ url: `${realmURL}a`, operation: 'update' }],
          },
        });
        await started.promise;

        let second = await publishIncrementalIndexJob({
          clientRequestId: 'request-2',
          args: {
            realmURL,
            realmUsername: 'owner',
            ignoreData: {},
            changes: [{ url: `${realmURL}a`, operation: 'delete' }],
          },
        });

        assert.notStrictEqual(
          first.id,
          second.id,
          'operation mismatch publish does not attach to the in-flight job',
        );

        let rows = (await adapter.execute(
          `SELECT id
             FROM jobs
             WHERE concurrency_group = $1
               AND status = 'unfulfilled'`,
          { bind: [`indexing:${realmURL}`] },
        )) as { id: number }[];
        assert.strictEqual(rows.length, 2);
      } finally {
        release.fulfill();
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

    module(
      'cross-instance coalesce for index-related job types',
      function (nestedHooks) {
        let publisher2: QueuePublisher;
        let adapter2: PgAdapter;

        nestedHooks.beforeEach(async function () {
          // simulate a second realm-server instance: a separate PgAdapter +
          // PgQueuePublisher pointed at the same database
          adapter2 = new PgAdapter();
          publisher2 = new PgQueuePublisher(adapter2);

          // ensure both adapters have live DB connections so concurrent
          // publishes have realistic timing (mirrors the existing
          // 'multiple queue clients' setup pattern below)
          await adapter.execute('select 1');
          await adapter2.execute('select 1');

          // stop the runner so jobs queue up and we can inspect the canonical
          // pending row(s) before any worker dequeues them
          await runner.destroy();
        });

        nestedHooks.afterEach(async function () {
          await publisher2.destroy();
          await adapter2.close();
        });

        test('full-reindex: concurrent enqueues from two instances coalesce into one canonical pending job and union realmUrls', async function (assert) {
          let [first, second] = await Promise.all([
            publisher.publish<void>({
              jobType: 'full-reindex',
              concurrencyGroup: 'full-reindex-group',
              timeout: 6 * 60,
              priority: 0,
              args: { realmUrls: ['http://example.com/a/'] },
            }),
            publisher2.publish<void>({
              jobType: 'full-reindex',
              concurrencyGroup: 'full-reindex-group',
              timeout: 6 * 60,
              priority: 0,
              args: {
                realmUrls: ['http://example.com/a/', 'http://example.com/b/'],
              },
            }),
          ]);

          assert.strictEqual(
            first.id,
            second.id,
            'two instances enqueueing full-reindex converge to one canonical job',
          );

          let rows = (await adapter.execute(
            `SELECT id, args
             FROM jobs
             WHERE job_type = 'full-reindex' AND status = 'unfulfilled'`,
          )) as { id: number; args: { realmUrls: string[] } }[];
          assert.strictEqual(
            rows.length,
            1,
            'only one pending full-reindex row exists after cross-instance coalesce',
          );
          assert.deepEqual(
            rows[0].args.realmUrls.slice().sort(),
            ['http://example.com/a/', 'http://example.com/b/'],
            "canonical job args contain the union of both instances' realmUrls",
          );
        });

        test('copy-index: concurrent enqueues from two instances for same (destination, source) coalesce into one job', async function (assert) {
          let realmURL = 'http://example.com/copy-dest/';
          let sourceRealmURL = 'http://example.com/copy-src/';

          let [first, second] = await Promise.all([
            publisher.publish({
              jobType: 'copy-index',
              concurrencyGroup: `indexing:${realmURL}`,
              timeout: 4 * 60,
              priority: userInitiatedPriority,
              args: { realmURL, realmUsername: 'owner', sourceRealmURL },
            }),
            publisher2.publish({
              jobType: 'copy-index',
              concurrencyGroup: `indexing:${realmURL}`,
              timeout: 4 * 60,
              priority: userInitiatedPriority,
              args: { realmURL, realmUsername: 'owner', sourceRealmURL },
            }),
          ]);

          assert.strictEqual(
            first.id,
            second.id,
            'two instances enqueueing copy-index for same source+dest converge',
          );

          let rows = (await adapter.execute(
            `SELECT id
             FROM jobs
             WHERE job_type = 'copy-index' AND status = 'unfulfilled'`,
          )) as { id: number }[];
          assert.strictEqual(
            rows.length,
            1,
            'only one pending copy-index row exists',
          );
        });

        test('copy-index: enqueues with different sourceRealmURL stay as separate jobs', async function (assert) {
          let realmURL = 'http://example.com/copy-dest/';

          let first = await publisher.publish({
            jobType: 'copy-index',
            concurrencyGroup: `indexing:${realmURL}`,
            timeout: 4 * 60,
            priority: userInitiatedPriority,
            args: {
              realmURL,
              realmUsername: 'owner',
              sourceRealmURL: 'http://example.com/src-a/',
            },
          });
          let second = await publisher2.publish({
            jobType: 'copy-index',
            concurrencyGroup: `indexing:${realmURL}`,
            timeout: 4 * 60,
            priority: userInitiatedPriority,
            args: {
              realmURL,
              realmUsername: 'owner',
              sourceRealmURL: 'http://example.com/src-b/',
            },
          });

          assert.notStrictEqual(
            first.id,
            second.id,
            'different sourceRealmURL describes distinct work; rows are not coalesced',
          );

          let rows = (await adapter.execute(
            `SELECT id
             FROM jobs
             WHERE job_type = 'copy-index' AND status = 'unfulfilled'`,
          )) as { id: number }[];
          assert.strictEqual(
            rows.length,
            2,
            'both pending copy-index rows are retained when sources differ',
          );
        });
      },
    );

    test('abandons a job after the per-job reservation cap is hit', async function (assert) {
      // Simulates the staging stuck-job pattern: two prior workers each
      // claimed the job and died without finalizing the reservation. Both
      // reservations are expired (locked_until in the past) so the next
      // claim is eligible to grab the job — but the per-job reservation
      // count is already at the cap, so the runner abandons the job by
      // marking it 'rejected' with a diagnostic message. The handler
      // should never run.
      //
      // Destroy the beforeEach-spawned runner first so its 10s poller
      // can't race ahead of our DB seed and create a third reservation
      // before we've inserted the two orphans we want to test against.
      await runner.destroy();

      let [{ id: jobId }] = (await adapter.execute(
        `INSERT INTO jobs (job_type, args, status, timeout)
         VALUES ('logJob', '{}'::jsonb, 'unfulfilled', 1) RETURNING id`,
      )) as unknown as { id: number }[];

      for (let workerId of ['dead-worker-A', 'dead-worker-B']) {
        await adapter.execute(
          `INSERT INTO job_reservations (job_id, worker_id, locked_until)
           VALUES ($1, $2, NOW() - INTERVAL '10 seconds')`,
          { bind: [jobId, workerId] },
        );
      }

      let ranCount = 0;
      runner = new PgQueueRunner({
        adapter,
        workerId: 'q-abandon-cap',
        maxTimeoutSec: 2,
      });
      runner.register('logJob', async () => {
        ranCount++;
        return null;
      });
      await runner.start();
      // PgQueueRunner.start() returns before the internal `LISTEN jobs`
      // subscription is guaranteed established. Give it a beat so the
      // first NOTIFY isn't lost; otherwise the first wake would have to
      // wait for the 10s poll fallback and the 5s assertion loop below
      // could miss it intermittently.
      await new Promise((r) => setTimeout(r, 250));
      // Wake the runner so it picks the job up immediately rather than
      // waiting for the 10s poll interval.
      await adapter.execute(`NOTIFY jobs`);

      let started = Date.now();
      let abandoned = false;
      let result: { status?: number; message?: string } | null = null;
      while (Date.now() - started < 5000) {
        let rows = (await adapter.execute(`SELECT * FROM jobs WHERE id = $1`, {
          bind: [jobId],
        })) as unknown as {
          status: string;
          result: { status?: number; message?: string } | null;
        }[];
        if (rows[0].status === 'rejected') {
          abandoned = true;
          result = rows[0].result;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      assert.true(abandoned, 'job was abandoned within timeout window');
      let messageMentionsAbandon = Boolean(
        result?.message?.includes('abandoned after 2 failed attempts'),
      );
      assert.true(
        messageMentionsAbandon,
        `job.result.message reports the abandon, got: ${result?.message}`,
      );
      assert.strictEqual(ranCount, 0, 'handler was never invoked');

      // No new reservation row was inserted past the existing two.
      let [{ count }] = (await adapter.execute(
        `SELECT COUNT(*)::int as count FROM job_reservations WHERE job_id = $1`,
        { bind: [jobId] },
      )) as unknown as { count: number }[];
      assert.strictEqual(count, 2, 'no new reservation was created');
    });

    test('cap counts only completed and still-open reservations', async function (assert) {
      // Even with N+1 prior reservations on the job, ones that closed
      // with `completion_reason = 'interrupted'` (deploy/SIGTERM/child
      // crash) must NOT count toward the cap. Otherwise a deploy during
      // a slow reindex burns attempts on jobs that are otherwise fine.
      await runner.destroy();

      let [{ id: jobId }] = (await adapter.execute(
        `INSERT INTO jobs (job_type, args, status, timeout)
         VALUES ('logJob', '{}'::jsonb, 'unfulfilled', 1) RETURNING id`,
      )) as unknown as { id: number }[];

      // Three "interrupted" reservations — well past the cap of 2 — but
      // none of them count, so the job remains claimable.
      for (let workerId of [
        'sigterm-worker-A',
        'sigterm-worker-B',
        'sigterm-worker-C',
      ]) {
        await adapter.execute(
          `INSERT INTO job_reservations
            (job_id, worker_id, locked_until, completed_at, completion_reason)
           VALUES ($1, $2, NOW() - INTERVAL '10 seconds', NOW(), 'interrupted')`,
          { bind: [jobId, workerId] },
        );
      }

      let ranCount = 0;
      let ranDeferred = new Deferred<void>();
      runner = new PgQueueRunner({
        adapter,
        workerId: 'q-cap-ignores-interrupted',
        maxTimeoutSec: 2,
      });
      runner.register('logJob', async () => {
        ranCount++;
        ranDeferred.fulfill();
        return null;
      });
      await runner.start();
      // Same warm-up as the "abandons" test above — wait for LISTEN to
      // be established before NOTIFYing.
      await new Promise((r) => setTimeout(r, 250));
      await adapter.execute(`NOTIFY jobs`);

      await Promise.race([
        ranDeferred.promise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('handler never ran')), 5000),
        ),
      ]);

      assert.strictEqual(ranCount, 1, 'handler ran despite 3 prior interrupts');

      let job = (await adapter.execute(
        `SELECT status FROM jobs WHERE id = $1`,
        { bind: [jobId] },
      )) as unknown as { status: string }[];
      assert.strictEqual(
        job[0].status,
        'resolved',
        'job resolved cleanly — cap was not burned by the interrupted prior runs',
      );
    });

    test('cap is hit when prior reservations are explicitly completed', async function (assert) {
      // Same shape as the `abandons` test, but with `completion_reason`
      // explicitly set to 'completed'. This pins the new cap query down:
      // 'completed' rows count just like the legacy NULL-reason rows.
      await runner.destroy();

      let [{ id: jobId }] = (await adapter.execute(
        `INSERT INTO jobs (job_type, args, status, timeout)
         VALUES ('logJob', '{}'::jsonb, 'unfulfilled', 1) RETURNING id`,
      )) as unknown as { id: number }[];

      for (let workerId of ['completed-worker-A', 'completed-worker-B']) {
        await adapter.execute(
          `INSERT INTO job_reservations
            (job_id, worker_id, locked_until, completed_at, completion_reason)
           VALUES ($1, $2, NOW() - INTERVAL '10 seconds', NOW(), 'completed')`,
          { bind: [jobId, workerId] },
        );
      }

      let ranCount = 0;
      runner = new PgQueueRunner({
        adapter,
        workerId: 'q-cap-counts-completed',
        maxTimeoutSec: 2,
      });
      runner.register('logJob', async () => {
        ranCount++;
        return null;
      });
      await runner.start();
      await new Promise((r) => setTimeout(r, 250));
      await adapter.execute(`NOTIFY jobs`);

      let started = Date.now();
      let abandoned = false;
      while (Date.now() - started < 5000) {
        let rows = (await adapter.execute(`SELECT * FROM jobs WHERE id = $1`, {
          bind: [jobId],
        })) as unknown as { status: string }[];
        if (rows[0].status === 'rejected') {
          abandoned = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      assert.true(
        abandoned,
        'job abandoned with two prior `completed` reservations',
      );
      assert.strictEqual(ranCount, 0, 'handler never ran');
    });

    test('successful job marks its own reservation completed', async function (assert) {
      // Pins the pg-queue success path: when a worker finishes a job
      // (resolved or rejected by the handler), the reservation row is
      // closed with completion_reason = 'completed' so it counts toward
      // the cap on the next attempt. Without this stamp the cap-of-2
      // logic would treat the row as ambiguous (NULL, "still open").
      runner.register('logJob', async () => null);

      let job = await publisher.publish({
        jobType: 'logJob',
        concurrencyGroup: 'completion-reason-success',
        timeout: 5,
        args: null,
      });
      await job.done;

      let rows = (await adapter.execute(
        `SELECT completion_reason FROM job_reservations WHERE job_id = $1`,
        { bind: [job.id] },
      )) as unknown as { completion_reason: string | null }[];
      assert.strictEqual(rows.length, 1, 'one reservation row was created');
      assert.strictEqual(
        rows[0].completion_reason,
        'completed',
        'successful run records completion_reason = "completed"',
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

        // Await job1's publish so it is durably enqueued (and picked up by a
        // worker during the sleep below) before job2 is published — the
        // assertion below depends on job1 starting first.
        let job1 = await publisher.publish({
          jobType: 'logJob',
          concurrencyGroup: 'log-group',
          timeout: 5000,
          args: 1,
        });
        // start the 2nd job before the first job finishes
        await new Promise((r) => setTimeout(r, 100));
        let job2 = await publisher.publish({
          jobType: 'logJob',
          concurrencyGroup: 'other-group',
          timeout: 5000,
          args: 2,
        });

        await Promise.all([job1.done, job2.done]);
        assert.deepEqual(
          events,
          ['job1 start', 'job2 start', 'job1 finish', 'job2 finish'],
          `different-group jobs overlap; job1=${job1.id} job2=${job2.id}; ` +
            `events=${JSON.stringify(events)}`,
        );
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

        // Await each publish so job1 is durably enqueued (its created_at
        // fixed) before job2 is published. Workers dequeue by (created_at,
        // id); leaving the publishes unawaited let job1's INSERT race job2's
        // under load, so the two could share a created_at and run out of
        // enqueue order.
        let job1 = await publisher.publish({
          jobType: 'logJob',
          concurrencyGroup: 'log-group',
          timeout: 5000,
          args: 1,
        });
        // start the 2nd job before the first job finishes
        await new Promise((r) => setTimeout(r, 100));
        let job2 = await publisher.publish({
          jobType: 'logJob',
          concurrencyGroup: 'log-group',
          timeout: 5000,
          args: 2,
        });

        await Promise.all([job1.done, job2.done]);
        let enqueueOrder = await adapter.execute(
          `SELECT id, args, created_at FROM jobs WHERE id IN ($1, $2) ORDER BY created_at, id`,
          { bind: [job1.id, job2.id] },
        );
        assert.deepEqual(
          events,
          ['job1 start', 'job1 finish', 'job2 start', 'job2 finish'],
          `same-group jobs run in enqueue order; job1=${job1.id} job2=${job2.id}; ` +
            `persisted order=${JSON.stringify(enqueueOrder)}; events=${JSON.stringify(
              events,
            )}`,
        );
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
