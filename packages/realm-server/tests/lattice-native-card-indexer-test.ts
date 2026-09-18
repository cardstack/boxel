import { configureLatticeTrace } from '@cardstack/runtime-common/lattice-trace';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { basename } from 'node:path';
import QUnit from 'qunit';
import { createHash } from 'node:crypto';
import { bxl, getBxlComputeDefinition } from '@cardstack/bxl';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  RealmPaths,
  VirtualNetwork,
  param,
  rri,
  type Batch,
  type Prerenderer,
  type PrerenderVisitArgs,
  type Reader,
} from '@cardstack/runtime-common';
import { renderFileForIndexing } from '@cardstack/runtime-common/index-runner/visit-file';
import { performFileIndexing } from '@cardstack/runtime-common/index-runner/file-indexer';
import { performCardIndexing } from '@cardstack/runtime-common/index-runner/card-indexer';
import { IndexRunnerDependencyManager } from '@cardstack/runtime-common/index-runner/dependency-resolver';
import type { LatticeNativeCardIndexRequest } from '@cardstack/runtime-common/lattice-native-index';
import { createLatticeNativeCardIndexer } from '../lib/lattice-native-card-indexer.ts';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import type { LatticeDefinitionSnapshot } from '../lib/lattice-card-data.ts';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://lattice-native-index.example/';
const id = realm + 'Score/one';
const fileURL = id + '.json';
const codeRef = { module: rri(realm + 'score'), name: 'Score' };
const job = { jobId: 42, reservationId: 1, priority: 10, queueWaitMs: null };
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const formula = (source: string) =>
  getBxlComputeDefinition(
    bxl(source, { readableSyntax: false, libraries: ['core'] }),
  )!;
const numberField = {
  type: 'contains' as const,
  fieldOrCard: { module: rri(realm + 'base'), name: 'Number' },
  isPrimitive: true,
  isComputed: false,
  nativeCodec: { kind: 'primitive' as const, serializer: 'number' as const },
};
const root: LatticeDefinitionSnapshot = {
  revision: 'module-v1',
  definition: {
    type: 'card-def',
    codeRef,
    displayName: 'Score',
    nativeIndex: {
      types: [
        codeRef,
        { module: rri(realm + 'base'), name: 'CardDef' },
        { module: rri(realm + 'base'), name: 'BaseDef' },
      ],
      displayNames: ['Score', 'Card'],
      cardType: 'Score',
    },
    nativeCodec: { kind: 'compound', resourceType: 'card' },
    fields: { amount: 'amount', doubled: 'doubled', cardTitle: 'cardTitle' },
    fieldDefs: {
      amount: numberField,
      doubled: {
        ...numberField,
        isComputed: true,
        bxl: formula('.amount * 2'),
      },
      cardTitle: {
        ...numberField,
        nativeCodec: { kind: 'primitive', scalar: 'string' },
        isComputed: true,
        bxl: formula('"Score"'),
      },
    },
  },
};

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let writer: IndexWriter;
  let worker: LatticeBxlWorker;
  let network: VirtualNetwork;
  let sourceJSON: string;
  let visits: PrerenderVisitArgs[];
  let nativeFile = false;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      writer = new IndexWriter(db, {
        lattice: new LatticeRealmConfig([realm]),
      });
      network = new VirtualNetwork();
      network.addRealmMapping('@cardstack/base/', realm + 'base/');
      worker = new LatticeBxlWorker();
      visits = [];
      nativeFile = false;
      sourceJSON = JSON.stringify({
        data: {
          type: 'card',
          attributes: { amount: 3 },
          meta: { adoptsFrom: codeRef },
        },
      });
      // A transaction-readable authority fixture. Tests change these rows
      // after computation, then exercise the real Batch.done transaction.
      await db.execute(
        'CREATE TABLE lattice_native_test_revisions (identity text PRIMARY KEY, revision text NOT NULL)',
      );
      for (const [identity, revision] of Object.entries({
        source: hash(sourceJSON),
        module: 'module-v1',
        base: 'base-v1',
        field: 'field-v1',
        runtime: 'runtime-v1',
      })) {
        await db.execute(
          'INSERT INTO lattice_native_test_revisions VALUES ($1,$2)',
          { bind: [identity, revision] },
        );
      }
    },
  });
  hooks.afterEach(async () => {
    configureLatticeTrace();
    await worker.close();
  });

  const source = (): Reader => ({
    readFile: async () => ({
      content: sourceJSON,
      lastModified: 1,
      created: 1,
      path: 'Score/one.json',
    }),
    readStream: async () => {
      throw new Error('No native stream read');
    },
    mtimes: async () => ({ [fileURL]: 1 }),
  });

  function nativeIndexer(
    snapshot = root,
    options: Partial<Parameters<typeof createLatticeNativeCardIndexer>[0]> = {},
  ) {
    return createLatticeNativeCardIndexer({
      worker,
      admit: async (request) => {
        const revisions = await db.execute(
          'SELECT identity,revision FROM lattice_native_test_revisions',
        );
        const expected = new Map(
          revisions.map((row) => [row.identity, row.revision]),
        );
        if (
          expected.get('module') !== root.revision ||
          expected.get('source') !== hash(request.sourceJSON)
        )
          throw new Error('Admission is stale');
        return {
          root: snapshot,
          ...(nativeFile
            ? {
                file: {
                  kind: 'base-json' as const,
                  snapshot: {
                    revision: 'field-v1',
                    definition: {
                      type: 'file-def' as const,
                      codeRef,
                      displayName: 'JSON',
                      fields: {},
                      fieldDefs: {},
                      nativeFileIndex: {
                        types: [codeRef],
                        displayNames: ['JSON'],
                        staticIcon: {
                          svg: '<svg></svg>',
                          contentHash: 'fixture-svg',
                        },
                      },
                    },
                  },
                  deps: [realm + 'base'],
                  contentHash: createHash('md5')
                    .update(request.sourceJSON)
                    .digest('hex'),
                  contentSize: Buffer.byteLength(request.sourceJSON),
                },
              }
            : {}),
          lookup: async () => {
            throw new Error('No contained definitions');
          },
          resolve: (reference, relativeTo) =>
            new URL(reference, relativeTo).href,
          relative: (reference) => reference,
          typeKey: (ref) => {
            if (!('module' in ref)) throw new Error('Expected resolved type');
            return ref.module + '/' + ref.name;
          },
          deps: [realm + 'score', realm + 'base'],
          runtimeRevision: 'runtime-v1',
          assertCurrent: async (tx, receipt) => {
            if (
              receipt.sourceHash !== expected.get('source') ||
              receipt.runtimeRevision !== expected.get('runtime')
            )
              throw new Error('Receipt mismatch');
            for (const row of await tx([
              'SELECT identity,revision FROM lattice_native_test_revisions FOR SHARE',
            ])) {
              if (expected.get(row.identity) !== row.revision)
                throw new Error('Native revision changed: ' + row.identity);
            }
            // Also proves this is the publication transaction: on rejection,
            // even a successful earlier check's SQL changes must roll back.
            await tx([
              'UPDATE lattice_native_test_revisions SET revision =',
              param('checked'),
              "WHERE identity = 'runtime'",
            ]);
          },
        };
      },
      ...options,
    });
  }

  async function visit(batch: Batch) {
    const prerenderer = {
      prerenderVisit: async (args: PrerenderVisitArgs) => {
        visits.push(args);
        if (args.renderOptions?.cardRender)
          throw new Error('Card computation reached Chrome');
        return {};
      },
    } as Prerenderer;
    const result = await renderFileForIndexing({
      nativeCardIndexer: nativeIndexer(),
      url: new URL(fileURL),
      realmURL: new URL(realm),
      ignoreMap: new Map(),
      realmPaths: new RealmPaths(new URL(realm), network),
      reader: source(),
      batch,
      jobInfo: job,
      auth: '',
      batchId: 'native-test',
      prerenderer,
      virtualNetwork: network,
      consumeClearCacheForRender: () => true,
      logDebug() {},
      logWarn() {},
    });
    if (!result?.card) throw new Error('Expected native card result');
    const dependencyResolver = new IndexRunnerDependencyManager({
      realmURL: new URL(realm),
      virtualNetwork: network,
      readDefinitionCacheEntries: async () => ({}),
      getDependencyRows: async () => [],
      getOrderingDependencyRows: async () => [],
      getInvalidations: () => batch.invalidations,
    });
    await performCardIndexing({
      path: result.localPath,
      lastModified: result.lastModified,
      resourceCreatedAt: result.resourceCreatedAt,
      resource: result.parsedCardResource!,
      fileURL,
      instanceURL: new URL(id),
      realmURL: new URL(realm),
      auth: '',
      jobInfo: job,
      precomputedRenderResult: result.card,
      diagnostics: result.diagnostics,
      dependencyResolver,
      virtualNetwork: network,
      // IndexRunner stores card rows under their source .json URL.
      updateEntry: (url, entry) =>
        batch.updateEntry(new URL(url.href + '.json'), entry),
      logWarn() {},
    });
    if (result.fileExtract)
      await performFileIndexing({
        path: result.localPath,
        fileURL,
        lastModified: result.lastModified,
        resourceCreatedAt: result.resourceCreatedAt,
        isCardInstance: true,
        realmURL: new URL(realm),
        auth: '',
        jobInfo: job,
        precomputedExtractResult: result.fileExtract,
        precomputedRenderResult: result.fileRender,
        diagnostics: result.diagnostics,
        dependencyResolver,
        virtualNetwork: network,
        updateEntry: (url, entry) => batch.updateEntry(url, entry),
        logWarn() {},
      });
    return result;
  }

  test('tracing a real native visit preserves its card and emits only fingerprints of values', async (assert) => {
    const first = await visit(
      await writer.createBatch(new URL(realm), network),
    );
    const events: Record<string, any>[] = [];
    configureLatticeTrace({
      identity: 'test',
      hash,
      write: (e) => events.push(e),
    });
    const second = await visit(
      await writer.createBatch(new URL(realm), network),
    );
    assert.deepEqual(second.card?.searchDoc, first.card?.searchDoc);
    assert.deepEqual(second.card?.serialized, first.card?.serialized);
    assert.true(
      events.some(
        (e) => e.event === 'evaluation-input' && e.inputHash?.length === 64,
      ),
    );
    assert.true(
      events.some(
        (e) => e.event === 'native-result' && e.outputHash?.length === 64,
      ),
    );
    assert.true(
      events.some((e) => e.event === 'finish' && e.outcome === 'computed'),
    );
    assert.false(
      JSON.stringify(events).includes('"amount":3'),
      'source values are absent',
    );
  });

  test('a reviewed source publishes card and file together without entering the browser', async (assert) => {
    nativeFile = true;
    const batch = await writer.createBatch(new URL(realm), network);
    const result = await visit(batch);
    assert.strictEqual(visits.length, 0);
    assert.strictEqual(result.fileExtract?.searchDoc?.content, sourceJSON);
    await batch.done();
    const rows = await db.execute(
      'SELECT type,icon_html,pristine_doc FROM boxel_index WHERE realm_url=$1 ORDER BY type',
      { bind: [realm] },
    );
    assert.deepEqual(
      rows.map((row) => row.type),
      ['file', 'instance'],
    );
    assert.strictEqual(rows[0].icon_html, '<svg></svg>');
  });

  test('a changed extractor revision prevents both card and file rows from publishing', async (assert) => {
    nativeFile = true;
    const batch = await writer.createBatch(new URL(realm), network);
    await visit(batch);
    await db.execute(
      "UPDATE lattice_native_test_revisions SET revision='new-file-code' WHERE identity='field'",
    );
    await assert.rejects(batch.done(), /Native revision changed: field/);
    const rows = await db.execute(
      'SELECT type FROM boxel_index WHERE realm_url=$1',
      { bind: [realm] },
    );
    assert.strictEqual(rows.length, 0);
  });

  test('the source visit skips browser card computation and publishes through the existing index writer', async (assert) => {
    const batch = await writer.createBatch(new URL(realm), network);
    const result = await visit(batch);
    assert.strictEqual(result.card?.searchDoc?.doubled, 6);
    assert.strictEqual(
      visits.length,
      1,
      'source FileDef still has its existing extraction/render visit',
    );
    assert.true(visits[0].renderOptions?.fileExtract);
    assert.notOk(visits[0].renderOptions?.cardRender);
    await batch.done();
    const [row] = await db.execute(
      "SELECT pristine_doc,search_doc,types,diagnostics FROM boxel_index WHERE realm_url=$1 AND type='instance'",
      { bind: [realm] },
    );
    assert.strictEqual((row.search_doc as any).doubled, 6);
    assert.strictEqual((row.search_doc as any)._cardType, 'Score');
    assert.strictEqual((row.search_doc as any)._title, 'Score');
    assert.strictEqual((row.pristine_doc as any).meta.realmURL, realm);
    assert.strictEqual((row.pristine_doc as any).meta.lastModified, 1);
    assert.true((row.diagnostics as any).latticeNative);
    const assembly = (row.diagnostics as any).latticeNativeMs.assembly;
    assert.true(assembly.inputBytes > 0);
    assert.true(assembly.worker > 0);
    assert.true(
      Object.values(assembly).every(
        (value) =>
          typeof value === 'number' && Number.isFinite(value) && value >= 0,
      ),
      'persisted assembly phases contain finite timings and byte counts',
    );
    assert.deepEqual((row.diagnostics as any).latticeNativeMs.inputStages, []);
    assert.deepEqual(
      (row.diagnostics as any).latticeNativeCompute.fields.map(
        (field: { field: string }) => field.field,
      ),
      ['doubled', 'cardTitle'],
      'the published index diagnostic retains the actual computed field timing',
    );
    assert.deepEqual(row.types, result.card?.types);
  });

  for (const changed of ['source', 'module', 'base', 'field', 'runtime']) {
    test(`a changed ${changed} revision rejects the entire publication`, async (assert) => {
      const batch = await writer.createBatch(new URL(realm), network);
      await visit(batch);
      await db.execute(
        'UPDATE lattice_native_test_revisions SET revision=$1 WHERE identity=$2',
        { bind: ['new-revision', changed] },
      );
      await assert.rejects(
        batch.done(),
        new RegExp('Native revision changed: ' + changed),
      );
      const rows = await db.execute(
        'SELECT url FROM boxel_index WHERE realm_url=$1',
        { bind: [realm] },
      );
      assert.strictEqual(rows.length, 0, 'no partial index row was promoted');
    });
  }

  test('a later failed check rolls back earlier checks in the publication transaction', async (assert) => {
    const batch = await writer.createBatch(new URL(realm), network);
    await visit(batch);
    batch.registerLatticeNativeCard(realm + 'other.json', async () => {
      throw new Error('Second card became stale');
    });
    await assert.rejects(batch.done(), /Second card became stale/);
    const [row] = await db.execute(
      "SELECT revision FROM lattice_native_test_revisions WHERE identity='runtime'",
    );
    assert.strictEqual(
      row.revision,
      'runtime-v1',
      'the first check rolled back',
    );
  });

  test('a stale candidate leaves the previously published card available', async (assert) => {
    const first = await writer.createBatch(new URL(realm), network);
    await visit(first);
    await first.done();
    sourceJSON = JSON.stringify({
      data: {
        type: 'card',
        attributes: { amount: 4 },
        meta: { adoptsFrom: codeRef },
      },
    });
    await db.execute(
      "UPDATE lattice_native_test_revisions SET revision='runtime-v1' WHERE identity='runtime'",
    );
    await db.execute(
      "UPDATE lattice_native_test_revisions SET revision=$1 WHERE identity='source'",
      { bind: [hash(sourceJSON)] },
    );
    const second = await writer.createBatch(new URL(realm), network);
    const candidate = await visit(second);
    assert.strictEqual(candidate.card?.searchDoc?.doubled, 8);
    await db.execute(
      "UPDATE lattice_native_test_revisions SET revision='base-v2' WHERE identity='base'",
    );
    await assert.rejects(second.done(), /Native revision changed: base/);
    const [row] = await db.execute(
      "SELECT search_doc FROM boxel_index WHERE realm_url=$1 AND type='instance'",
      { bind: [realm] },
    );
    assert.strictEqual((row.search_doc as any).doubled, 6);
  });

  test('a worker retry cannot promote native working rows without rebuilding their revision receipt', async (assert) => {
    const first = await writer.createBatch(new URL(realm), network, job);
    await visit(first);
    // A second row with the same URL must not make the URL resumable again.
    await first.updateEntry(new URL(fileURL), {
      type: 'file',
      searchData: { title: 'source' },
      deps: new Set(),
      lastModified: 1,
      resourceCreatedAt: 1,
    });
    const retry = await writer.createBatch(new URL(realm), network, {
      ...job,
      reservationId: 2,
    });
    assert.strictEqual(retry.resumedRows.size, 0);
    await retry.done();
    const rows = await db.execute(
      'SELECT url FROM boxel_index WHERE realm_url=$1',
      { bind: [realm] },
    );
    assert.strictEqual(
      rows.length,
      0,
      'working bytes alone never prove publication authority',
    );
  });

  test('source refusal falls back without swallowing owner errors or cancellation', async (assert) => {
    const request: LatticeNativeCardIndexRequest = {
      url: fileURL,
      realmURL: realm,
      sourceJSON,
      generation: 2,
      loaderEpoch: 'code-1',
      lastModified: 1,
      resourceCreatedAt: 1,
    };
    for (const kind of ['input', 'output'] as const) {
      const snapshot = structuredClone(root);
      const doubled = snapshot.definition.fieldDefs.doubled;
      if (kind === 'input') doubled.bxl = formula('.undeclared');
      else doubled.type = 'linksToMany';
      assert.strictEqual(
        await nativeIndexer(snapshot)(request),
        undefined,
        `unadmitted computed ${kind} yields no source candidate`,
      );
    }
    const ordinaryFailure = new Error(
      'Unadmitted computed input: runtime failure',
    );
    const evaluateCard = worker.evaluateCard;
    worker.evaluateCard = async () => {
      throw ordinaryFailure;
    };
    try {
      await assert.rejects(
        nativeIndexer()(request),
        (error: Error) => error === ordinaryFailure,
        'an evaluator failure with a matching message cannot request fallback',
      );
    } finally {
      worker.evaluateCard = evaluateCard;
    }
    const snapshot = structuredClone(root);
    snapshot.definition.nativeIndex!.materialized = true;
    const ownerRequest = {
      ...request,
      inputSnapshot: { realmURL: realm, generation: 1 },
    };
    const refusal = new Error('Unadmitted computed input: missing owner input');
    let closed = 0;
    const controller = new AbortController();
    const indexer = nativeIndexer(snapshot, {
      openInputs: async () => {
        throw refusal;
      },
      openWork: async () => ({
        signal: controller.signal,
        close: async () => {
          closed++;
        },
      }),
    });
    await assert.rejects(
      indexer(ownerRequest),
      (error: Error) => error === refusal,
      'a materialized owner must retain its input refusal',
    );
    const cancellation = new Error('source changed');
    controller.abort(cancellation);
    await assert.rejects(
      indexer(ownerRequest),
      (error: Error) => error === cancellation,
      'cancelled work never becomes fallback',
    );
    assert.strictEqual(closed, 2, 'both owner work scopes close');
    await db.execute(
      "UPDATE lattice_native_test_revisions SET revision='stale' WHERE identity='module'",
    );
    await assert.rejects(
      nativeIndexer()(request),
      /Admission is stale/,
      'source admission failures still reject',
    );
  });

  test('query-owner work still needs its membership/provenance admission', async (assert) => {
    const request: LatticeNativeCardIndexRequest = {
      url: fileURL,
      realmURL: realm,
      sourceJSON,
      generation: 2,
      loaderEpoch: 'code-1',
      lastModified: 1,
      resourceCreatedAt: 1,
      inputSnapshot: { realmURL: realm, generation: 1 },
    };
    assert.strictEqual(await nativeIndexer()(request), undefined);
  });
});
