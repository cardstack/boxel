import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  awaitRealmIndexSettled,
  indexingConcurrencyGroup,
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

// A live `boxel_index` row at `generation`, or a tombstone / index-errored one.
// Only the columns the HTML gate reads are set.
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

// The matching `prerendered_html` row. `generation` is what the gate compares
// against the index row's own generation.
async function insertHtmlRow(
  dbAdapter: PgAdapter,
  realm: string,
  name: string,
  generation: number,
): Promise<void> {
  await dbAdapter.execute(
    `INSERT INTO prerendered_html
       (url, file_alias, realm_url, type, generation, isolated_html)
     VALUES ($1, $2, $3, 'instance', $4, '<div>rendered</div>')`,
    { bind: [`${realm}${name}`, `${realm}${name}`, realm, generation] },
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

    // The bug this module exists for (CS-12435). The realm-wide watermark this
    // gate used to read advances on every index batch, while the prerender
    // channel writes rows only at the generation its spawning pass anticipated.
    // A pass that bumps the watermark without a matching render made readiness
    // permanently unsatisfiable for a realm that was in fact fully rendered.
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

    // The old predicate was `SELECT 1 ... LIMIT 1`, so one rendered row
    // anywhere reported the whole realm ready.
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

    // Neither has servable HTML to wait on, so neither can hold readiness open
    // forever — mirroring the exclusions in findStalePrerenderedHtmlRows.
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
