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
  // The writers whose work the row carries. Omitted leaves the column null,
  // which is the untagged pass — a row from before the column existed, or one
  // no HTTP write produced.
  initiatedBy?: string[],
): Promise<number> {
  let [{ id }] = (await dbAdapter.execute(
    `INSERT INTO jobs (job_type, concurrency_group, timeout, priority, args, status, initiated_by)
       VALUES ('from-scratch-index', $1, 3600, 10, $2, $3, $4)
       RETURNING id`,
    {
      bind: [
        indexingConcurrencyGroup(url),
        JSON.stringify({ realmURL: url }),
        status,
        initiatedBy ? JSON.stringify(initiatedBy) : null,
      ],
    },
  )) as { id: number }[];
  return id;
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
        await enqueueIndexJob(dbAdapter, realmURL, 'unfulfilled', [
          someoneElse,
        ]);
        assert.true(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            initiatedBy: writer,
            realmOwner: owner,
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
        await enqueueIndexJob(dbAdapter, realmURL, 'unfulfilled', [writer]);
        assert.false(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            pollIntervalMs: 50,
            initiatedBy: writer,
            realmOwner: owner,
          }),
          'a pass indexing bytes this writer wrote is one it must wait for',
        );
      });

      // A pass carries every caller that merged into it, so a writer absorbed
      // into someone else's job is still waiting on its own bytes. Recording
      // only whoever got there first would let this writer past a pass that
      // has not indexed its write yet.
      test('a coalesced pass holds every writer it carries', async function (assert) {
        await enqueueIndexJob(dbAdapter, realmURL, 'unfulfilled', [
          someoneElse,
          writer,
        ]);
        assert.false(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            pollIntervalMs: 50,
            initiatedBy: writer,
            realmOwner: owner,
          }),
          'the writer that merged in waits for the merged pass',
        );
        assert.false(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            pollIntervalMs: 50,
            initiatedBy: someoneElse,
            realmOwner: owner,
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
            initiatedBy: owner,
            realmOwner: owner,
          }),
          'the owner waits for a pass with no writer recorded',
        );
        assert.true(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            initiatedBy: writer,
            realmOwner: owner,
          }),
          'and no other writer does',
        );
      });

      // The two scopes are independent conditions on one query, so a writer
      // whose own pass is of a type the caller did not ask about is still let
      // through.
      test('the writer scope composes with the job-type scope', async function (assert) {
        await enqueueIndexJob(dbAdapter, realmURL, 'unfulfilled', [writer]);
        assert.true(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            initiatedBy: writer,
            realmOwner: owner,
            jobTypes: ['incremental-index'],
          }),
          'this writer has a pass in the lane, but not one of these types',
        );
        assert.false(
          await awaitRealmIndexSettled(dbAdapter, realmURL, {
            timeoutMs: 200,
            pollIntervalMs: 50,
            initiatedBy: writer,
            realmOwner: owner,
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
