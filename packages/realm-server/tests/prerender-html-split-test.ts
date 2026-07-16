import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  IndexWriter,
  VirtualNetwork,
  getQueueJobCoalesceHandler,
  type DefinitionLookup,
  type Diagnostics,
  type IndexingProgressEvent,
  type Prerenderer,
  type QueueCoalesceCandidate,
  type QueueCoalesceContext,
  type QueueJobSpec,
  type Reader,
} from '@cardstack/runtime-common';
import { runPrerenderHtmlPass } from '@cardstack/runtime-common/index-runner/prerender-html-visit';
// Registers the `prerender_html` coalesce handler at load time.
import '@cardstack/runtime-common/tasks/prerender-html';
import type { PrerenderHtmlArgs } from '@cardstack/runtime-common/tasks/prerender-html';
import type { PgAdapter } from '@cardstack/postgres';
import {
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// These tests exercise the pass's visit / tombstone / resume logic, not the
// from-scratch module pre-warm sweep, so they run with `preWarm: false`. The
// pre-warm deps are consumed only on the sweep path, so they can be stubbed —
// spread into each `runPrerenderHtmlPass` call.
const noPreWarmDeps = {
  preWarm: false as const,
  definitionLookup: {} as unknown as DefinitionLookup,
  fetch: (() => {
    throw new Error(
      'fetch is not used by the prerender-html pass when preWarm is false',
    );
  }) as unknown as typeof globalThis.fetch,
  realmOwnerUserId: 'test_realm',
};

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
    coalescedPublishes: null,
    preWarm: false,
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
      assert.strictEqual(
        mergedArgs.coalescedPublishes,
        1,
        'the merged job counts the publish folded into it',
      );
    });

    test('a pending join accumulates the coalesced-publish count across merges', function (assert) {
      let existing = prerenderHtmlArgs({
        generation: 3,
        spawningJobId: 100,
        coalescedPublishes: 2,
      });
      let incoming = prerenderHtmlArgs({
        generation: 4,
        spawningJobId: 200,
      });
      let decision = coalesce(
        context({
          incoming: spec(incoming),
          candidates: [candidate(42, existing)],
        }),
      );
      assert.strictEqual(decision.type, 'join');
      if (decision.type !== 'join') {
        throw new Error('expected a join decision');
      }
      let mergedArgs = decision.update?.args as PrerenderHtmlArgs;
      assert.strictEqual(
        mergedArgs.coalescedPublishes,
        3,
        'earlier merges stay counted when another publish folds in',
      );
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

    test('a pending merge preserves the pre-warm bit with OR semantics', function (assert) {
      // A from-scratch-spawned publish (preWarm) merged with incremental-
      // spawned work must keep the sweep; direction must not matter.
      for (let [existingPreWarm, incomingPreWarm] of [
        [true, false],
        [false, true],
        [true, true],
      ] as const) {
        let existing = prerenderHtmlArgs({ preWarm: existingPreWarm });
        let incoming = prerenderHtmlArgs({ preWarm: incomingPreWarm });
        let decision = coalesce(
          context({
            incoming: spec(incoming),
            candidates: [candidate(42, existing)],
          }),
        );
        assert.strictEqual(decision.type, 'join');
        if (decision.type !== 'join') {
          throw new Error('expected a join decision');
        }
        let mergedArgs = decision.update?.args as PrerenderHtmlArgs;
        assert.true(
          mergedArgs.preWarm,
          `pre-warm survives merging preWarm=${existingPreWarm} with preWarm=${incomingPreWarm}`,
        );
      }
    });

    test('a pending merge of two incremental-spawned publishes stays pre-warm-free', function (assert) {
      let existing = prerenderHtmlArgs({ preWarm: false });
      let incoming = prerenderHtmlArgs({ preWarm: false });
      let decision = coalesce(
        context({
          incoming: spec(incoming),
          candidates: [candidate(42, existing)],
        }),
      );
      assert.strictEqual(decision.type, 'join');
      if (decision.type !== 'join') {
        throw new Error('expected a join decision');
      }
      let mergedArgs = decision.update?.args as PrerenderHtmlArgs;
      assert.false(
        mergedArgs.preWarm,
        'merging two incremental spawns never conjures a realm-wide sweep',
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
      opts: {
        deps?: string[];
        info?: ReturnType<typeof jobInfo>;
        diagnostics?: Diagnostics;
      } = {},
    ) {
      let batch = await makeBatch(generation, opts.info);
      await batch.seedPrerenderedHtmlInvalidations([
        { url, operation: 'update' },
      ]);
      await batch.updatePrerenderedHtmlEntry(new URL(url), {
        type: 'instance',
        isolatedHtml: html,
        deps: opts.deps ?? [],
        ...(opts.diagnostics ? { diagnostics: opts.diagnostics } : {}),
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
        error_doc: {
          message?: string;
          diagnostics?: Record<string, unknown>;
        } | null;
        deps: string[] | null;
        last_known_good_deps: string[] | null;
        diagnostics: Record<string, unknown> | null;
      }[];
      return rows[0];
    }

    function stubReader(contents: Map<string, string>): Reader {
      return {
        async readFile(url: URL) {
          let content = contents.get(url.href);
          if (content === undefined) {
            return undefined;
          }
          return { content, lastModified: 0, path: url.href };
        },
        async readStream() {
          return undefined;
        },
        async mtimes() {
          return {};
        },
      };
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

    test('persists the render diagnostics with a rendered row', async function (assert) {
      let url = `${testRealm}1.json`;
      let diagnostics: Diagnostics = {
        prerenderHtmlRequestId: 'render-req-1',
        launchMs: 5,
        renderElapsedMs: 100,
        totalElapsedMs: 105,
        renderFormatsMs: { card: { isolated: 80, fitted: 12 } },
      };
      await writeInstance(1, url, '<h1>v1</h1>', { diagnostics });

      let row = await productionRow(url);
      assert.deepEqual(
        row.diagnostics,
        diagnostics as Record<string, unknown>,
        'the render diagnostics ride the row through the swap',
      );
      assert.strictEqual(row.error_doc, null);
    });

    test('a render error persists the failing render diagnostics and mirrors them onto the error doc', async function (assert) {
      let url = `${testRealm}1.json`;
      await writeInstance(1, url, '<h1>good</h1>', {
        diagnostics: {
          prerenderHtmlRequestId: 'good-render',
          renderElapsedMs: 50,
        },
      });

      let failing: Diagnostics = {
        prerenderHtmlRequestId: 'failing-render',
        renderElapsedMs: 30_000,
        renderStage: 'waiting-stability',
      };
      let batch = await makeBatch(2);
      await batch.seedPrerenderedHtmlInvalidations([
        { url, operation: 'update' },
      ]);
      await batch.updatePrerenderedHtmlEntry(new URL(url), {
        type: 'instance-error',
        error: { message: 'boom', status: 500, additionalErrors: null },
        diagnostics: failing,
      });
      await batch.done();

      let row = await productionRow(url);
      assert.strictEqual(
        row.isolated_html,
        '<h1>good</h1>',
        'the last-known-good HTML is preserved through the error cycle',
      );
      assert.deepEqual(
        row.diagnostics,
        failing as Record<string, unknown>,
        "the failing render's diagnostics land on the row — not the last-known-good render's",
      );
      assert.deepEqual(
        row.error_doc?.diagnostics,
        failing as Record<string, unknown>,
        'the same payload is mirrored onto the error doc',
      );
    });

    test('a tombstone clears the prior render diagnostics', async function (assert) {
      let url = `${testRealm}1.json`;
      await writeInstance(1, url, '<h1>v1</h1>', {
        diagnostics: { prerenderHtmlRequestId: 'render-req-1' },
      });

      let deleteBatch = await makeBatch(2);
      await deleteBatch.seedPrerenderedHtmlInvalidations([
        { url, operation: 'delete' },
      ]);
      await deleteBatch.done();

      let row = await productionRow(url);
      assert.true(Boolean(row.is_deleted), 'the delete tombstones the row');
      assert.strictEqual(
        row.diagnostics,
        null,
        'the tombstone clears the diagnostics of the render it hides',
      );
    });

    test('the pass persists the visit meta as render diagnostics, keyed by prerenderHtmlRequestId', async function (assert) {
      let cardURL = `${testRealm}pine.json`;
      let cardJSON = JSON.stringify({
        data: {
          type: 'card',
          meta: { adoptsFrom: { module: `${testRealm}pine`, name: 'Pine' } },
        },
      });
      let prerenderer: Prerenderer = {
        async prerenderVisit() {
          return {
            card: {
              serialized: null,
              searchDoc: null,
              displayNames: null,
              deps: [`${testRealm}pine`],
              types: null,
              isolatedHTML: '<h1>pine</h1>',
              headHTML: null,
              atomHTML: null,
              embeddedHTML: null,
              fittedHTML: null,
              iconHTML: null,
              markdown: null,
            },
            fileRender: {
              isolatedHTML: '<pre>pine</pre>',
              headHTML: null,
              atomHTML: null,
              embeddedHTML: null,
              fittedHTML: null,
              iconHTML: null,
              markdown: null,
            },
            meta: {
              requestId: 'render-req-9',
              diagnostics: {
                launchMs: 5,
                renderElapsedMs: 100,
                renderFormatsMs: {
                  card: { isolated: 80 },
                  file: { isolated: 6 },
                },
              },
            },
          };
        },
        async prerenderModule() {
          throw new Error('not used by the prerender-html pass');
        },
        async runCommand() {
          throw new Error('not used by the prerender-html pass');
        },
      };
      await runPrerenderHtmlPass({
        realmURL: new URL(testRealm),
        changes: [{ url: cardURL, operation: 'update' }],
        generation: 1,
        loaderEpoch: 'epoch-a',
        ...noPreWarmDeps,
        indexWriter,
        virtualNetwork,
        reader: stubReader(new Map([[cardURL, cardJSON]])),
        prerenderer,
        auth: 'test-auth',
        jobInfo: jobInfo(),
      });

      // The visit's HTTP correlation id lands under `prerenderHtmlRequestId`
      // — never `requestId`, which always names an index visit — and one
      // visit produces both of a URL's rows, so the same blob lands on both.
      let expected = {
        launchMs: 5,
        renderElapsedMs: 100,
        renderFormatsMs: { card: { isolated: 80 }, file: { isolated: 6 } },
        prerenderHtmlRequestId: 'render-req-9',
      };
      let instanceRow = await productionRow(cardURL, 'instance');
      assert.deepEqual(instanceRow.diagnostics, expected);
      let fileRow = await productionRow(cardURL, 'file');
      assert.deepEqual(fileRow.diagnostics, expected);
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

    module('progress reporting', function () {
      function stubPrerenderer(
        visit: (url: string) => void = () => {},
      ): Prerenderer {
        return {
          async prerenderVisit(args) {
            visit(args.url);
            return {
              fileRender: {
                isolatedHTML: '<pre>rendered</pre>',
                headHTML: null,
                atomHTML: null,
                embeddedHTML: null,
                fittedHTML: null,
                iconHTML: null,
                markdown: null,
              },
            };
          },
          async prerenderModule() {
            throw new Error('not used by the prerender-html pass');
          },
          async runCommand() {
            throw new Error('not used by the prerender-html pass');
          },
        };
      }

      test('the pass reports started / file-visited / finished with the real totals', async function (assert) {
        let events: IndexingProgressEvent[] = [];
        let visited: string[] = [];
        let info = jobInfo();
        await runPrerenderHtmlPass({
          realmURL: new URL(testRealm),
          changes: [
            { url: `${testRealm}a.txt`, operation: 'update' },
            // Duplicate of the first URL — deduped out of the total.
            { url: `${testRealm}a.txt`, operation: 'update' },
            { url: `${testRealm}b.txt`, operation: 'update' },
            // File missing on disk — never reaches the prerenderer, but
            // still advances the counter.
            { url: `${testRealm}missing.txt`, operation: 'update' },
            // Deletion — never visited, still advances the counter.
            { url: `${testRealm}gone.txt`, operation: 'delete' },
          ],
          generation: 1,
          loaderEpoch: 'epoch-a',
          indexWriter,
          virtualNetwork,
          reader: stubReader(
            new Map([
              [`${testRealm}a.txt`, 'alpha'],
              [`${testRealm}b.txt`, 'beta'],
            ]),
          ),
          prerenderer: stubPrerenderer((url) => visited.push(url)),
          auth: 'test-auth',
          jobInfo: info,
          onProgress: (event) => events.push(event),
          ...noPreWarmDeps,
        });

        assert.deepEqual(
          visited,
          [`${testRealm}a.txt`, `${testRealm}b.txt`],
          'only readable update URLs reach the prerenderer',
        );

        let [started, ...rest] = events;
        let finished = rest.pop();
        assert.deepEqual(
          started,
          {
            type: 'indexing-started',
            realmURL: testRealm,
            jobId: info.jobId,
            jobType: 'prerender_html',
            totalFiles: 4,
            files: [],
          },
          'started carries the deduped total and the queue job-type label',
        );
        assert.deepEqual(
          rest.map((e) => [e.type, e.url, e.filesCompleted, e.totalFiles]),
          [
            ['file-visited', `${testRealm}a.txt`, 1, 4],
            ['file-visited', `${testRealm}b.txt`, 2, 4],
            ['file-visited', `${testRealm}missing.txt`, 3, 4],
            ['file-visited', `${testRealm}gone.txt`, 4, 4],
          ],
          'every URL in the set advances the counter — rendered, missing, and deleted alike',
        );
        assert.strictEqual(finished?.type, 'indexing-finished');
        assert.strictEqual(
          finished?.stats?.filesIndexed,
          2,
          'finished carries the pass stats',
        );
      });

      test('a visit failure still emits indexing-finished so consumers clear the job', async function (assert) {
        let events: IndexingProgressEvent[] = [];
        let prerenderer: Prerenderer = {
          ...stubPrerenderer(),
          async prerenderVisit() {
            throw new Error('renderer died');
          },
        };
        await assert.rejects(
          runPrerenderHtmlPass({
            realmURL: new URL(testRealm),
            changes: [{ url: `${testRealm}a.txt`, operation: 'update' }],
            generation: 1,
            loaderEpoch: 'epoch-a',
            indexWriter,
            virtualNetwork,
            reader: stubReader(new Map([[`${testRealm}a.txt`, 'alpha']])),
            prerenderer,
            auth: 'test-auth',
            jobInfo: jobInfo(),
            onProgress: (event) => events.push(event),
            ...noPreWarmDeps,
          }),
          /renderer died/,
        );
        assert.deepEqual(
          events.map((e) => e.type),
          ['indexing-started', 'indexing-finished'],
          'the stream terminates even when the pass dies mid-visit',
        );
      });
    });
  });
});
