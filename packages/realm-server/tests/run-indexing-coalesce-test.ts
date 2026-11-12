import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import { PgQueuePublisher, PgQueueRunner } from '@cardstack/postgres';
import {
  Deferred,
  userInitiatedPriority,
  type Prerenderer,
  type PrerenderVisitArgs,
  type QueuePublisher,
  type RenderVisitResponse,
} from '@cardstack/runtime-common';
import {
  INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
  makeIncrementalArgsWithCallerMetadata,
  mapIncrementalDoneResult,
} from '@cardstack/runtime-common/jobs/indexing';
import { enqueuePrerenderHtmlJob } from '@cardstack/runtime-common/jobs/prerender-html';
import {
  meteredPrerenderer,
  runIndexingFor,
  type RunIndexing,
} from '@cardstack/runtime-common/run-indexing';
// Registers the two job types' coalescing decisions.
import '@cardstack/runtime-common/tasks/indexer';
import '@cardstack/runtime-common/tasks/prerender-html';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './helpers/index.ts';

const RUN = '0a5e6a5e-0000-4000-8000-000000000001';
const OTHER_RUN = '0a5e6a5e-0000-4000-8000-000000000002';

// A job indexing or rendering an automation run's commit does that work and
// nothing else: it never joins another publish's job, and no other publish
// joins it. Every other publish coalesces as it would without it.
module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let publisher: QueuePublisher;

  // No runner claims anything, so every job stays pending and each publish
  // meets the ones before it.
  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    publisher = new PgQueuePublisher(adapter);
  });

  hooks.afterEach(async function () {
    await publisher.destroy();
    await closeTestPgAdapter(adapter);
  });

  async function publishIndex(
    realmURL: string,
    file: string,
    runIndexing: RunIndexing | null = null,
  ) {
    return await publisher.publish({
      jobType: 'incremental-index',
      concurrencyGroup: `indexing:${realmURL}`,
      timeout: INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
      priority: userInitiatedPriority,
      args: makeIncrementalArgsWithCallerMetadata(
        {
          realmURL,
          realmUsername: 'owner',
          ignoreData: {},
          changes: [{ url: `${realmURL}${file}`, operation: 'update' }],
          runIndexing,
        },
        null,
      ),
      mapResult: mapIncrementalDoneResult(null),
    });
  }

  async function publishRender(
    realmURL: string,
    file: string,
    runIndexing: RunIndexing | null = null,
  ) {
    return await enqueuePrerenderHtmlJob(publisher, {
      realmURL,
      realmUsername: 'owner',
      changes: [{ url: `${realmURL}${file}`, operation: 'update' }],
      spawningIndexPasses: [],
      generation: 1,
      loaderEpoch: 'epoch-a',
      spawningJobId: null,
      spawningPriority: userInitiatedPriority,
      timeoutSec: INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
      preWarm: false,
      runIndexing,
    });
  }

  async function pendingChanges(jobId: number): Promise<string[]> {
    let [row] = (await adapter.execute(`SELECT args FROM jobs WHERE id = $1`, {
      bind: [jobId],
    })) as { args: { changes: { url: string }[] } }[];
    return row.args.changes.map(({ url }) => url.split('/').pop()!).sort();
  }

  test('an index pass for a run’s commit neither joins nor is joined', async function (assert) {
    let realmURL = 'http://example.com/run-index-coalesce/';
    let ordinary = await publishIndex(realmURL, 'a.json');
    let run = await publishIndex(realmURL, 'b.json', runIndexingFor(RUN));
    let later = await publishIndex(realmURL, 'c.json');
    let otherRun = await publishIndex(
      realmURL,
      'd.json',
      runIndexingFor(OTHER_RUN),
    );
    let sameRunAgain = await publishIndex(
      realmURL,
      'e.json',
      runIndexingFor(RUN),
    );

    assert.notStrictEqual(run.id, ordinary.id, 'the run’s pass joins nothing');
    assert.strictEqual(
      later.id,
      ordinary.id,
      'a later ordinary publish still joins the ordinary pending pass, past the run’s',
    );
    assert.deepEqual(await pendingChanges(ordinary.id), ['a.json', 'c.json']);
    assert.deepEqual(
      await pendingChanges(run.id),
      ['b.json'],
      'the run’s pass indexes only the run’s commit',
    );
    assert.notStrictEqual(otherRun.id, run.id, 'two runs never share a pass');
    assert.notStrictEqual(
      sameRunAgain.id,
      run.id,
      'a run’s second pass is a pass of its own',
    );
  });

  test('a render job for a run’s commit neither joins nor is joined', async function (assert) {
    let realmURL = 'http://example.com/run-render-coalesce/';
    let ordinary = await publishRender(realmURL, 'a.json');
    let run = await publishRender(realmURL, 'b.json', runIndexingFor(RUN));
    let later = await publishRender(realmURL, 'c.json');

    assert.notStrictEqual(
      run.id,
      ordinary.id,
      'the run’s render joins nothing',
    );
    assert.strictEqual(
      later.id,
      ordinary.id,
      'a later ordinary render still joins the ordinary pending job, past the run’s',
    );
    assert.deepEqual(await pendingChanges(ordinary.id), ['a.json', 'c.json']);
    assert.deepEqual(await pendingChanges(run.id), ['b.json']);
  });

  test('neither rides on a running pass of the other kind', async function (assert) {
    let realmURL = 'http://example.com/run-index-in-flight/';
    let started = new Deferred<void>();
    let release = new Deferred<void>();
    let worker = new PgQueueRunner({ adapter, workerId: 'run-in-flight' });
    worker.register('incremental-index', async () => {
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
      // A publish that doesn't read its own write may ride on a running pass
      // whose changes cover it; the same file is published each time.
      let running = await publishIndex(realmURL, 'a.json');
      await started.promise;

      let run = await publishIndex(realmURL, 'a.json', runIndexingFor(RUN));
      assert.notStrictEqual(
        run.id,
        running.id,
        'the run’s publish does not ride on a running ordinary pass',
      );
      let ordinary = await publishIndex(realmURL, 'a.json');
      assert.strictEqual(
        ordinary.id,
        running.id,
        'an ordinary publish still rides on the running ordinary pass',
      );
    } finally {
      release.fulfill();
      await worker.destroy();
    }
  });

  test('the meter counts each render’s own time, and none started while excluding', async function (assert) {
    let renderMs = [1500, 2500, 4000];
    let calls = 0;
    let fake = {
      prerenderVisit: async (_args: PrerenderVisitArgs) =>
        ({
          meta: { diagnostics: { renderElapsedMs: renderMs[calls++] } },
        }) as unknown as RenderVisitResponse,
    } as unknown as Prerenderer;
    let meter = meteredPrerenderer(fake);
    let args = {} as PrerenderVisitArgs;

    await meter.prerenderer.prerenderVisit(args);
    await meter.excluding(() => meter.prerenderer.prerenderVisit(args));
    await meter.prerenderer.prerenderVisit(args);

    assert.strictEqual(calls, 3, 'every render reached the prerenderer');
    assert.strictEqual(
      meter.tabSeconds(),
      (1500 + 4000) / 1000,
      'the render made while excluding is not counted',
    );
  });
});
