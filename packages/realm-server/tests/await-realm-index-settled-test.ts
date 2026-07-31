import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  awaitRealmIndexSettled,
  indexingConcurrencyGroup,
} from '@cardstack/runtime-common/jobs/indexing';
import { prerenderHtmlConcurrencyGroup } from '@cardstack/runtime-common/jobs/prerender-html';
import { setupDB } from './helpers/index.ts';

const realmURL = 'http://localhost:4201/test/';
const otherRealmURL = 'http://localhost:4201/other/';

// Insert a queue row into a realm's index lane. `status` defaults to
// 'unfulfilled', which is the state the gate is looking for.
async function enqueueIndexJob(
  dbAdapter: PgAdapter,
  url: string,
  status: 'unfulfilled' | 'resolved' | 'rejected' = 'unfulfilled',
): Promise<number> {
  let [{ id }] = (await dbAdapter.execute(
    `INSERT INTO jobs (job_type, concurrency_group, timeout, priority, args, status)
       VALUES ('from-scratch-index', $1, 3600, 10, $2, $3)
       RETURNING id`,
    {
      bind: [
        indexingConcurrencyGroup(url),
        JSON.stringify({ realmURL: url }),
        status,
      ],
    },
  )) as { id: number }[];
  return id;
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
});
