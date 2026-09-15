import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { basename } from 'node:path';
import QUnit from 'qunit';
import {
  type PgAdapter,
  PgQueuePublisher,
  PgQueueRunner,
} from '@cardstack/postgres';
import {
  Deferred,
  IndexWriter,
  VirtualNetwork,
  param,
  query,
  rri,
  type DefinitionLookup,
  type JobInfo,
  type LooseSingleCardDocument,
  type Prerenderer,
  type PrerenderVisitArgs,
  type Reader,
  type RenderVisitResponse,
} from '@cardstack/runtime-common';
import { runPrerenderHtmlPass } from '@cardstack/runtime-common/index-runner/prerender-html-visit';
import { validateLatticeRenderCheckpoint } from '@cardstack/runtime-common/lattice-render-checkpoint';
import {
  enqueueLatticeRenderRetry,
  latticeRenderRetryReadySQL,
} from '@cardstack/runtime-common/jobs/lattice-render';
import type { PrerenderHtmlArgs } from '@cardstack/runtime-common/tasks/prerender-html';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realmURL = 'http://lattice-native-job.example/';
const id = `${realmURL}Day/one`;
const ownerURL = `${id}.json`;
const lock = `lattice:index:${realmURL}`;

function document(count = 7, generation = 2): LooseSingleCardDocument {
  return {
    data: {
      id,
      type: 'card',
      attributes: { count },
      meta: {
        adoptsFrom: { module: rri('../day'), name: 'Day' },
        publication: {
          version: 1,
          state: 'ready',
          computedFields: ['count'],
          queryFields: [],
          watches: [],
          validatedThrough: generation - 1,
          outputRevision: generation,
          definitionRevision: 'code-1',
        },
      },
    },
  };
}

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let writer: IndexWriter;
  let jobId: number;
  let rendered: number[];
  let duringRender: (() => Promise<void>) | undefined;
  let omitReceipt: boolean;
  let renderFailure: string | undefined;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      writer = new IndexWriter(db, {
        lattice: new LatticeRealmConfig([realmURL]),
      });
      rendered = [];
      duringRender = undefined;
      omitReceipt = false;
      renderFailure = undefined;
      await query(db, [
        'INSERT INTO realm_generations (realm_url, current_generation, loader_epoch) VALUES (',
        param(realmURL),
        ", 2, 'code-1')",
      ]);
      await query(db, [
        'INSERT INTO lattice_owners (realm_url, owner_url, published_generation, input_generation, definition_revision) VALUES (',
        param(realmURL),
        ',',
        param(ownerURL),
        ", 2, 1, 'code-1')",
      ]);
      await query(db, [
        'INSERT INTO boxel_index (url, file_alias, realm_url, type, generation, pristine_doc, is_deleted, has_error) VALUES (',
        param(ownerURL),
        ',',
        param(id),
        ',',
        param(realmURL),
        ", 'instance', 2,",
        param(JSON.stringify(document().data)),
        ', FALSE, FALSE)',
      ]);
      await query(db, [
        'INSERT INTO prerendered_html (url, file_alias, realm_url, type, generation, isolated_html, is_deleted) VALUES (',
        param(ownerURL),
        ',',
        param(id),
        ',',
        param(realmURL),
        ", 'instance', 1, '<p>Previous</p>', FALSE)",
      ]);
      let [job] = await query(db, [
        "INSERT INTO jobs (job_type, concurrency_group, priority, timeout, args) VALUES ('prerender_html',",
        param(`prerender-html:${realmURL}`),
        ", 1, 60, '{}') RETURNING id",
      ]);
      jobId = Number(job.id);
    },
  });

  function args(): PrerenderHtmlArgs {
    return {
      realmURL,
      realmUsername: 'lattice-native',
      changes: [{ url: ownerURL, operation: 'update' }],
      generation: 2,
      loaderEpoch: 'old-job-epoch',
      spawningJobId: null,
      coalescedPublishes: null,
      preWarm: false,
    };
  }

  async function advance() {
    await db.withWriteLock(lock, async (tx) => {
      if (!tx) throw new Error('Expected a transaction');
      await tx([
        'UPDATE realm_generations SET current_generation = 3 WHERE realm_url =',
        param(realmURL),
      ]);
      await tx([
        'UPDATE lattice_owners SET published_generation = 3, dirty_generation = NULL WHERE owner_url =',
        param(ownerURL),
      ]);
      await tx([
        'UPDATE boxel_index SET generation = 3, pristine_doc =',
        param(JSON.stringify(document(8, 3).data)),
        'WHERE url =',
        param(ownerURL),
      ]);
      await tx(['NOTIFY jobs']);
    });
  }

  async function response(
    visit: PrerenderVisitArgs,
  ): Promise<RenderVisitResponse> {
    if (!visit.latticeRenderCheckpoint)
      throw new Error('Native job did not provide a checkpoint');
    let receipt = await validateLatticeRenderCheckpoint(
      visit.latticeRenderCheckpoint,
      {
        id: visit.url,
        realmURL,
        loaderEpoch: visit.renderOptions?.loaderEpoch,
      },
    );
    let count = Number(
      visit.latticeRenderCheckpoint.document.data.attributes?.count,
    );
    rendered.push(count);
    await duringRender?.();
    let formats = {
      isolatedHTML: `<p>${count}</p>`,
      headHTML: '<style>p{color:green}</style>',
      atomHTML: `${count}`,
      embeddedHTML: { Day: `<b>${count}</b>` },
      fittedHTML: { Day: `<i>${count}</i>` },
      iconHTML: null,
      markdown: `${count}`,
    };
    return {
      card: {
        ...formats,
        ...(renderFailure
          ? {
              error: {
                type: 'instance-error' as const,
                error: {
                  message: renderFailure,
                  status: 500,
                  additionalErrors: null,
                },
              },
            }
          : {}),
        serialized: null,
        searchDoc: null,
        displayNames: null,
        deps: [`${realmURL}day`],
        types: null,
      },
      fileRender: { ...formats },
      ...(!omitReceipt ? { latticeRenderReceipt: receipt } : {}),
    };
  }

  async function pass(
    overrides: Partial<Parameters<typeof runPrerenderHtmlPass>[0]> = {},
  ) {
    const prerenderer: Prerenderer = {
      prerenderVisit: response,
      async prerenderModule() {
        throw new Error('Unexpected module prewarm');
      },
      async runCommand() {
        throw new Error('Unexpected command');
      },
    };
    const reader: Reader = {
      async readFile() {
        return {
          content: JSON.stringify(document(999)),
          lastModified: 0,
          path: ownerURL,
        };
      },
      async readStream() {
        return undefined;
      },
      async mtimes() {
        return {};
      },
    };
    return runPrerenderHtmlPass({
      ...args(),
      realmURL: new URL(realmURL),
      indexWriter: writer,
      virtualNetwork: new VirtualNetwork(),
      reader,
      prerenderer,
      auth: 'test',
      definitionLookup: {} as DefinitionLookup,
      fetch: async () => {
        throw new Error('Unexpected query or source fetch');
      },
      realmOwnerUserId: '@lattice-native:example',
      dbAdapter: db,
      expandDependencies: false,
      jobInfo: { jobId, reservationId: -1, priority: 1, queueWaitMs: null },
      onLatticeDeferred: async (url) =>
        db.withWriteLock(lock, async (tx) => {
          if (!tx) throw new Error('Expected a transaction');
          await enqueueLatticeRenderRetry(tx, args(), url, jobId, 1);
        }),
      ...overrides,
    });
  }

  test('failure to record delivery obligations rolls back native HTML promotion', async function (assert) {
    await query(db, [
      `CREATE FUNCTION lattice_test_refuse_event() RETURNS trigger LANGUAGE plpgsql AS
       $$ BEGIN RAISE EXCEPTION 'outbox storage unavailable'; END $$`,
    ]);
    await query(db, [
      `CREATE TRIGGER lattice_test_refuse_event BEFORE INSERT ON lattice_publication_events
       FOR EACH ROW EXECUTE FUNCTION lattice_test_refuse_event()`,
    ]);
    await assert.rejects(pass(), /outbox storage unavailable/);
    assert.strictEqual((await html()).isolated_html, '<p>Previous</p>');
    assert.strictEqual(Number((await html()).generation), 1);
    assert.deepEqual(
      await query(db, ['SELECT id FROM lattice_publication_events']),
      [],
    );
    assert.deepEqual(
      await query(db, [
        'SELECT publication_id FROM lattice_publication_deliveries',
      ]),
      [],
    );
  });

  async function html() {
    let [row] = await query(db, [
      "SELECT isolated_html, fitted_html, generation FROM prerendered_html WHERE type = 'instance' AND url =",
      param(ownerURL),
    ]);
    return row;
  }

  async function retryJobs() {
    return query(db, [
      "SELECT id, args, status FROM jobs WHERE args->>'latticeRenderRetryOwner' =",
      param(ownerURL),
    ]);
  }

  test('native pass consumes published input and publishes all native formats', async function (assert) {
    let result = await pass();
    assert.deepEqual(
      rendered,
      [7],
      'published count, not the 999 in the source reader',
    );
    assert.deepEqual(result.invalidations, [ownerURL]);
    assert.deepEqual(
      result.notificationInvalidations,
      [],
      'durable owners bypass the best-effort event bridge',
    );
    let [event] = await query(db, [
      'SELECT owner_url, payload FROM lattice_publication_events',
    ]);
    assert.strictEqual(event.owner_url, ownerURL);
    assert.strictEqual((event.payload as { generation: number }).generation, 2);
    assert.strictEqual((await html()).isolated_html, '<p>7</p>');
    assert.deepEqual(
      (await html()).fitted_html,
      { Day: '<i>7</i>' },
      'all native formats publish together',
    );
    assert.strictEqual(Number((await html()).generation), 2);
    assert.deepEqual(await retryJobs(), []);
  });

  test('ordinary batch completion cannot re-promote a later working-row overwrite of a guarded owner', async function (assert) {
    let batch = await writer.createBatch(
      new URL(realmURL),
      new VirtualNetwork(),
      undefined,
      { prerenderHtmlOnly: true, generation: 2 },
    );
    await batch.seedPrerenderedHtmlInvalidations([
      { url: ownerURL, operation: 'update' },
    ]);
    batch.excludePrerenderedHtmlInvalidation(ownerURL);
    await db.withWriteLock(lock, async (tx) => {
      if (!tx) throw new Error('Expected a transaction');
      await batch.publishLatticePrerenderedHtml(
        new URL(ownerURL),
        [{ type: 'instance', isolatedHtml: '<p>Guarded</p>', deps: [] }],
        2,
        tx,
      );
    });
    // This overwrite is fully committed before ordinary completion starts.
    await query(db, [
      "UPDATE prerendered_html_working SET isolated_html = '<p>Other attempt</p>' WHERE url =",
      param(ownerURL),
    ]);
    await batch.done();
    assert.strictEqual((await html()).isolated_html, '<p>Guarded</p>');
    assert.deepEqual(
      batch.invalidations,
      [],
      'owner is absent from the unfenced swap',
    );
  });

  test('a source change during rendering preserves prior HTML and creates durable work that consumes the latest input', async function (assert) {
    duringRender = advance;
    let first = await pass();
    assert.deepEqual(
      first.invalidations,
      [],
      'no fresh event for discarded HTML',
    );
    assert.strictEqual((await html()).isolated_html, '<p>Previous</p>');
    let retries = await retryJobs();
    assert.strictEqual(retries.length, 1);
    assert.strictEqual(retries[0].status, 'unfulfilled');
    // A new runner can derive the obligation entirely from persisted args.
    duringRender = undefined;
    jobId = Number(retries[0].id);
    let retry = retries[0].args as PrerenderHtmlArgs;
    let second = await pass({
      changes: retry.changes,
      generation: retry.generation,
      loaderEpoch: retry.loaderEpoch,
    });
    assert.deepEqual(rendered, [7, 8]);
    assert.strictEqual((await html()).isolated_html, '<p>8</p>');
    assert.strictEqual(
      Number((await html()).generation),
      3,
      'publication uses captured committed authority, not old queued generation',
    );
    assert.deepEqual(second.invalidations, [ownerURL]);
  });

  test('pending owners do not render and repeated deferral retains only one unreserved successor', async function (assert) {
    await query(db, [
      'UPDATE lattice_owners SET dirty_generation = 3 WHERE owner_url =',
      param(ownerURL),
    ]);
    await pass();
    await pass();
    assert.deepEqual(rendered, []);
    assert.strictEqual((await html()).isolated_html, '<p>Previous</p>');
    assert.strictEqual((await retryJobs()).length, 1);
  });

  test('missing consumption receipt fails closed without promoting working rows', async function (assert) {
    omitReceipt = true;
    await assert.rejects(pass(), /no Lattice receipt/);
    assert.strictEqual((await html()).isolated_html, '<p>Previous</p>');
  });

  test('a failed checkpoint render retains its cause without promoting partial HTML', async function (assert) {
    omitReceipt = true;
    renderFailure = 'The day template could not load its theme';
    await assert.rejects(
      pass(),
      /Lattice HTML render failed.*could not load its theme/,
    );
    assert.strictEqual((await html()).isolated_html, '<p>Previous</p>');
  });

  test('a resumed working row is recomputed from current input instead of being treated as authoritative', async function (assert) {
    await query(db, [
      'INSERT INTO prerendered_html_working (url, file_alias, realm_url, type, generation, isolated_html, is_deleted, job_id) VALUES (',
      param(ownerURL),
      ',',
      param(id),
      ',',
      param(realmURL),
      ", 'instance', 2, '<p>Prior attempt</p>', FALSE,",
      param(jobId),
      ')',
    ]);
    await advance();
    await pass();
    assert.deepEqual(rendered, [8]);
    assert.strictEqual((await html()).isolated_html, '<p>8</p>');
  });

  test('queue admission waits for reverse matching and source work but permits deletion cleanup', async function (assert) {
    await db.withWriteLock(lock, async (tx) => {
      if (!tx) throw new Error('Expected a transaction');
      await enqueueLatticeRenderRetry(tx, args(), ownerURL, jobId, 1);
    });
    let [retry] = await retryJobs();
    const eligible = async () =>
      (
        await query(db, [
          `SELECT j.id FROM jobs j WHERE ${latticeRenderRetryReadySQL} AND j.id =`,
          param(Number(retry.id)),
        ])
      ).length === 1;
    assert.true(await eligible());
    await query(db, [
      'INSERT INTO lattice_pending_generations (realm_url, generation, definition_revision) VALUES (',
      param(realmURL),
      ", 3, 'code-1')",
    ]);
    assert.false(
      await eligible(),
      'reverse matching still has work even though the owner is clean',
    );
    await pass();
    assert.deepEqual(rendered, [], 'a clean owner is not prematurely rendered');
    assert.strictEqual(
      (await retryJobs()).length,
      1,
      'deferral did not lose or duplicate the obligation',
    );
    await query(db, [
      'DELETE FROM lattice_pending_generations WHERE realm_url =',
      param(realmURL),
    ]);
    assert.true(
      await eligible(),
      'unchanged owner becomes eligible when matching finishes',
    );
    let [source] = await query(db, [
      "INSERT INTO jobs (job_type, concurrency_group, priority, timeout, args) VALUES ('incremental-index',",
      param(`indexing:${realmURL}`),
      ", 10, 60, '{}') RETURNING id",
    ]);
    assert.false(await eligible());
    await query(db, [
      "UPDATE jobs SET status = 'rejected' WHERE id =",
      param(Number(source.id)),
    ]);
    assert.false(await eligible(), 'failed source indexing is not freshness');
    await query(db, [
      "UPDATE jobs SET status = 'resolved' WHERE id =",
      param(Number(source.id)),
    ]);
    assert.true(await eligible());
    await query(db, [
      'UPDATE boxel_index SET is_deleted = TRUE, generation = 3 WHERE url =',
      param(ownerURL),
    ]);
    assert.true(
      await eligible(),
      'deleted inputs can reach the normal tombstone path instead of spinning or remaining pending forever',
    );
  });

  test('pending retry uses no worker reservation, survives runner restart and wakes on publication', async function (assert) {
    assert.timeout(20_000);
    await query(db, [
      'UPDATE lattice_owners SET dirty_generation = 3 WHERE owner_url =',
      param(ownerURL),
    ]);
    await pass();
    let [retry] = await retryJobs();
    // The spawning job has handed its obligation to the persisted successor.
    await query(db, [
      "UPDATE jobs SET status = 'resolved' WHERE id =",
      param(jobId),
    ]);
    let publisher = new PgQueuePublisher(db);
    let runner = new PgQueueRunner({
      adapter: db,
      workerId: 'lattice-native-retry-a',
      lattice: new LatticeRealmConfig([realmURL]),
      priority: 1,
    });
    let completed = new Deferred<void>();
    const handler = async (raw: unknown) => {
      let queued = raw as PrerenderHtmlArgs;
      jobId = (raw as { jobInfo: JobInfo }).jobInfo.jobId;
      let result = await pass({
        changes: queued.changes,
        generation: queued.generation,
        loaderEpoch: queued.loaderEpoch,
      });
      completed.fulfill();
      return { invalidations: result.invalidations };
    };
    runner.register('prerender_html', handler);
    runner.register('lattice-marker', async () => ({}));
    try {
      let marker = await publisher.publish({
        jobType: 'lattice-marker',
        args: {},
        priority: 1,
        concurrencyGroup: 'lattice-marker',
        timeout: 10,
      });
      await runner.start();
      await marker.done;
      let [reservations] = await query(db, [
        'SELECT COUNT(*)::int AS count FROM job_reservations WHERE job_id =',
        param(Number(retry.id)),
      ]);
      assert.strictEqual(
        reservations.count,
        0,
        'pending retry never occupied the worker; unrelated work ran',
      );
      assert.deepEqual(rendered, []);
      await runner.destroy();
      runner = new PgQueueRunner({
        adapter: db,
        workerId: 'lattice-native-retry-b',
        lattice: new LatticeRealmConfig([realmURL]),
        priority: 1,
      });
      runner.register('prerender_html', handler);
      await runner.start();
      let started = performance.now();
      await advance();
      await completed.promise;
      assert.true(
        performance.now() - started < 2500,
        'NOTIFY wakes retry without waiting for the ten-second poll',
      );
      assert.deepEqual(rendered, [8]);
      assert.strictEqual((await html()).isolated_html, '<p>8</p>');
    } finally {
      await runner.destroy();
      await publisher.destroy();
    }
  });
});
