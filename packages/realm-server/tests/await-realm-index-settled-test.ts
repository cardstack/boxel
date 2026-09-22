import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  awaitRealmIndexSettled,
  indexingConcurrencyGroup,
  outstandingIndexJobs,
  readLaneHoldersBestEffort,
  INDEX_WRITING_JOB_TYPES,
} from '@cardstack/runtime-common/jobs/indexing';
import {
  awaitPublishedHtmlReady,
  prerenderHtmlConcurrencyGroup,
} from '@cardstack/runtime-common/jobs/prerender-html';
import { setupDB } from './helpers/index.ts';

const realmURL = 'http://localhost:4201/test/';
const otherRealmURL = 'http://localhost:4201/other/';

// Insert a queue row into a realm's index lane. `status` defaults to
// 'unfulfilled', which is the state the gate is looking for.
async function enqueueIndexJob(
  dbAdapter: PgAdapter,
  url: string,
  status: 'unfulfilled' | 'resolved' | 'rejected' = 'unfulfilled',
  // Both extras are optional and neither is the common case, so they are named
  // rather than positional — a bare array or a bare string in fourth place
  // reads as neither at the call site.
  opts: {
    // Defaults to an index-writing member. Pass another to seed a job that
    // shares the lane for mutual exclusion without writing the index.
    jobType?: string;
    // The writers whose work the row carries. Omitted leaves the column null,
    // which is the untagged pass — a row from before the column existed, or one
    // no HTTP write produced.
    initiatedBy?: string[];
  } = {},
): Promise<number> {
  let [{ id }] = (await dbAdapter.execute(
    `INSERT INTO jobs (job_type, concurrency_group, timeout, priority, args, status, initiated_by)
       VALUES ($4, $1, 3600, 10, $2, $3, $5)
       RETURNING id`,
    {
      bind: [
        indexingConcurrencyGroup(url),
        JSON.stringify({ realmURL: url }),
        status,
        opts.jobType ?? 'from-scratch-index',
        opts.initiatedBy ? JSON.stringify(opts.initiatedBy) : null,
      ],
    },
  )) as { id: number }[];
  return id;
}

// A live reservation on a job — what pg-queue writes when a worker claims one,
// and what separates a job being worked from one waiting behind a backlog. An
// expired reservation is a dead attempt, which reads as waiting again.
async function claimJob(
  dbAdapter: PgAdapter,
  jobId: number,
  opts: { expired?: boolean } = {},
): Promise<void> {
  await dbAdapter.execute(
    `INSERT INTO job_reservations (job_id, locked_until, worker_id)
       VALUES ($1, NOW() + ($2 || ' minutes')::interval, 'test-worker')`,
    { bind: [jobId, opts.expired ? '-5' : '5'] },
  );
}

// A live `boxel_index` row at `generation`, or a tombstone / index-errored one.
// Sets only the columns the HTML gate reads.
async function insertIndexRow(
  dbAdapter: PgAdapter,
  realm: string,
  name: string,
  generation: number,
  opts?: { isDeleted?: boolean; hasError?: boolean },
): Promise<void> {
  await dbAdapter.execute(
    `INSERT INTO boxel_index
       (url, file_alias, realm_url, type, generation, is_deleted, has_error, error_doc)
     VALUES ($1, $2, $3, 'instance', $4, $5, $6, $7)`,
    {
      bind: [
        `${realm}${name}`,
        `${realm}${name}`,
        realm,
        generation,
        opts?.isDeleted ?? false,
        opts?.hasError ?? false,
        opts?.hasError ? JSON.stringify({ message: 'boom' }) : null,
      ],
    },
  );
}

// The matching `prerendered_html` row, whose `generation` the gate compares
// against the index row's own. A tombstone (`isDeleted`) carries no HTML,
// matching what `tombstonePrerenderedHtmlEntries` seeds.
async function insertHtmlRow(
  dbAdapter: PgAdapter,
  realm: string,
  name: string,
  generation: number,
  opts?: { isDeleted?: boolean },
): Promise<void> {
  await dbAdapter.execute(
    `INSERT INTO prerendered_html
       (url, file_alias, realm_url, type, generation, is_deleted, isolated_html)
     VALUES ($1, $2, $3, 'instance', $4, $5, $6)`,
    {
      bind: [
        `${realm}${name}`,
        `${realm}${name}`,
        realm,
        generation,
        opts?.isDeleted ?? false,
        opts?.isDeleted ? null : '<div>rendered</div>',
      ],
    },
  );
}

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;

  setupDB(hooks, {
    beforeEach: async (adapter) => {
      dbAdapter = adapter;
    },
  });

  module('awaitRealmIndexSettled', function () {
    test('a realm with nothing queued settles immediately', async function (assert) {
      assert.true(
        await awaitRealmIndexSettled(dbAdapter, realmURL, { timeoutMs: 200 }),
        'an empty lane is settled',
      );
    });

    test('an unfulfilled job in the lane holds the gate until the budget expires', async function (assert) {
      await enqueueIndexJob(dbAdapter, realmURL);
      assert.false(
        await awaitRealmIndexSettled(dbAdapter, realmURL, {
          timeoutMs: 200,
          pollIntervalMs: 50,
        }),
        'the gate reports unsettled rather than passing over queued index work',
      );
    });

    // The two tests above are what keep these from being vacuous: the same
    // job, in the same lane, holds the gate when nothing narrows it. So a
    // `jobTypes` that lets these pass is narrowing rather than just failing to
    // find the row.
    test('jobTypes narrows the lane to the types named', async function (assert) {
      await enqueueIndexJob(dbAdapter, realmURL);
      assert.true(
        await awaitRealmIndexSettled(dbAdapter, realmURL, {
          timeoutMs: 200,
          pollIntervalMs: 50,
          jobTypes: ['incremental-index'],
        }),
        'a from-scratch job does not hold a gate asking only about incremental work',
      );
    });

    // An empty list is a filter naming no job, not the absence of a filter.
    // The distinction is worth a test because the cheap spelling of the check
    // — a truthiness test on the array — collapses them, and it collapses them
    // in the expensive direction: a caller whose list came out empty would
    // wait on the realm's entire lane instead of proceeding, which is how a
    // conditional write ends up queued behind a full reindex.
    test('an empty jobTypes names no job and so settles at once', async function (assert) {
      await enqueueIndexJob(dbAdapter, realmURL);
      assert.true(
        await awaitRealmIndexSettled(dbAdapter, realmURL, {
          timeoutMs: 200,
          pollIntervalMs: 50,
          jobTypes: [],
        }),
        'the unfulfilled job is in the lane and still does not hold this gate',
      );
    });

    // Whether a job succeeded is not the question the gate answers — a rejected
    // job is finished, and holding readiness open for one would hang forever on
    // an index that is never coming. A failed index surfaces as errored content
    // instead.
    test('terminal jobs do not hold the gate', async function (assert) {
      await enqueueIndexJob(dbAdapter, realmURL, 'resolved');
      await enqueueIndexJob(dbAdapter, realmURL, 'rejected');
      assert.true(
        await awaitRealmIndexSettled(dbAdapter, realmURL, { timeoutMs: 200 }),
        'resolved and rejected rows leave the lane clear',
      );
    });

    test('the gate is scoped to one realm', async function (assert) {
      await enqueueIndexJob(dbAdapter, otherRealmURL);
      assert.true(
        await awaitRealmIndexSettled(dbAdapter, realmURL, { timeoutMs: 200 }),
        "another realm's queued index work does not hold this realm's gate",
      );
      assert.false(
        await awaitRealmIndexSettled(dbAdapter, otherRealmURL, {
          timeoutMs: 200,
          pollIntervalMs: 50,
        }),
        'that realm holds its own gate',
      );
    });

    // The lane is shared by work that must not overlap a running pass but does
    // not write the index — today the daily scoped-css GC, which enqueues one
    // job per realm. On a backed-up queue that leaves one sitting in every
    // realm's lane, and a gate reading the bare lane calls every one of those
    // realms mid-index for as long as it takes to drain.
    test('a queued job that does not write the index is excluded by narrowing', async function (assert) {
      await enqueueIndexJob(dbAdapter, realmURL, 'unfulfilled', {
        jobType: 'scoped-css-gc',
      });
      // Asserted first so a narrowing that quietly stopped matching anything
      // could not carry the test: the row has to be capable of holding a gate.
      assert.false(
        await awaitRealmIndexSettled(dbAdapter, realmURL, {
          timeoutMs: 200,
          pollIntervalMs: 50,
        }),
        'the bare lane still reads the job as outstanding',
      );
      assert.true(
        await awaitRealmIndexSettled(dbAdapter, realmURL, {
          timeoutMs: 200,
          jobTypes: INDEX_WRITING_JOB_TYPES,
        }),
        'narrowing to the index-writing types leaves the lane clear',
      );
    });

    // Ties the allow-list to behaviour rather than to its own spelling:
    // dropping a type from it turns this red instead of silently letting that
    // job type pass a readiness gate.
    test('every index-writing type holds the narrowed gate', async function (assert) {
      for (let jobType of INDEX_WRITING_JOB_TYPES) {
        let url = `http://localhost:4201/${jobType}/`;
        await enqueueIndexJob(dbAdapter, url, 'unfulfilled', { jobType });
        assert.false(
          await awaitRealmIndexSettled(dbAdapter, url, {
            timeoutMs: 200,
            pollIntervalMs: 50,
            jobTypes: INDEX_WRITING_JOB_TYPES,
          }),
          `a queued ${jobType} holds the gate`,
        );
      }
    });

    // Reading your own write matters; being made to read someone else's does
    // not. A writer that names itself waits for its own indexing and lets
    // every other writer's pass go by — serving another user a stale version
    // of the card you are updating is the intended behaviour, not a
    // compromise.
    module('scoped to one writer', function () {
      const writer = '@writer:localhost';
      const someoneElse = '@someone-else:localhost';
      const owner = '@owner:localhost';

      test("another writer's pass does not hold this writer", async function (assert) {
        await enqueueIndexJob(dbAdapter, realmURL, 'unfulfilled', {
          initiatedBy: [someoneElse],
        });
        assert.true(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            initiatedBy: { user: writer, realmOwner: owner },
          }),
          'the lane is occupied, but by work this writer has no stake in',
        );
        assert.false(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            pollIntervalMs: 50,
          }),
          'and a caller naming nobody still waits for the lane',
        );
      });

      test("a writer's own pass holds it", async function (assert) {
        await enqueueIndexJob(dbAdapter, realmURL, 'unfulfilled', {
          initiatedBy: [writer],
        });
        assert.false(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            pollIntervalMs: 50,
            initiatedBy: { user: writer, realmOwner: owner },
          }),
          'a pass indexing bytes this writer wrote is one it must wait for',
        );
      });

      // A pass carries every caller that merged into it, so a writer absorbed
      // into someone else's job is still waiting on its own bytes. Recording
      // only whoever got there first would let this writer past a pass that
      // has not indexed its write yet.
      test('a coalesced pass holds every writer it carries', async function (assert) {
        await enqueueIndexJob(dbAdapter, realmURL, 'unfulfilled', {
          initiatedBy: [someoneElse, writer],
        });
        assert.false(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            pollIntervalMs: 50,
            initiatedBy: { user: writer, realmOwner: owner },
          }),
          'the writer that merged in waits for the merged pass',
        );
        assert.false(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            pollIntervalMs: 50,
            initiatedBy: { user: someoneElse, realmOwner: owner },
          }),
          'and so does the one that started it',
        );
      });

      // A pass no HTTP write produced records nobody. Reading that as nobody's
      // would let every writer past work that may well be indexing their
      // bytes, so it reads as the realm owner instead: it gates somebody, and
      // the owner is the identity such a pass is closest to.
      test('an untagged pass gates the realm owner alone', async function (assert) {
        await enqueueIndexJob(dbAdapter, realmURL);
        assert.false(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            pollIntervalMs: 50,
            initiatedBy: { user: owner, realmOwner: owner },
          }),
          'the owner waits for a pass with no writer recorded',
        );
        assert.true(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            initiatedBy: { user: writer, realmOwner: owner },
          }),
          'and no other writer does',
        );
      });

      // The two scopes are independent conditions on one query, so a writer
      // whose own pass is of a type the caller did not ask about is still let
      // through.
      test('the writer scope composes with the job-type scope', async function (assert) {
        await enqueueIndexJob(dbAdapter, realmURL, 'unfulfilled', {
          initiatedBy: [writer],
        });
        assert.true(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            initiatedBy: { user: writer, realmOwner: owner },
            jobTypes: ['incremental-index'],
          }),
          'this writer has a pass in the lane, but not one of these types',
        );
        assert.false(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            pollIntervalMs: 50,
            initiatedBy: { user: writer, realmOwner: owner },
            jobTypes: ['from-scratch-index'],
          }),
          'and it does hold when the type is one the caller asked about',
        );
      });
    });

    // The prerender-html channel is a separate lane on purpose, gated
    // separately via awaitPrerenderHtml. Index readiness must not wait on it.
    test('the prerender-html lane does not hold the index gate', async function (assert) {
      await dbAdapter.execute(
        `INSERT INTO jobs (job_type, concurrency_group, timeout, priority, args)
           VALUES ('prerender_html', $1, 3600, 9, $2)`,
        {
          // Built from the helper, not a literal: this test's whole assertion
          // is that the two lanes are distinct, so a hardcoded name that drifted
          // from the real one would keep passing while proving nothing.
          bind: [
            prerenderHtmlConcurrencyGroup(realmURL),
            JSON.stringify({ realmURL }),
          ],
        },
      );
      assert.true(
        await awaitRealmIndexSettled(dbAdapter, realmURL, { timeoutMs: 200 }),
        'a queued prerender-html job leaves the index lane clear',
      );
    });

    // `jobs` exists only where there is a server-side queue. An adapter without
    // one answers settled without touching the table, so a caller that doesn't
    // know about the asymmetry gets the right answer rather than a
    // missing-table error. Stand in for such an adapter by flipping `kind` —
    // the query would still succeed against this database, so a fast-path
    // regression shows up as the unfulfilled row being noticed.
    test('an adapter with no job queue answers settled without querying', async function (assert) {
      await enqueueIndexJob(dbAdapter, realmURL);
      let queueless = Object.create(dbAdapter, {
        kind: { value: 'sqlite' },
      }) as PgAdapter;
      assert.true(
        await awaitRealmIndexSettled(queueless, realmURL, { timeoutMs: 200 }),
        'settled despite an unfulfilled row this adapter would never look for',
      );
      assert.false(
        await awaitRealmIndexSettled(dbAdapter, realmURL, {
          timeoutMs: 200,
          pollIntervalMs: 50,
        }),
        'the same row does hold the gate for a queue-backed adapter',
      );
    });

    test('the gate releases when the job leaves the lane', async function (assert) {
      let jobId = await enqueueIndexJob(dbAdapter, realmURL);

      let settled: boolean | undefined;
      let waiting = awaitRealmIndexSettled(dbAdapter, realmURL, {
        timeoutMs: 30_000,
        pollIntervalMs: 100,
      }).then((result) => {
        settled = result;
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.strictEqual(
        settled,
        undefined,
        'still waiting while the job is unfulfilled',
      );

      // Finish the row the way pg-queue does, NOTIFY included.
      await dbAdapter.execute(
        `UPDATE jobs SET status = 'resolved', finished_at = NOW(), result = '{}'::jsonb WHERE id = $1`,
        { bind: [jobId] },
      );
      await dbAdapter.execute(`NOTIFY jobs_finished`);

      await waiting;
      assert.true(settled, 'the gate releases once the lane drains');
    });
  });

  // The gate answers yes/no; this is what an operator reads when the answer was
  // no. A readiness 503 from a lane that never drained looks identical to one
  // from the in-process gates above it, so without the job ids there is nothing
  // in the log to tell an operator which gate held the realm.
  module('outstandingIndexJobs', function () {
    test('an empty lane reports nothing', async function (assert) {
      assert.deepEqual(
        await outstandingIndexJobs(dbAdapter, realmURL),
        [],
        'no jobs to name',
      );
    });

    test('names the unfulfilled jobs holding the lane, oldest first', async function (assert) {
      let first = await enqueueIndexJob(dbAdapter, realmURL);
      let second = await enqueueIndexJob(dbAdapter, realmURL, 'unfulfilled', {
        jobType: 'incremental-index',
      });
      assert.deepEqual(
        await outstandingIndexJobs(dbAdapter, realmURL),
        [
          { id: first, jobType: 'from-scratch-index', claimed: false },
          { id: second, jobType: 'incremental-index', claimed: false },
        ],
        'both jobs, in the order a worker will claim them',
      );
    });

    // The same three exclusions the gate makes, so the explanation cannot name
    // a job the gate was not waiting on.
    test('excludes terminal jobs, other realms and other lanes', async function (assert) {
      let held = await enqueueIndexJob(dbAdapter, realmURL);
      await enqueueIndexJob(dbAdapter, realmURL, 'resolved');
      await enqueueIndexJob(dbAdapter, realmURL, 'rejected');
      await enqueueIndexJob(dbAdapter, otherRealmURL);
      await dbAdapter.execute(
        `INSERT INTO jobs (job_type, concurrency_group, timeout, priority, args)
           VALUES ('prerender_html', $1, 3600, 9, $2)`,
        {
          bind: [
            prerenderHtmlConcurrencyGroup(realmURL),
            JSON.stringify({ realmURL }),
          ],
        },
      );
      assert.deepEqual(
        await outstandingIndexJobs(dbAdapter, realmURL),
        [{ id: held, jobType: 'from-scratch-index', claimed: false }],
        'only this realm’s unfulfilled index-lane job',
      );
    });

    // The gate short-circuits an empty list before it builds a query, so this
    // is the only path that reaches the shared filter with one. Absent and
    // empty have to stay different here too: a caller whose list came out
    // empty getting back the whole lane would name jobs the gate was never
    // waiting on.
    test('an empty job-type list names no job, an absent one no filter', async function (assert) {
      await enqueueIndexJob(dbAdapter, realmURL);
      assert.deepEqual(
        (await outstandingIndexJobs(dbAdapter, realmURL, [])).map(
          ({ jobType }) => jobType,
        ),
        [],
        'an empty list matches nothing',
      );
      assert.deepEqual(
        (await outstandingIndexJobs(dbAdapter, realmURL, undefined)).map(
          ({ jobType }) => jobType,
        ),
        ['from-scratch-index'],
        'an absent list is no filter at all',
      );
    });

    test('narrows by job type like the gate it explains', async function (assert) {
      let writing = await enqueueIndexJob(dbAdapter, realmURL);
      await enqueueIndexJob(dbAdapter, realmURL, 'unfulfilled', {
        jobType: 'scoped-css-gc',
      });
      assert.deepEqual(
        (await outstandingIndexJobs(dbAdapter, realmURL)).map(
          ({ jobType }) => jobType,
        ),
        ['from-scratch-index', 'scoped-css-gc'],
        'unnarrowed, it reports the whole lane',
      );
      assert.deepEqual(
        await outstandingIndexJobs(
          dbAdapter,
          realmURL,
          INDEX_WRITING_JOB_TYPES,
        ),
        [{ id: writing, jobType: 'from-scratch-index', claimed: false }],
        'narrowed, only what a readiness gate waits on',
      );
    });

    // The two states a reader of the log line has to tell apart. Both are
    // unfulfilled jobs in the lane with identical ids and types, so `claimed`
    // is the only thing separating "waiting behind a backlog" from "a worker
    // died holding this".
    test('separates a claimed job from one waiting behind it', async function (assert) {
      let running = await enqueueIndexJob(dbAdapter, realmURL);
      await claimJob(dbAdapter, running);
      let waiting = await enqueueIndexJob(dbAdapter, realmURL, 'unfulfilled', {
        jobType: 'incremental-index',
      });
      assert.deepEqual(
        await outstandingIndexJobs(dbAdapter, realmURL),
        [
          { id: running, jobType: 'from-scratch-index', claimed: true },
          { id: waiting, jobType: 'incremental-index', claimed: false },
        ],
        'only the job with a live reservation reads as claimed',
      );
    });

    // A worker that died holding the job leaves a reservation behind. The job
    // is claimable again, so it is waiting — reporting it as claimed would
    // point an operator at a worker that no longer exists.
    test('an expired reservation reads as waiting', async function (assert) {
      let abandoned = await enqueueIndexJob(dbAdapter, realmURL);
      await claimJob(dbAdapter, abandoned, { expired: true });
      assert.deepEqual(
        await outstandingIndexJobs(dbAdapter, realmURL),
        [{ id: abandoned, jobType: 'from-scratch-index', claimed: false }],
        'a dead attempt does not read as a live worker',
      );
    });

    // Matches `awaitRealmIndexSettled`, which reports settled without touching
    // `jobs` on an adapter that has no queue. Naming jobs there would mean
    // querying a table that need not exist.
    test('an adapter with no job queue reports nothing', async function (assert) {
      await enqueueIndexJob(dbAdapter, realmURL);
      let queueless = Object.create(dbAdapter, {
        kind: { value: 'sqlite' },
      }) as PgAdapter;
      assert.deepEqual(
        await outstandingIndexJobs(queueless, realmURL),
        [],
        'no query, so nothing to report',
      );
    });
  });

  // The readiness gate reads the lane only after its budget is already spent,
  // to name what held it. That read sits between a decided 503 and returning
  // it, so anything it does to the response is a defect: a throw would reach
  // the router, which answers an unexpected-exception 500 carrying neither
  // `X-Boxel-Not-Ready` nor `Retry-After`, and a slow read would extend a
  // request past the deadline the budget exists to bound.
  module('readLaneHoldersBestEffort', function () {
    // `kind` has to stay 'pg' — `outstandingIndexJobs` short-circuits on any
    // other adapter and would never reach the stubbed `execute`, so the test
    // would pass without exercising the failure at all.
    function adapterWhoseQueries(behaviour: () => Promise<never>): PgAdapter {
      return Object.create(dbAdapter, {
        execute: { value: behaviour },
      }) as PgAdapter;
    }

    test('reports the holders when the read succeeds', async function (assert) {
      let jobId = await enqueueIndexJob(dbAdapter, realmURL);
      assert.deepEqual(
        await readLaneHoldersBestEffort(
          dbAdapter,
          realmURL,
          INDEX_WRITING_JOB_TYPES,
          5_000,
        ),
        {
          outcome: 'read',
          holders: [
            { id: jobId, jobType: 'from-scratch-index', claimed: false },
          ],
        },
        'the happy path carries the lane',
      );
    });

    test('reports a failed read rather than throwing', async function (assert) {
      let failing = adapterWhoseQueries(() =>
        Promise.reject(new Error('connection terminated unexpectedly')),
      );
      assert.deepEqual(
        await readLaneHoldersBestEffort(
          failing,
          realmURL,
          INDEX_WRITING_JOB_TYPES,
          5_000,
        ),
        {
          outcome: 'failed',
          reason: 'connection terminated unexpectedly',
        },
        'a database error is absorbed, and carries why',
      );
    });

    test('reports a timeout rather than hanging when the read stalls', async function (assert) {
      let stalled = adapterWhoseQueries(() => new Promise<never>(() => {}));
      let startedAt = Date.now();
      assert.deepEqual(
        await readLaneHoldersBestEffort(
          stalled,
          realmURL,
          INDEX_WRITING_JOB_TYPES,
          200,
        ),
        { outcome: 'timed-out' },
        'the budget decides, not the query',
      );
      // The query never settles, so without the bound this await never
      // returns and the assertion above could not run at all.
      assert.true(
        Date.now() - startedAt < 3_000,
        'it returned on its own budget rather than waiting on the query',
      );
    });

    // The three outcomes the gate logs differently. A read that failed in 2ms
    // and one that spent the whole budget are different problems, and neither
    // is an empty lane — collapsing any pair of them would state one on
    // evidence of another.
    test('keeps an empty lane, a failed read and a timeout apart', async function (assert) {
      assert.deepEqual(
        await readLaneHoldersBestEffort(
          dbAdapter,
          realmURL,
          INDEX_WRITING_JOB_TYPES,
          5_000,
        ),
        { outcome: 'read', holders: [] },
        'an empty lane reads as read-and-empty',
      );
      let failed = await readLaneHoldersBestEffort(
        adapterWhoseQueries(() => Promise.reject(new Error('boom'))),
        realmURL,
        INDEX_WRITING_JOB_TYPES,
        5_000,
      );
      assert.strictEqual(
        failed.outcome,
        'failed',
        'a failed read is not an empty lane',
      );
      let timedOut = await readLaneHoldersBestEffort(
        adapterWhoseQueries(() => new Promise<never>(() => {})),
        realmURL,
        INDEX_WRITING_JOB_TYPES,
        200,
      );
      assert.strictEqual(
        timedOut.outcome,
        'timed-out',
        'a query that never answered is not one that refused',
      );
    });
  });

  module('awaitPublishedHtmlReady', function () {
    test('a realm with no index rows is caught up', async function (assert) {
      assert.true(
        await awaitPublishedHtmlReady(dbAdapter, realmURL, { timeoutMs: 200 }),
        'a realm that has never been indexed has no HTML to await',
      );
    });

    test('a live row whose HTML is missing holds the gate', async function (assert) {
      await insertIndexRow(dbAdapter, realmURL, 'card-1', 3);
      assert.false(
        await awaitPublishedHtmlReady(dbAdapter, realmURL, {
          timeoutMs: 200,
          pollIntervalMs: 50,
        }),
        'an unrendered row is not ready',
      );
    });

    test('a live row whose HTML is behind its own generation holds the gate', async function (assert) {
      await insertIndexRow(dbAdapter, realmURL, 'card-1', 3);
      await insertHtmlRow(dbAdapter, realmURL, 'card-1', 2);
      assert.false(
        await awaitPublishedHtmlReady(dbAdapter, realmURL, {
          timeoutMs: 200,
          pollIntervalMs: 50,
        }),
        'HTML from an earlier generation is stale for this row',
      );
    });

    test('HTML at the row generation is caught up', async function (assert) {
      await insertIndexRow(dbAdapter, realmURL, 'card-1', 3);
      await insertHtmlRow(dbAdapter, realmURL, 'card-1', 3);
      assert.true(
        await awaitPublishedHtmlReady(dbAdapter, realmURL, { timeoutMs: 200 }),
        'a row rendered at its own generation is ready',
      );
    });

    // `realm_generations.current_generation` advances on every index batch,
    // while the prerender channel writes rows only at the generation its
    // spawning pass anticipated — so the watermark can sit above every rendered
    // row on a realm that is fully rendered. Readiness must not read it.
    test('a current_generation ahead of every rendered row does not hold the gate', async function (assert) {
      await insertIndexRow(dbAdapter, realmURL, 'card-1', 3);
      await insertHtmlRow(dbAdapter, realmURL, 'card-1', 3);
      await dbAdapter.execute(
        `INSERT INTO realm_generations (realm_url, current_generation, loader_epoch)
           VALUES ($1, 9, 'epoch')`,
        { bind: [realmURL] },
      );
      assert.true(
        await awaitPublishedHtmlReady(dbAdapter, realmURL, { timeoutMs: 200 }),
        'every live row is rendered, so the realm is ready regardless of the watermark',
      );
    });

    // Readiness is a whole-realm property: any single unrendered row holds it.
    test('one rendered row does not vouch for an unrendered sibling', async function (assert) {
      await insertIndexRow(dbAdapter, realmURL, 'card-1', 3);
      await insertHtmlRow(dbAdapter, realmURL, 'card-1', 3);
      await insertIndexRow(dbAdapter, realmURL, 'card-2', 3);
      assert.false(
        await awaitPublishedHtmlReady(dbAdapter, realmURL, {
          timeoutMs: 200,
          pollIntervalMs: 50,
        }),
        'the unrendered sibling still holds the gate',
      );
    });

    // Preserve the established readiness behavior: a render visit that leaves
    // a tombstone at the row's generation has completed, even though it
    // produced no markup. Readiness reports completion rather than turning a
    // terminal render outcome into a permanently blocked publish.
    test('a prerendered_html tombstone at the row generation is caught up', async function (assert) {
      await insertIndexRow(dbAdapter, realmURL, 'card-1', 3);
      await insertHtmlRow(dbAdapter, realmURL, 'card-1', 3, {
        isDeleted: true,
      });
      assert.true(
        await awaitPublishedHtmlReady(dbAdapter, realmURL, { timeoutMs: 200 }),
        'a current-generation tombstone is a completed render outcome',
      );
    });

    // Neither has servable HTML to wait on, matching the exclusions in
    // findStalePrerenderedHtmlRows.
    test('tombstones and index-errored rows do not hold the gate', async function (assert) {
      await insertIndexRow(dbAdapter, realmURL, 'deleted', 3, {
        isDeleted: true,
      });
      await insertIndexRow(dbAdapter, realmURL, 'broken', 3, {
        hasError: true,
      });
      assert.true(
        await awaitPublishedHtmlReady(dbAdapter, realmURL, { timeoutMs: 200 }),
        'a deletion and an index error leave the HTML gate clear',
      );
    });

    test('the gate is scoped to one realm', async function (assert) {
      await insertIndexRow(dbAdapter, otherRealmURL, 'card-1', 3);
      assert.true(
        await awaitPublishedHtmlReady(dbAdapter, realmURL, { timeoutMs: 200 }),
        "another realm's unrendered row does not hold this realm's gate",
      );
      assert.false(
        await awaitPublishedHtmlReady(dbAdapter, otherRealmURL, {
          timeoutMs: 200,
          pollIntervalMs: 50,
        }),
        'that realm holds its own gate',
      );
    });

    test('the gate releases when the render lands', async function (assert) {
      await insertIndexRow(dbAdapter, realmURL, 'card-1', 3);

      let ready: boolean | undefined;
      let waiting = awaitPublishedHtmlReady(dbAdapter, realmURL, {
        timeoutMs: 30_000,
        pollIntervalMs: 100,
      }).then((result) => {
        ready = result;
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.strictEqual(ready, undefined, 'still waiting while unrendered');

      await insertHtmlRow(dbAdapter, realmURL, 'card-1', 3);
      await dbAdapter.execute(`NOTIFY jobs_finished`);

      await waiting;
      assert.true(ready, 'the gate releases once the HTML lands');
    });
  });
});
