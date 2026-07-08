import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  IndexWriter,
  VirtualNetwork,
  getQueueJobCoalesceHandler,
  type QueueCoalesceCandidate,
  type QueueCoalesceContext,
  type QueueJobSpec,
} from '@cardstack/runtime-common';
// Registers the `prerender_html` coalesce handler at load time.
import '@cardstack/runtime-common/tasks/prerender-html';
import type { PrerenderHtmlArgs } from '@cardstack/runtime-common/tasks/prerender-html';
import type { PgAdapter } from '@cardstack/postgres';
import {
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

function prerenderHtmlArgs(
  overrides: Partial<PrerenderHtmlArgs> = {},
): PrerenderHtmlArgs {
  return {
    realmURL: testRealm,
    realmUsername: 'test_realm',
    changes: [{ url: `${testRealm}1.json`, operation: 'update' }],
    generation: 1,
    loaderEpoch: 'epoch-a',
    spawningJobId: 100,
    ...overrides,
  };
}

function spec(
  args: unknown,
  overrides: Partial<QueueJobSpec> = {},
): QueueJobSpec {
  return {
    jobType: 'prerender_html',
    concurrencyGroup: `prerender-html:${testRealm}`,
    timeout: 600,
    priority: 0,
    args: args as QueueJobSpec['args'],
    ...overrides,
  };
}

function candidate(
  id: number,
  args: unknown,
  overrides: Partial<QueueJobSpec> = {},
): QueueCoalesceCandidate {
  return { id, ...spec(args, overrides) };
}

function context(
  overrides: Partial<QueueCoalesceContext> = {},
): QueueCoalesceContext {
  return {
    incoming: spec(prerenderHtmlArgs()),
    candidates: [],
    inFlightCandidates: [],
    ...overrides,
  };
}

module(basename(import.meta.filename), function () {
  module('prerender_html coalesce decision', function () {
    let coalesce = getQueueJobCoalesceHandler('prerender_html')!;

    test('a coalesce handler is registered for prerender_html', function (assert) {
      assert.ok(coalesce, 'handler is registered');
    });

    test('inserts when there is no candidate to merge into', function (assert) {
      let decision = coalesce(context());
      assert.deepEqual(decision, { type: 'insert' });
    });

    test('joins a pending job, merging changes update-wins and taking the max generation', function (assert) {
      let existing = prerenderHtmlArgs({
        changes: [
          { url: `${testRealm}1.json`, operation: 'delete' },
          { url: `${testRealm}2.json`, operation: 'update' },
        ],
        generation: 3,
        loaderEpoch: 'epoch-old',
        spawningJobId: 100,
      });
      let incoming = prerenderHtmlArgs({
        changes: [
          { url: `${testRealm}1.json`, operation: 'update' },
          { url: `${testRealm}3.json`, operation: 'update' },
        ],
        generation: 4,
        loaderEpoch: 'epoch-new',
        spawningJobId: 200,
      });
      let decision = coalesce(
        context({
          incoming: spec(incoming, { priority: 9, timeout: 300 }),
          candidates: [candidate(42, existing, { priority: 0, timeout: 600 })],
        }),
      );
      assert.strictEqual(decision.type, 'join');
      if (decision.type !== 'join') {
        throw new Error('expected a join decision');
      }
      assert.strictEqual(decision.jobId, 42);
      assert.strictEqual(
        decision.update?.priority,
        9,
        'priority is the max across publishes',
      );
      assert.strictEqual(
        decision.update?.timeout,
        600,
        'timeout is the max across publishes',
      );
      let mergedArgs = decision.update?.args as PrerenderHtmlArgs;
      assert.strictEqual(
        mergedArgs.generation,
        4,
        'generation is the max across publishes',
      );
      assert.strictEqual(
        mergedArgs.loaderEpoch,
        'epoch-new',
        'the loader epoch rides with the max generation',
      );
      assert.strictEqual(
        mergedArgs.spawningJobId,
        200,
        'the spawning job id follows the newest publish',
      );
      let byUrl = new Map(
        mergedArgs.changes.map((change) => [change.url, change.operation]),
      );
      assert.strictEqual(
        byUrl.get(`${testRealm}1.json`),
        'update',
        'update wins across merged changes: a pending delete must not swallow a later re-create',
      );
      assert.strictEqual(byUrl.get(`${testRealm}2.json`), 'update');
      assert.strictEqual(byUrl.get(`${testRealm}3.json`), 'update');
      assert.strictEqual(mergedArgs.changes.length, 3, 'URLs are deduped');
    });

    test('a pending merge keeps update over a later delete: the visit consults disk truth', function (assert) {
      // The render of an update-tagged URL whose file is gone writes
      // nothing, so the up-front tombstone lands the deletion anyway —
      // keeping 'update' is safe in both merge directions.
      let existing = prerenderHtmlArgs({
        changes: [{ url: `${testRealm}1.json`, operation: 'update' }],
        generation: 3,
        loaderEpoch: 'epoch-1',
        spawningJobId: 100,
      });
      let incoming = prerenderHtmlArgs({
        changes: [{ url: `${testRealm}1.json`, operation: 'delete' }],
        generation: 4,
        loaderEpoch: 'epoch-1',
        spawningJobId: 200,
      });
      let decision = coalesce(
        context({
          incoming: spec(incoming, { priority: 0, timeout: 300 }),
          candidates: [candidate(42, existing, { priority: 0, timeout: 300 })],
        }),
      );
      assert.strictEqual(decision.type, 'join');
      if (decision.type !== 'join') {
        throw new Error('expected a join decision');
      }
      let mergedArgs = decision.update?.args as PrerenderHtmlArgs;
      assert.deepEqual(
        mergedArgs.changes,
        [{ url: `${testRealm}1.json`, operation: 'update' }],
        'the merged job visits the URL and lets the missing file tombstone it',
      );
      assert.strictEqual(
        mergedArgs.generation,
        4,
        'generation is still the max across publishes',
      );
    });

    test('joins a pending job with only priority/timeout when args are unparseable', function (assert) {
      let decision = coalesce(
        context({
          incoming: spec(prerenderHtmlArgs(), { priority: 9 }),
          candidates: [candidate(7, { bogus: true })],
        }),
      );
      assert.strictEqual(decision.type, 'join');
      if (decision.type !== 'join') {
        throw new Error('expected a join decision');
      }
      assert.strictEqual(decision.jobId, 7);
      assert.strictEqual(decision.update?.priority, 9);
      assert.strictEqual(
        decision.update?.args,
        undefined,
        'unparseable args are left untouched',
      );
    });

    test('joins an in-flight job whose changes cover the incoming set at an equal-or-newer generation', function (assert) {
      let inFlight = prerenderHtmlArgs({
        changes: [
          { url: `${testRealm}1.json`, operation: 'update' },
          { url: `${testRealm}2.json`, operation: 'update' },
        ],
        generation: 5,
      });
      let incoming = prerenderHtmlArgs({
        changes: [{ url: `${testRealm}1.json`, operation: 'update' }],
        generation: 5,
      });
      let decision = coalesce(
        context({
          incoming: spec(incoming),
          inFlightCandidates: [candidate(9, inFlight)],
        }),
      );
      assert.deepEqual(decision, { type: 'join', jobId: 9 });
    });

    test('inserts rather than joining an in-flight job at an older generation', function (assert) {
      let inFlight = prerenderHtmlArgs({ generation: 4 });
      let incoming = prerenderHtmlArgs({ generation: 5 });
      let decision = coalesce(
        context({
          incoming: spec(incoming),
          inFlightCandidates: [candidate(9, inFlight)],
        }),
      );
      assert.deepEqual(decision, { type: 'insert' });
    });

    test('a pending join keeps the existing epoch when the existing publish is newer', function (assert) {
      let existing = prerenderHtmlArgs({
        generation: 6,
        loaderEpoch: 'epoch-new',
        spawningJobId: 300,
      });
      let incoming = prerenderHtmlArgs({
        generation: 5,
        loaderEpoch: 'epoch-old',
        spawningJobId: 400,
      });
      let decision = coalesce(
        context({
          incoming: spec(incoming),
          candidates: [candidate(11, existing)],
        }),
      );
      assert.strictEqual(decision.type, 'join');
      if (decision.type !== 'join') {
        throw new Error('expected a join decision');
      }
      let mergedArgs = decision.update?.args as PrerenderHtmlArgs;
      assert.strictEqual(mergedArgs.generation, 6);
      assert.strictEqual(
        mergedArgs.loaderEpoch,
        'epoch-new',
        'the loader epoch stays with the newest generation',
      );
      assert.strictEqual(
        mergedArgs.spawningJobId,
        300,
        'correlation stays with the newest generation too',
      );
    });

    test('inserts rather than joining an in-flight job whose loader epoch differs', function (assert) {
      let inFlight = prerenderHtmlArgs({ loaderEpoch: 'epoch-a' });
      let incoming = prerenderHtmlArgs({ loaderEpoch: 'epoch-b' });
      let decision = coalesce(
        context({
          incoming: spec(incoming),
          inFlightCandidates: [candidate(9, inFlight)],
        }),
      );
      assert.deepEqual(decision, { type: 'insert' });
    });

    test('inserts rather than joining an in-flight job whose operations differ', function (assert) {
      let inFlight = prerenderHtmlArgs({
        changes: [{ url: `${testRealm}1.json`, operation: 'update' }],
      });
      let incoming = prerenderHtmlArgs({
        changes: [{ url: `${testRealm}1.json`, operation: 'delete' }],
      });
      let decision = coalesce(
        context({
          incoming: spec(incoming),
          inFlightCandidates: [candidate(9, inFlight)],
        }),
      );
      assert.deepEqual(decision, { type: 'insert' });
    });
  });

  module('prerenderHtmlOnly batch', function (hooks) {
    let adapter: PgAdapter;
    let indexWriter: IndexWriter;
    let virtualNetwork: VirtualNetwork;
    let jobCounter = 1000;

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
      indexWriter = new IndexWriter(adapter);
      virtualNetwork = new VirtualNetwork();
    });

    hooks.afterEach(async function () {
      await adapter.close();
    });

    function jobInfo() {
      return { jobId: jobCounter++, reservationId: 1, priority: 0 };
    }

    async function makeBatch(generation: number, info = jobInfo()) {
      return await indexWriter.createBatch(
        new URL(testRealm),
        virtualNetwork,
        info,
        { prerenderHtmlOnly: true, generation },
      );
    }

    async function writeInstance(
      generation: number,
      url: string,
      html: string,
      opts: { deps?: string[]; info?: ReturnType<typeof jobInfo> } = {},
    ) {
      let batch = await makeBatch(generation, opts.info);
      await batch.seedPrerenderedHtmlInvalidations([
        { url, operation: 'update' },
      ]);
      await batch.updatePrerenderedHtmlEntry(new URL(url), {
        type: 'instance',
        isolatedHtml: html,
        deps: opts.deps ?? [],
      });
      await batch.done();
    }

    async function productionRow(url: string, type = 'instance') {
      let rows = (await adapter.execute(
        `SELECT * FROM prerendered_html WHERE url = $1 AND type = $2`,
        { bind: [url, type] },
      )) as {
        isolated_html: string | null;
        generation: number;
        is_deleted: boolean | null;
        error_doc: { message?: string } | null;
        deps: string[] | null;
        last_known_good_deps: string[] | null;
      }[];
      return rows[0];
    }

    test('writes rendered rows and swaps them under the carried generation', async function (assert) {
      let url = `${testRealm}1.json`;
      await writeInstance(5, url, '<h1>v5</h1>');
      let row = await productionRow(url);
      assert.strictEqual(row.isolated_html, '<h1>v5</h1>');
      assert.strictEqual(row.generation, 5);
      assert.false(Boolean(row.is_deleted));
      assert.strictEqual(row.error_doc, null);
    });

    test('the swap is monotonic: an older generation is a no-op, an equal generation is idempotent, a newer generation wins', async function (assert) {
      let url = `${testRealm}1.json`;
      await writeInstance(5, url, '<h1>v5</h1>');

      await writeInstance(4, url, '<h1>zombie v4</h1>');
      let row = await productionRow(url);
      assert.strictEqual(
        row.isolated_html,
        '<h1>v5</h1>',
        'a lower-generation write is rejected per-row',
      );
      assert.strictEqual(row.generation, 5);

      await writeInstance(5, url, '<h1>v5 retry</h1>');
      row = await productionRow(url);
      assert.strictEqual(
        row.isolated_html,
        '<h1>v5 retry</h1>',
        'an equal-generation retry lands',
      );

      await writeInstance(6, url, '<h1>v6</h1>');
      row = await productionRow(url);
      assert.strictEqual(row.isolated_html, '<h1>v6</h1>');
      assert.strictEqual(row.generation, 6);
    });

    test('a newer-generation tombstone survives a zombie older-generation render', async function (assert) {
      let url = `${testRealm}1.json`;
      await writeInstance(5, url, '<h1>v5</h1>');

      let deleteBatch = await makeBatch(6);
      await deleteBatch.seedPrerenderedHtmlInvalidations([
        { url, operation: 'delete' },
      ]);
      await deleteBatch.done();
      let row = await productionRow(url);
      assert.true(Boolean(row.is_deleted), 'the delete tombstones the row');
      assert.strictEqual(row.generation, 6);

      await writeInstance(5, url, '<h1>zombie</h1>');
      row = await productionRow(url);
      assert.true(
        Boolean(row.is_deleted),
        'the tombstone survives the zombie render',
      );
      assert.strictEqual(row.generation, 6);
    });

    test('seeding tombstones every existing production type up front; the visit overwrites survivors', async function (assert) {
      let url = `${testRealm}1.json`;
      let seedBatch = await makeBatch(1);
      await seedBatch.seedPrerenderedHtmlInvalidations([
        { url, operation: 'update' },
      ]);
      await seedBatch.updatePrerenderedHtmlEntry(new URL(url), {
        type: 'instance',
        isolatedHtml: '<h1>instance</h1>',
        deps: [],
      });
      await seedBatch.updatePrerenderedHtmlEntry(new URL(url), {
        type: 'file',
        isolatedHtml: '<h1>file</h1>',
        deps: [],
      });
      await seedBatch.done();

      let batch = await makeBatch(2, jobInfo());
      await batch.seedPrerenderedHtmlInvalidations([
        { url, operation: 'update' },
      ]);
      let workingRows = (await adapter.execute(
        `SELECT type, is_deleted, generation FROM prerendered_html_working WHERE url = $1 ORDER BY type`,
        { bind: [url] },
      )) as { type: string; is_deleted: boolean; generation: number }[];
      assert.deepEqual(
        workingRows.map((r) => ({
          type: r.type,
          is_deleted: Boolean(r.is_deleted),
          generation: r.generation,
        })),
        [
          { type: 'file', is_deleted: true, generation: 2 },
          { type: 'instance', is_deleted: true, generation: 2 },
        ],
        'the whole set is tombstoned up front in the working table',
      );

      await batch.updatePrerenderedHtmlEntry(new URL(url), {
        type: 'instance',
        isolatedHtml: '<h1>instance v2</h1>',
        deps: [],
      });
      await batch.done();

      let instanceRow = await productionRow(url, 'instance');
      assert.strictEqual(instanceRow.isolated_html, '<h1>instance v2</h1>');
      assert.false(Boolean(instanceRow.is_deleted));
      let fileRow = await productionRow(url, 'file');
      assert.true(
        Boolean(fileRow.is_deleted),
        'a type the visit did not overwrite stays tombstoned',
      );
    });

    test('a render error preserves the last-known-good HTML and records the error', async function (assert) {
      let url = `${testRealm}1.json`;
      await writeInstance(1, url, '<h1>good</h1>', {
        deps: [`${testRealm}dep.gts`],
      });

      let batch = await makeBatch(2);
      await batch.seedPrerenderedHtmlInvalidations([
        { url, operation: 'update' },
      ]);
      await batch.updatePrerenderedHtmlEntry(new URL(url), {
        type: 'instance-error',
        error: {
          message: 'boom',
          status: 500,
          additionalErrors: null,
          deps: [`${testRealm}broken-module`],
        },
      });
      await batch.done();

      let row = await productionRow(url);
      assert.strictEqual(row.generation, 2);
      assert.strictEqual(
        row.isolated_html,
        '<h1>good</h1>',
        'the last-known-good HTML is preserved through the error cycle',
      );
      assert.ok(
        row.last_known_good_deps?.includes(`${testRealm}dep.gts`),
        'last-known-good deps are preserved',
      );
      assert.strictEqual(row.error_doc?.message, 'boom');
      assert.ok(
        row.deps?.includes(`${testRealm}broken-module`),
        "the failing render's own deps join the row deps so fixing one fans out to this row",
      );
      assert.ok(
        row.deps?.includes(`${testRealm}dep.gts`),
        'prior production deps are retained alongside the error deps',
      );
    });

    test('a render error on a URL with no production row lands an error row with empty HTML', async function (assert) {
      let url = `${testRealm}brand-new.json`;
      let batch = await makeBatch(1);
      await batch.seedPrerenderedHtmlInvalidations([
        { url, operation: 'update' },
      ]);
      await batch.updatePrerenderedHtmlEntry(new URL(url), {
        type: 'instance-error',
        error: { message: 'boom', status: 500, additionalErrors: null },
      });
      await batch.done();

      let row = await productionRow(url);
      assert.strictEqual(row.isolated_html, null);
      assert.strictEqual(row.error_doc?.message, 'boom');
    });

    test('a retry resumes rows the prior attempt rendered instead of tombstoning them', async function (assert) {
      let url = `${testRealm}1.json`;
      let info = jobInfo();
      let attempt1 = await makeBatch(3, info);
      await attempt1.seedPrerenderedHtmlInvalidations([
        { url, operation: 'update' },
      ]);
      await attempt1.updatePrerenderedHtmlEntry(new URL(url), {
        type: 'instance',
        isolatedHtml: '<h1>attempt 1</h1>',
        deps: [],
      });
      // No done() — the attempt dies before its swap.

      let attempt2 = await makeBatch(3, { ...info, reservationId: 2 });
      assert.true(
        attempt2.resumedRows.has(url),
        'the retry resumes the prior attempt’s rendered row',
      );
      await attempt2.seedPrerenderedHtmlInvalidations([
        { url, operation: 'update' },
      ]);
      let workingRows = (await adapter.execute(
        `SELECT is_deleted, isolated_html FROM prerendered_html_working WHERE url = $1`,
        { bind: [url] },
      )) as { is_deleted: boolean | null; isolated_html: string | null }[];
      assert.strictEqual(
        workingRows[0].isolated_html,
        '<h1>attempt 1</h1>',
        'seeding does not tombstone over the resumed row',
      );
      assert.false(Boolean(workingRows[0].is_deleted));
      await attempt2.done();

      let row = await productionRow(url);
      assert.strictEqual(
        row.isolated_html,
        '<h1>attempt 1</h1>',
        'the resumed row is promoted by the retry’s swap',
      );
    });

    test('loaderEpoch: instance-only invalidations carry the stored epoch; executable invalidations mint a fresh one', async function (assert) {
      // Brand-new realm: no pass has committed an epoch yet.
      let instanceBatch = await indexWriter.createBatch(
        new URL(testRealm),
        virtualNetwork,
        jobInfo(),
      );
      await instanceBatch.invalidate([new URL(`${testRealm}1.json`)]);
      assert.strictEqual(
        instanceBatch.loaderEpoch,
        '0',
        'an instance-only pass carries the no-epoch-yet sentinel',
      );
      await instanceBatch.done();

      let moduleBatch = await indexWriter.createBatch(
        new URL(testRealm),
        virtualNetwork,
        jobInfo(),
      );
      await moduleBatch.invalidate([new URL(`${testRealm}some-module.gts`)]);
      let minted = moduleBatch.loaderEpoch;
      assert.notStrictEqual(
        minted,
        '0',
        'an executable invalidation mints a fresh epoch',
      );
      assert.strictEqual(
        moduleBatch.loaderEpoch,
        minted,
        'the minted epoch is stable across reads within the batch',
      );
      await moduleBatch.done();

      let followupBatch = await indexWriter.createBatch(
        new URL(testRealm),
        virtualNetwork,
        jobInfo(),
      );
      await followupBatch.invalidate([new URL(`${testRealm}2.json`)]);
      assert.strictEqual(
        followupBatch.loaderEpoch,
        minted,
        'a later instance-only pass carries the committed epoch forward',
      );
      await followupBatch.done();

      let laterModuleBatch = await indexWriter.createBatch(
        new URL(testRealm),
        virtualNetwork,
        jobInfo(),
      );
      await laterModuleBatch.invalidate([new URL(`${testRealm}other.gts`)]);
      assert.notStrictEqual(
        laterModuleBatch.loaderEpoch,
        minted,
        'the next module change mints a different epoch',
      );
    });

    test('loaderEpoch: noted URLs feed the executable scan without joining the invalidation set', async function (assert) {
      // The from-scratch pass determines its URL list outside invalidate();
      // noting the list must fix the epoch before any visit or enqueue.
      let batch = await indexWriter.createBatch(
        new URL(testRealm),
        virtualNetwork,
        jobInfo(),
      );
      batch.noteInvalidatedURLs([
        `${testRealm}1.json`,
        `${testRealm}some-module.gts`,
      ]);
      assert.notStrictEqual(
        batch.loaderEpoch,
        '0',
        'noting an executable URL mints a fresh epoch',
      );
      assert.deepEqual(
        batch.invalidations,
        [],
        'noted URLs do not join the invalidation set',
      );
    });

    test('loaderEpoch: an uncommitted mint never becomes the stored epoch', async function (assert) {
      let moduleBatch = await indexWriter.createBatch(
        new URL(testRealm),
        virtualNetwork,
        jobInfo(),
      );
      await moduleBatch.invalidate([new URL(`${testRealm}some-module.gts`)]);
      assert.notStrictEqual(moduleBatch.loaderEpoch, '0');
      // No done() — the pass dies before its swap.

      let nextBatch = await indexWriter.createBatch(
        new URL(testRealm),
        virtualNetwork,
        jobInfo(),
      );
      await nextBatch.invalidate([new URL(`${testRealm}1.json`)]);
      assert.strictEqual(
        nextBatch.loaderEpoch,
        '0',
        'the stored epoch only moves when the minting pass commits',
      );
    });

    test('mode guards: channel-specific methods refuse the wrong batch kind', async function (assert) {
      let prerenderBatch = await makeBatch(1);
      await assert.rejects(
        prerenderBatch.updateEntry(new URL(`${testRealm}1.json`), {
          type: 'instance',
        } as Parameters<typeof prerenderBatch.updateEntry>[1]),
        /writes only the prerendered_html channel/,
      );
      await assert.rejects(
        prerenderBatch.invalidate([new URL(`${testRealm}1.json`)]),
        /does not compute invalidations/,
      );

      let indexBatch = await indexWriter.createBatch(
        new URL(testRealm),
        virtualNetwork,
        jobInfo(),
      );
      await assert.rejects(
        indexBatch.seedPrerenderedHtmlInvalidations([
          { url: `${testRealm}1.json`, operation: 'update' },
        ]),
        /only valid on a prerenderHtmlOnly batch/,
      );
      await assert.rejects(
        indexBatch.updatePrerenderedHtmlEntry(new URL(`${testRealm}1.json`), {
          type: 'instance',
          deps: [],
        }),
        /only valid on a prerenderHtmlOnly batch/,
      );

      await assert.rejects(
        indexWriter.createBatch(new URL(testRealm), virtualNetwork, jobInfo(), {
          prerenderHtmlOnly: true,
        }),
        /requires an explicit generation/,
      );
    });
  });
});
