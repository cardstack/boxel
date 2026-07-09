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
  insert,
  insertPermissions,
  logger,
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
  }: {
    url: string;
    realmURL: string;
    type?: string;
    generation: number;
    isDeleted?: boolean;
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
        error_doc: errorDoc,
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
  }: {
    realmURL: string;
    generation: number;
    urls: string[];
    status?: string;
  }) {
    return insertJob(dbAdapter, {
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
        changes: urls.map((url) => ({ url, operation: 'update' })),
      },
    });
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
      { realmsRepaired: 1, urlsEnqueued: 2 },
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
      { realmsRepaired: 0, urlsEnqueued: 0 },
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

  test('skips URLs whose prerender_html job was rejected', async function (assert) {
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
    await seedPrerenderHtmlJob({
      realmURL,
      generation: 5,
      urls: [`${realmURL}mango.json`],
      status: 'rejected',
    });

    let result = await runReconcile();
    assert.deepEqual(
      result,
      { realmsRepaired: 0, urlsEnqueued: 0 },
      'a deterministically-failed render is not re-enqueued to fail again',
    );

    let unfulfilled = (await prerenderHtmlJobs(realmURL)).filter(
      (job) => job.status === 'unfulfilled',
    );
    assert.strictEqual(
      unfulfilled.length,
      0,
      'no fresh repair job was enqueued for the rejected URL',
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
      { realmsRepaired: 1, urlsEnqueued: 1 },
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
      { realmsRepaired: 0, urlsEnqueued: 0 },
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
      { realmsRepaired: 0, urlsEnqueued: 0 },
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
      { realmsRepaired: 1, urlsEnqueued: 1 },
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
      { realmsRepaired: 0, urlsEnqueued: 0 },
      'the second sweep finds the row already covered by the queued repair',
    );
    assert.strictEqual(
      (await prerenderHtmlJobs(realmURL)).length,
      1,
      'no duplicate repair job accumulates',
    );
  });
});
