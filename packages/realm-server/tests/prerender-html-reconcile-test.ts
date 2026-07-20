import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type {
  DefinitionLookup,
  Expression,
  IndexWriter,
  Prerenderer,
  QueuePublisher,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  asExpressions,
  findPrerenderHtmlRejectionStreaks,
  insert,
  insertPermissions,
  logger,
  param,
  PRERENDER_HTML_VISIT_FAILURE_RETRY_CAP,
  prerenderHtmlRepairBackoffMs,
  prerenderHtmlReconcile,
  query,
} from '@cardstack/runtime-common';
import { prerenderHtmlConcurrencyGroup } from '@cardstack/runtime-common/jobs/prerender-html';

import { insertJob, setupDB } from './helpers/index.ts';

interface PrerenderHtmlJobRow {
  id: number;
  concurrency_group: string | null;
  priority: number;
  status: string;
  args: {
    realmURL: string;
    realmUsername: string;
    generation: number;
    loaderEpoch: string;
    changes: { url: string; operation: string }[];
  };
}

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;
  let queuePublisher: QueuePublisher;

  setupDB(hooks, {
    beforeEach: async (
      _dbAdapter: PgAdapter,
      _publisher: QueuePublisher,
    ): Promise<void> => {
      dbAdapter = _dbAdapter;
      queuePublisher = _publisher;
    },
  });

  function runReconcile() {
    return prerenderHtmlReconcile({
      reportStatus: () => {},
      log: logger('prerender-html-reconcile-test'),
      dbAdapter,
      queuePublisher,
      indexWriter: null as unknown as IndexWriter,
      prerenderer: null as unknown as Prerenderer,
      definitionLookup: null as unknown as DefinitionLookup,
      virtualNetwork: null as unknown as VirtualNetwork,
      matrixURL: 'http://localhost:8008',
      getReader: () => {
        throw new Error('getReader is not used by prerender-html-reconcile');
      },
      getAuthedFetch: async () => globalThis.fetch,
      createPrerenderAuth: () => '',
    })({});
  }

  async function seedOwner(realmURL: string, userId = '@owner:localhost') {
    await insertPermissions(dbAdapter, new URL(realmURL), {
      [userId]: ['read', 'realm-owner'],
    });
  }

  async function seedRealmGeneration(
    realmURL: string,
    generation: number,
    loaderEpoch = '0',
  ) {
    let { nameExpressions, valueExpressions } = asExpressions({
      realm_url: realmURL,
      current_generation: generation,
      loader_epoch: loaderEpoch,
    });
    await query(
      dbAdapter,
      insert('realm_generations', nameExpressions, valueExpressions),
    );
  }

  async function seedIndexRow({
    url,
    realmURL,
    type = 'instance',
    generation,
    isDeleted = false,
    hasError = false,
    errorDoc = null,
  }: {
    url: string;
    realmURL: string;
    type?: string;
    generation: number;
    isDeleted?: boolean;
    hasError?: boolean;
    errorDoc?: Record<string, unknown> | null;
  }) {
    let { nameExpressions, valueExpressions } = asExpressions(
      {
        url,
        file_alias: url,
        realm_url: realmURL,
        type,
        generation,
        is_deleted: isDeleted,
        has_error: hasError,
        error_doc: errorDoc,
      },
      { jsonFields: ['error_doc'] },
    );
    await query(
      dbAdapter,
      insert('boxel_index', nameExpressions, valueExpressions),
    );
  }

  async function seedPrerenderedHtmlRow({
    url,
    realmURL,
    type = 'instance',
    generation,
    isDeleted = false,
    errorDoc = null,
    renderedMinutesAgo,
  }: {
    url: string;
    realmURL: string;
    type?: string;
    generation: number;
    isDeleted?: boolean;
    errorDoc?: Record<string, unknown> | null;
    renderedMinutesAgo?: number;
  }) {
    let { nameExpressions, valueExpressions } = asExpressions(
      {
        url,
        file_alias: url,
        realm_url: realmURL,
        type,
        generation,
        is_deleted: isDeleted,
        error_doc: errorDoc,
        ...(renderedMinutesAgo !== undefined
          ? { rendered_at: Date.now() - renderedMinutesAgo * 60 * 1000 }
          : {}),
      },
      { jsonFields: ['error_doc'] },
    );
    await query(
      dbAdapter,
      insert('prerendered_html', nameExpressions, valueExpressions),
    );
  }

  async function seedPrerenderHtmlJob({
    realmURL,
    generation,
    urls,
    status = 'unfulfilled',
    operation = 'update',
    finishedMinutesAgo,
  }: {
    realmURL: string;
    generation: number;
    urls: string[];
    status?: string;
    operation?: string;
    finishedMinutesAgo?: number;
  }) {
    let job = await insertJob(dbAdapter, {
      job_type: 'prerender_html',
      concurrency_group: prerenderHtmlConcurrencyGroup(realmURL),
      status,
      args: {
        realmURL,
        realmUsername: 'owner',
        generation,
        loaderEpoch: '0',
        spawningJobId: null,
        coalescedPublishes: null,
        changes: urls.map((url) => ({ url, operation })),
      },
    });
    if (finishedMinutesAgo !== undefined) {
      // Stamped on the database clock, the same clock the queue's own
      // finalize uses and the rejection-streak scan measures against.
      await query(dbAdapter, [
        `UPDATE jobs SET finished_at = NOW() - INTERVAL '${finishedMinutesAgo} minutes' WHERE id =`,
        param(job.id),
      ] as Expression);
    }
    return job;
  }

  async function prerenderHtmlJobs(
    realmURL?: string,
  ): Promise<PrerenderHtmlJobRow[]> {
    let rows = (await query(dbAdapter, [
      `SELECT id, concurrency_group, priority, status, args FROM jobs WHERE job_type = 'prerender_html' ORDER BY id`,
    ] as Expression)) as unknown as PrerenderHtmlJobRow[];
    if (realmURL) {
      let group = prerenderHtmlConcurrencyGroup(realmURL);
      rows = rows.filter((row) => row.concurrency_group === group);
    }
    return rows;
  }

  test('enqueues repair for stale and absent HTML rows, skipping fresh, deleted, and errored rows', async function (assert) {
    const realmURL = 'http://example.com/a/';
    await seedOwner(realmURL);
    await seedRealmGeneration(realmURL, 5, 'epoch-a');

    // stale: index at 5, HTML behind at 4
    await seedIndexRow({
      url: `${realmURL}stale.json`,
      realmURL,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}stale.json`,
      realmURL,
      generation: 4,
    });
    // absent: index at 5, no HTML row at all
    await seedIndexRow({
      url: `${realmURL}absent.json`,
      realmURL,
      generation: 5,
    });
    // fresh: index and HTML both at 5
    await seedIndexRow({
      url: `${realmURL}fresh.json`,
      realmURL,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}fresh.json`,
      realmURL,
      generation: 5,
    });
    // deleted: tombstone, lagging HTML — left to the deletion's own job
    await seedIndexRow({
      url: `${realmURL}deleted.json`,
      realmURL,
      generation: 5,
      isDeleted: true,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}deleted.json`,
      realmURL,
      generation: 4,
    });
    // index-errored: no card to render, the index error is the outcome
    await seedIndexRow({
      url: `${realmURL}errored.json`,
      realmURL,
      generation: 5,
      hasError: true,
      errorDoc: { id: `${realmURL}errored.json`, message: 'boom' },
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}errored.json`,
      realmURL,
      generation: 4,
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 1, urlsEnqueued: 2, realmsInBackoff: 0 },
      'only the stale and absent rows were repaired',
    );

    let jobs = await prerenderHtmlJobs(realmURL);
    assert.strictEqual(jobs.length, 1, 'exactly one repair job was enqueued');
    let [job] = jobs;
    assert.strictEqual(
      job.priority,
      0,
      'the repair runs at the background tier',
    );
    assert.strictEqual(
      job.args.generation,
      5,
      'stamped at the realm generation',
    );
    assert.strictEqual(
      job.args.loaderEpoch,
      'epoch-a',
      "carries the realm's committed loader epoch",
    );
    assert.strictEqual(
      job.args.realmUsername,
      'owner',
      "renders as the realm's owner",
    );
    assert.ok(
      job.args.changes.every((change) => change.operation === 'update'),
      'every repair change is an update',
    );
    assert.deepEqual(
      job.args.changes.map((change) => change.url).sort(),
      [`${realmURL}absent.json`, `${realmURL}stale.json`],
      'only the stale and absent URLs are in the repair set',
    );
  });

  test('skips URLs already covered by a queued or running prerender_html job', async function (assert) {
    const realmURL = 'http://example.com/b/';
    await seedOwner(realmURL);
    await seedRealmGeneration(realmURL, 5);
    await seedIndexRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 4,
    });
    let seeded = await seedPrerenderHtmlJob({
      realmURL,
      generation: 5,
      urls: [`${realmURL}mango.json`],
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 0, urlsEnqueued: 0, realmsInBackoff: 0 },
      'nothing is enqueued when an active job already covers the row',
    );

    let jobs = await prerenderHtmlJobs(realmURL);
    assert.strictEqual(jobs.length, 1, 'no additional job was created');
    assert.strictEqual(
      jobs[0].id,
      seeded.id,
      'the already-queued job is left untouched',
    );
  });

  test('re-attempts a stale row whose prerender_html job was rejected', async function (assert) {
    const realmURL = 'http://example.com/c/';
    await seedOwner(realmURL);
    await seedRealmGeneration(realmURL, 5);
    await seedIndexRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 4,
    });
    // A rejected job is a whole-job failure (the handler threw — often a
    // transient upstream outage) whose HTML never landed. That is the residue
    // the sweep exists to repair, so it must not count as coverage, and a
    // single rejection retries at the sweep's own cadence with no backoff. A
    // per-URL deterministic render error is different: it records a
    // current-generation error_doc row that reads as fresh and never appears
    // stale here.
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 5,
      urls: [`${realmURL}mango.json`],
      status: 'rejected',
      finishedMinutesAgo: 10,
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 1, urlsEnqueued: 1, realmsInBackoff: 0 },
      'the rejected job does not suppress repair of its stale row',
    );

    let unfulfilled = (await prerenderHtmlJobs(realmURL)).filter(
      (job) => job.status === 'unfulfilled',
    );
    assert.strictEqual(
      unfulfilled.length,
      1,
      'a fresh repair job is enqueued despite the rejected one',
    );
    assert.ok(
      unfulfilled[0].args.changes.some(
        (change) => change.url === `${realmURL}mango.json`,
      ),
      'the fresh repair covers the stale URL',
    );
  });

  test('repairs a stale row that only an older-generation job covers', async function (assert) {
    const realmURL = 'http://example.com/d/';
    await seedOwner(realmURL);
    await seedRealmGeneration(realmURL, 5);
    await seedIndexRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 3,
    });
    // An older job (generation 3) does not cover content the index has since
    // advanced to generation 5.
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 3,
      urls: [`${realmURL}mango.json`],
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 1, urlsEnqueued: 1, realmsInBackoff: 0 },
      'the row is repaired despite the stale lower-generation job',
    );

    // The enqueue coalesces into the pending lower-generation job, upgrading it
    // to the current generation rather than leaving a stale render scheduled.
    let jobs = await prerenderHtmlJobs(realmURL);
    assert.strictEqual(jobs.length, 1, 'the repair coalesced into one job');
    assert.strictEqual(
      jobs[0].args.generation,
      5,
      'the coalesced job renders at the current generation',
    );
    assert.ok(
      jobs[0].args.changes.some(
        (change) => change.url === `${realmURL}mango.json`,
      ),
      'the stale URL is in the coalesced job',
    );
  });

  test('skips realms owned only by a bot', async function (assert) {
    const realmURL = 'http://example.com/e/';
    await seedOwner(realmURL, '@realm/bot-e:localhost');
    await seedRealmGeneration(realmURL, 5);
    await seedIndexRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 4,
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 0, urlsEnqueued: 0, realmsInBackoff: 0 },
      'bot-owned realms are left to the deploy-time from-scratch reindex',
    );
    assert.strictEqual(
      (await prerenderHtmlJobs(realmURL)).length,
      0,
      'no repair job is enqueued for a bot-owned realm',
    );
  });

  test('a healthy realm enqueues nothing', async function (assert) {
    const realmURL = 'http://example.com/f/';
    await seedOwner(realmURL);
    await seedRealmGeneration(realmURL, 5);
    for (let name of ['mango', 'vanGogh', 'ringo']) {
      await seedIndexRow({
        url: `${realmURL}${name}.json`,
        realmURL,
        generation: 5,
      });
      await seedPrerenderedHtmlRow({
        url: `${realmURL}${name}.json`,
        realmURL,
        generation: 5,
      });
    }

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 0, urlsEnqueued: 0, realmsInBackoff: 0 },
      'a system whose HTML is current finds nothing to repair',
    );
    assert.strictEqual(
      (await prerenderHtmlJobs()).length,
      0,
      'no jobs are enqueued',
    );
  });

  test('is idempotent across repeated sweeps', async function (assert) {
    const realmURL = 'http://example.com/g/';
    await seedOwner(realmURL);
    await seedRealmGeneration(realmURL, 5);
    await seedIndexRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 4,
    });

    let first = await runReconcile();
    assert.deepEqual(
      first,
      { realmsRepaired: 1, urlsEnqueued: 1, realmsInBackoff: 0 },
      'the first sweep enqueues the repair',
    );
    assert.strictEqual(
      (await prerenderHtmlJobs(realmURL)).length,
      1,
      'one repair job after the first sweep',
    );

    let second = await runReconcile();
    assert.deepEqual(
      second,
      { realmsRepaired: 0, urlsEnqueued: 0, realmsInBackoff: 0 },
      'the second sweep finds the row already covered by the queued repair',
    );
    assert.strictEqual(
      (await prerenderHtmlJobs(realmURL)).length,
      1,
      'no duplicate repair job accumulates',
    );
  });

  test('sweeps multiple realms in one pass, including file-type rows', async function (assert) {
    const realmA = 'http://example.com/multi-a/';
    const realmB = 'http://example.com/multi-b/';
    await seedOwner(realmA);
    await seedOwner(realmB);
    await seedRealmGeneration(realmA, 5);
    await seedRealmGeneration(realmB, 7);
    // realmA: a stale instance row
    await seedIndexRow({
      url: `${realmA}mango.json`,
      realmURL: realmA,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmA}mango.json`,
      realmURL: realmA,
      generation: 4,
    });
    // realmB: a stale file row — exercises the (url, realm_url, type) join with type='file'
    await seedIndexRow({
      url: `${realmB}readme.md`,
      realmURL: realmB,
      type: 'file',
      generation: 7,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmB}readme.md`,
      realmURL: realmB,
      type: 'file',
      generation: 6,
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 2, urlsEnqueued: 2, realmsInBackoff: 0 },
      'both realms were repaired in one sweep',
    );
    let jobsA = await prerenderHtmlJobs(realmA);
    let jobsB = await prerenderHtmlJobs(realmB);
    assert.strictEqual(jobsA.length, 1, 'realmA got a repair job');
    assert.strictEqual(
      jobsA[0].args.generation,
      5,
      'realmA stamped at its generation',
    );
    assert.strictEqual(jobsB.length, 1, 'realmB got a repair job');
    assert.strictEqual(
      jobsB[0].args.generation,
      7,
      'realmB stamped at its generation',
    );
    assert.ok(
      jobsB[0].args.changes.some(
        (change) => change.url === `${realmB}readme.md`,
      ),
      'the file-type stale row is repaired',
    );
  });

  test('a delete-operation job does not count as coverage', async function (assert) {
    const realmURL = 'http://example.com/del/';
    await seedOwner(realmURL);
    await seedRealmGeneration(realmURL, 5);
    await seedIndexRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 4,
    });
    // A queued job carrying this URL as a `delete` tombstones rather than
    // renders, so it must not suppress the repair of a live row.
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 5,
      urls: [`${realmURL}mango.json`],
      operation: 'delete',
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 1, urlsEnqueued: 1, realmsInBackoff: 0 },
      'the live row is repaired despite the pending delete job',
    );
    // The repair enqueue coalesces with the pending delete (update wins per URL).
    let jobs = await prerenderHtmlJobs(realmURL);
    assert.strictEqual(jobs.length, 1, 'the repair coalesced into one job');
    assert.ok(
      jobs[0].args.changes.some(
        (change) =>
          change.url === `${realmURL}mango.json` &&
          change.operation === 'update',
      ),
      'the URL is now scheduled as an update render',
    );
  });

  test('skips a realm with no generation row', async function (assert) {
    const realmURL = 'http://example.com/nogen/';
    await seedOwner(realmURL);
    // No realm_generations row seeded.
    await seedIndexRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 4,
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 0, urlsEnqueued: 0, realmsInBackoff: 0 },
      'a realm without a generation row is skipped rather than crashing',
    );
    assert.strictEqual(
      (await prerenderHtmlJobs(realmURL)).length,
      0,
      'no repair job is enqueued',
    );
  });

  test('the repair backoff schedule doubles per consecutive rejection and caps', function (assert) {
    const HOUR = 60 * 60 * 1000;
    assert.strictEqual(
      prerenderHtmlRepairBackoffMs(0),
      0,
      'no rejections, no backoff',
    );
    assert.strictEqual(
      prerenderHtmlRepairBackoffMs(1),
      0,
      'a single rejection retries at the sweep’s own cadence',
    );
    assert.strictEqual(prerenderHtmlRepairBackoffMs(2), 2 * HOUR);
    assert.strictEqual(prerenderHtmlRepairBackoffMs(3), 4 * HOUR);
    assert.strictEqual(prerenderHtmlRepairBackoffMs(4), 8 * HOUR);
    assert.strictEqual(
      prerenderHtmlRepairBackoffMs(10),
      8 * HOUR,
      'the schedule caps rather than growing without bound',
    );
  });

  test('a rejection streak counts newest-first and stops at the first resolved job', async function (assert) {
    const realmURL = 'http://example.com/streak/';
    // Oldest → newest: rejected, resolved, rejected, rejected. The streak is
    // the two newest rejections; the resolved job fences off the older one.
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 1,
      urls: [`${realmURL}mango.json`],
      status: 'rejected',
      finishedMinutesAgo: 40,
    });
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 2,
      urls: [`${realmURL}mango.json`],
      status: 'resolved',
      finishedMinutesAgo: 30,
    });
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 3,
      urls: [`${realmURL}mango.json`],
      status: 'rejected',
      finishedMinutesAgo: 20,
    });
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 4,
      urls: [`${realmURL}mango.json`],
      status: 'rejected',
      finishedMinutesAgo: 10,
    });

    let streaks = await findPrerenderHtmlRejectionStreaks(dbAdapter, [
      realmURL,
    ]);
    let streak = streaks.get(realmURL);
    assert.strictEqual(streak?.consecutiveRejections, 2);
    let msSinceLastRejection = streak?.msSinceLastRejection ?? -1;
    assert.true(
      msSinceLastRejection >= 9 * 60 * 1000,
      `the streak is measured from the newest rejection (got ${msSinceLastRejection}ms)`,
    );
    assert.true(
      msSinceLastRejection <= 11 * 60 * 1000,
      `the newest rejection is the ten-minute-old one (got ${msSinceLastRejection}ms)`,
    );

    let unrelated = await findPrerenderHtmlRejectionStreaks(dbAdapter, [
      'http://example.com/other/',
    ]);
    assert.strictEqual(
      unrelated.size,
      0,
      'realms outside the requested set are not scanned',
    );
  });

  test('a realm whose newest finished job resolved has no streak', async function (assert) {
    const realmURL = 'http://example.com/reset/';
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 1,
      urls: [`${realmURL}mango.json`],
      status: 'rejected',
      finishedMinutesAgo: 20,
    });
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 2,
      urls: [`${realmURL}mango.json`],
      status: 'resolved',
      finishedMinutesAgo: 10,
    });

    let streaks = await findPrerenderHtmlRejectionStreaks(dbAdapter, [
      realmURL,
    ]);
    assert.strictEqual(
      streaks.size,
      0,
      'a resolved job resets the realm to full repair frequency',
    );
  });

  test('defers repair while a realm is inside its rejection-streak backoff window', async function (assert) {
    const realmURL = 'http://example.com/backoff/';
    await seedOwner(realmURL);
    await seedRealmGeneration(realmURL, 5);
    await seedIndexRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 4,
    });
    // Two consecutive rejections, the newest ten minutes ago: the realm owes
    // a two-hour wait before its next repair attempt.
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 5,
      urls: [`${realmURL}mango.json`],
      status: 'rejected',
      finishedMinutesAgo: 70,
    });
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 5,
      urls: [`${realmURL}mango.json`],
      status: 'rejected',
      finishedMinutesAgo: 10,
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 0, urlsEnqueued: 0, realmsInBackoff: 1 },
      'the realm’s residue is deferred, not repaired',
    );
    let unfulfilled = (await prerenderHtmlJobs(realmURL)).filter(
      (job) => job.status === 'unfulfilled',
    );
    assert.strictEqual(
      unfulfilled.length,
      0,
      'no repair job is enqueued while the backoff window is open',
    );
  });

  test('repairs once the backoff window has elapsed', async function (assert) {
    const realmURL = 'http://example.com/backoff-done/';
    await seedOwner(realmURL);
    await seedRealmGeneration(realmURL, 5);
    await seedIndexRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 4,
    });
    // The same two-rejection streak, but the newest rejection is three hours
    // old — past the two-hour interval the streak owes.
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 5,
      urls: [`${realmURL}mango.json`],
      status: 'rejected',
      finishedMinutesAgo: 240,
    });
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 5,
      urls: [`${realmURL}mango.json`],
      status: 'rejected',
      finishedMinutesAgo: 180,
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 1, urlsEnqueued: 1, realmsInBackoff: 0 },
      'the deferred repair goes out once the window has elapsed',
    );
    let unfulfilled = (await prerenderHtmlJobs(realmURL)).filter(
      (job) => job.status === 'unfulfilled',
    );
    assert.strictEqual(
      unfulfilled.length,
      1,
      'the repair job is enqueued once the realm is eligible',
    );
  });

  test('one realm in backoff does not defer another realm’s repair in the same sweep', async function (assert) {
    const deferredRealm = 'http://example.com/mixed-deferred/';
    const healthyRealm = 'http://example.com/mixed-healthy/';
    for (let realmURL of [deferredRealm, healthyRealm]) {
      await seedOwner(realmURL);
      await seedRealmGeneration(realmURL, 5);
      await seedIndexRow({
        url: `${realmURL}mango.json`,
        realmURL,
        generation: 5,
      });
      await seedPrerenderedHtmlRow({
        url: `${realmURL}mango.json`,
        realmURL,
        generation: 4,
      });
    }
    await seedPrerenderHtmlJob({
      realmURL: deferredRealm,
      generation: 5,
      urls: [`${deferredRealm}mango.json`],
      status: 'rejected',
      finishedMinutesAgo: 70,
    });
    await seedPrerenderHtmlJob({
      realmURL: deferredRealm,
      generation: 5,
      urls: [`${deferredRealm}mango.json`],
      status: 'rejected',
      finishedMinutesAgo: 10,
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 1, urlsEnqueued: 1, realmsInBackoff: 1 },
      'the sweep defers only the realm that owes a backoff wait',
    );
    let deferredJobs = (await prerenderHtmlJobs(deferredRealm)).filter(
      (job) => job.status === 'unfulfilled',
    );
    assert.strictEqual(
      deferredJobs.length,
      0,
      'the deferred realm gets no job',
    );
    let healthyJobs = (await prerenderHtmlJobs(healthyRealm)).filter(
      (job) => job.status === 'unfulfilled',
    );
    assert.strictEqual(
      healthyJobs.length,
      1,
      'the healthy realm is repaired in the same sweep',
    );
  });

  test('a deterministic render-error row at the current generation is the recorded outcome, not residue', async function (assert) {
    const realmURL = 'http://example.com/recorded/';
    await seedOwner(realmURL);
    await seedRealmGeneration(realmURL, 5);
    await seedIndexRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
    });
    // A render error without the visit-request-failure marker is a verdict
    // about the content: it reads as fresh, so the sweep never re-enqueues
    // it — the retry lane for this row is its next invalidation (an edit or
    // a full reindex).
    await seedPrerenderedHtmlRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
      errorDoc: {
        message: 'intentional render failure',
      },
      renderedMinutesAgo: 120,
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 0, urlsEnqueued: 0, realmsInBackoff: 0 },
      'the recorded failure is not repairable residue',
    );
    assert.strictEqual(
      (await prerenderHtmlJobs(realmURL)).length,
      0,
      'no repair job is enqueued for the recorded failure',
    );
  });

  test('a visit-request failure below the retry cap is retried once it ages past the minimum', async function (assert) {
    const realmURL = 'http://example.com/retry-lane/';
    await seedOwner(realmURL);
    await seedRealmGeneration(realmURL, 5, 'epoch-a');
    await seedIndexRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
    });
    // Current generation — fresh by the generation measure — but the error
    // describes the visit's own request, the run is below the cap, and the
    // rendering is old enough to be eligible.
    await seedPrerenderedHtmlRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
      errorDoc: {
        message: 'Prerender request aborted after exceeding its timeout',
        visitRequestFailure: true,
        consecutiveVisitFailures: 1,
      },
      renderedMinutesAgo: 60,
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 1, urlsEnqueued: 1, realmsInBackoff: 0 },
      'the failed visit gets another attempt',
    );
    let jobs = await prerenderHtmlJobs(realmURL);
    assert.strictEqual(jobs.length, 1);
    assert.ok(
      jobs[0].args.changes.some(
        (change) =>
          change.url === `${realmURL}mango.json` &&
          change.operation === 'update',
      ),
      'the retry re-renders the failed URL',
    );
  });

  test('a visit-request failure at the retry cap is terminal', async function (assert) {
    const realmURL = 'http://example.com/retry-capped/';
    await seedOwner(realmURL);
    await seedRealmGeneration(realmURL, 5);
    await seedIndexRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
      errorDoc: {
        message: 'Prerender request aborted after exceeding its timeout',
        visitRequestFailure: true,
        consecutiveVisitFailures: PRERENDER_HTML_VISIT_FAILURE_RETRY_CAP,
      },
      renderedMinutesAgo: 600,
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 0, urlsEnqueued: 0, realmsInBackoff: 0 },
      'a capped run stands as the recorded outcome — the sweep stops burning the affinity lane on it',
    );
    assert.strictEqual((await prerenderHtmlJobs(realmURL)).length, 0);
  });

  test('a visit-request failure younger than the minimum age is not retried yet', async function (assert) {
    const realmURL = 'http://example.com/retry-fresh/';
    await seedOwner(realmURL);
    await seedRealmGeneration(realmURL, 5);
    await seedIndexRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
    });
    await seedPrerenderedHtmlRow({
      url: `${realmURL}mango.json`,
      realmURL,
      generation: 5,
      errorDoc: {
        message: 'Prerender request aborted after exceeding its timeout',
        visitRequestFailure: true,
        consecutiveVisitFailures: 1,
      },
      renderedMinutesAgo: 5,
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 0, urlsEnqueued: 0, realmsInBackoff: 0 },
      'a just-recorded failure waits out the minimum age before its retry',
    );
    assert.strictEqual((await prerenderHtmlJobs(realmURL)).length, 0);
  });
});
