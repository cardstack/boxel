import QUnit from 'qunit';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { bxl, getBxlComputeDefinition } from '@cardstack/bxl';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  VirtualNetwork,
  rri,
  param,
  type DefinitionLookup,
  type Prerenderer,
} from '@cardstack/runtime-common';
import { IndexRunner } from '@cardstack/runtime-common/index-runner';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { LatticeSourceIndexInputs } from '@cardstack/runtime-common/lattice-source-index-inputs';
import type {
  LatticeNativeCardIndexRequest,
  LatticeNativeSourceInput,
} from '@cardstack/runtime-common/lattice-native-index';
import { createLatticeNativeCardIndexer } from '../lib/lattice-native-card-indexer.ts';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import type { LatticeDefinitionSnapshot } from '../lib/lattice-card-data.ts';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://lattice-source-input.example/';
const sourceURL = realm + 'Source/one.json';
const ownerURL = realm + 'Derived/one.json';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const formula = (s: string) =>
  getBxlComputeDefinition(
    bxl(s, { libraries: ['core'], readableSyntax: false }),
  )!;
const numberField = {
  type: 'contains' as const,
  fieldOrCard: { module: rri(realm + 'base'), name: 'Number' },
  isPrimitive: true,
  isComputed: false,
  nativeCodec: { kind: 'primitive' as const, serializer: 'number' as const },
};
function definition(name: string): LatticeDefinitionSnapshot {
  const codeRef = { module: rri(realm + 'cards'), name };
  return {
    revision: 'reviewed-v1',
    definition: {
      type: 'card-def',
      codeRef,
      displayName: name,
      nativeCodec: { kind: 'compound', resourceType: 'card' },
      nativeIndex: {
        types: [codeRef],
        displayNames: [name],
        cardType: name,
        ...(name === 'Derived' ? { materialized: true } : {}),
      },
      ...(name === 'Derived' ? { nativeLinkInputs: { source: {} } } : {}),
      fields:
        name === 'Derived'
          ? { source: 'source', value: 'value' }
          : { amount: 'amount', value: 'value' },
      fieldDefs:
        name === 'Derived'
          ? {
              source: {
                type: 'linksTo',
                nativeCodec: { kind: 'compound', resourceType: 'card' },
                isPrimitive: false,
                fieldOrCard: { module: rri(realm + 'cards'), name: 'Source' },
                isComputed: false,
              },
              value: {
                ...numberField,
                isComputed: true,
                bxl: formula('.source.value * 3'),
              },
            }
          : {
              amount: numberField,
              value: {
                ...numberField,
                isComputed: true,
                bxl: formula('.amount * 2'),
              },
            },
    },
  };
}
const sourceDefinition = definition('Source');
const derivedDefinition = definition('Derived');
function receipt(url = sourceURL, generation = 1): LatticeNativeSourceInput {
  return {
    url,
    realmURL: realm,
    generation,
    resource: {
      id: rri(url.replace(/\.json$/, '')),
      type: 'card',
      attributes: { value: 6 },
      meta: { adoptsFrom: sourceDefinition.definition.codeRef },
    },
    assertCurrent: async () => {},
  };
}
module(basename(import.meta.filename) + ' capability', () => {
  test('deduplicates demand, rejects foreign inputs, and expires at batch end', async (assert) => {
    let calls = 0;
    const frame = new LatticeSourceIndexInputs(realm, 1, async (url) => {
      calls++;
      return receipt(url);
    });
    const [a, b] = await Promise.all([
      frame.read(sourceURL),
      frame.read(sourceURL),
    ]);
    assert.strictEqual(a, b);
    assert.strictEqual(calls, 1);
    for (const url of [
      'https://other.example/one.json',
      sourceURL + '?v=1',
      sourceURL + '#x',
      realm + 'cards.gts',
    ])
      assert.strictEqual(await frame.read(url), undefined);
    assert.throws(
      () => frame.remember(receipt(sourceURL, 2)),
      /another indexing batch/,
    );
    frame.close();
    await assert.rejects(frame.read(sourceURL), /batch has ended/);
  });
  test('evicts old source bodies and refuses mismatched identities', async (assert) => {
    let calls = 0;
    const frame = new LatticeSourceIndexInputs(realm, 1, async (url) => {
      calls++;
      return receipt(url);
    });
    for (let i = 0; i < 17; i++) await frame.read(realm + i + '.json');
    await frame.read(realm + '0.json');
    assert.strictEqual(calls, 18, 'old body reloaded after bounded retention');
    frame.close();
    const wrong = new LatticeSourceIndexInputs(realm, 1, async () =>
      receipt(ownerURL),
    );
    await assert.rejects(wrong.read(sourceURL), /identity mismatch/);
    wrong.close();
  });
});

module(basename(import.meta.filename) + ' native batch', (hooks) => {
  let db: PgAdapter,
    writer: IndexWriter,
    network: VirtualNetwork,
    worker: LatticeBxlWorker;
  let files: Map<string, string>;
  let visits: string[];
  let beforeCommit: (() => Promise<void>) | undefined;
  const lookup = {
    forRealm() {
      return this;
    },
    async lookupDefinition() {
      throw new Error('Unexpected query definition lookup');
    },
    async getCachedDefinitionsBatch() {
      return {};
    },
  } as unknown as DefinitionLookup;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      network = new VirtualNetwork();
      network.addRealmMapping('@cardstack/base/', realm + 'base/');
      writer = new IndexWriter(db, {
        lattice: new LatticeRealmConfig([realm]),
      });
      worker = new LatticeBxlWorker();
      visits = [];
      beforeCommit = undefined;
      files = new Map([
        [
          sourceURL,
          JSON.stringify({
            data: {
              type: 'card',
              attributes: { amount: 3 },
              meta: { adoptsFrom: sourceDefinition.definition.codeRef },
            },
          }),
        ],
        [
          ownerURL,
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {},
              relationships: { source: { links: { self: '../Source/one' } } },
              meta: { adoptsFrom: derivedDefinition.definition.codeRef },
            },
          }),
        ],
      ]);
      await db.execute(
        'CREATE TABLE source_input_revisions (url text PRIMARY KEY, revision text NOT NULL)',
      );
      for (const [url, content] of [
        ...files,
        ['code', 'reviewed-v1'],
        ['runtime', 'runtime-v1'],
      ])
        await db.execute('INSERT INTO source_input_revisions VALUES($1,$2)', {
          bind: [url, files.has(url) ? hash(content) : content],
        });
    },
  });
  hooks.afterEach(async () => {
    await worker.close();
  });
  function indexer(snapshot = derivedDefinition) {
    return createLatticeNativeCardIndexer({
      worker,
      admit: async (request) => {
        visits.push(request.url);
        const root = request.url === sourceURL ? sourceDefinition : snapshot;
        const expected = new Map(
          (
            await db.execute('SELECT url,revision FROM source_input_revisions')
          ).map((row) => [String(row.url), row.revision]),
        );
        if (hash(request.sourceJSON) !== expected.get(request.url))
          throw new Error('Source admission changed');
        return {
          root,
          lookup: async () => sourceDefinition,
          resolve: (ref, base) => new URL(ref, base).href,
          relative: (ref) => ref,
          typeKey: (ref) => {
            if (!('module' in ref)) throw new Error('unresolved type');
            return ref.module + '/' + ref.name;
          },
          deps: [realm + 'cards'],
          runtimeRevision: 'runtime-v1',
          file: {
            kind: 'base-json',
            snapshot: {
              revision: 'reviewed-v1',
              definition: {
                type: 'file-def',
                codeRef: { module: rri(realm + 'base/json'), name: 'JSON' },
                displayName: 'JSON',
                fields: {},
                fieldDefs: {},
                nativeFileIndex: {
                  types: [{ module: rri(realm + 'base/json'), name: 'JSON' }],
                  displayNames: ['JSON'],
                  staticIcon: { svg: '<svg></svg>', contentHash: 'fixture' },
                },
              },
            },
            deps: [realm + 'base/json'],
            contentHash: hash(request.sourceJSON),
            contentSize: request.sourceJSON.length,
          },
          assertCurrent: async (tx, proof) => {
            if (proof.sourceHash !== expected.get(request.url))
              throw new Error('Wrong source proof');
            const rows = await tx([
              'SELECT url,revision FROM source_input_revisions WHERE url IN (',
              param(request.url),
              ", 'code', 'runtime') FOR SHARE",
            ]);
            for (const row of rows)
              if (row.revision !== expected.get(String(row.url)))
                throw new Error('Source input changed: ' + row.url);
          },
        };
      },
    });
  }
  function request(url: string): LatticeNativeCardIndexRequest {
    return {
      url,
      realmURL: realm,
      sourceJSON: files.get(url)!,
      generation: 1,
      loaderEpoch: 'epoch',
      lastModified: 1,
      resourceCreatedAt: 1,
    };
  }
  async function run(urls: string[], enabled = true) {
    const runWriter = enabled ? writer : new IndexWriter(db);
    const runner = new IndexRunner({
      realmURL: new URL(realm),
      indexWriter: runWriter,
      virtualNetwork: network,
      definitionLookup: lookup,
      nativeCardIndexer: indexer(),
      auth: '',
      fetch: globalThis.fetch,
      realmOwnerUserId: '@fixture:example',
      reader: {
        readFile: async (path) => {
          const url = new URL(path, realm).href;
          const content = files.get(url);
          return content === undefined
            ? undefined
            : { content, path: path.href, lastModified: 1, created: 1 };
        },
        readStream: async () => undefined,
        mtimes: async () =>
          Object.fromEntries([...files.keys()].map((url) => [url, 1])),
      },
      prerenderer: {
        prerenderVisit: async () => {
          throw new Error('Unexpected Chrome visit');
        },
        releaseBatch: async () => {},
      } as unknown as Prerenderer,
    });
    // The real Batch.done guard runs after the last visit, in its own transaction.
    const createBatch = runWriter.createBatch.bind(runWriter);
    runWriter.createBatch = async (...args) => {
      const batch = await createBatch(...args);
      const done = batch.done.bind(batch);
      batch.done = new Proxy(done, {
        apply: async (target, self, args) => {
          await beforeCommit?.();
          return Reflect.apply(target, self, args);
        },
      });
      return batch;
    };
    return IndexRunner.incremental(runner, {
      changes: urls.map((url) => ({ url: new URL(url), operation: 'update' })),
    });
  }
  for (const order of [
    [sourceURL, ownerURL],
    [ownerURL, sourceURL],
  ])
    test(
      'source and derived publish together: ' +
        (order[0] === ownerURL ? 'dependent first' : 'source first'),
      async (assert) => {
        await run(order);
        const rows = await db.execute(
          "SELECT url,generation,pristine_doc,has_error,error_doc FROM boxel_index WHERE realm_url=$1 AND type='instance' ORDER BY url",
          { bind: [realm] },
        );
        assert.strictEqual(rows.length, 2);
        assert.true(
          rows.every((row) => !row.has_error),
          JSON.stringify(rows),
        );
        assert.strictEqual(
          rows[0].generation,
          rows[1].generation,
          'one publication generation',
        );
        const derived = rows.find((row) => row.url === ownerURL)!;
        assert.strictEqual((derived.pristine_doc as any).attributes.value, 18);
        assert.strictEqual(
          (derived.pristine_doc as any).meta.publication,
          undefined,
          'no materialized owner manifest',
        );
        assert.strictEqual(
          visits.filter((url) => url === sourceURL).length,
          1,
          'one source evaluation',
        );
        assert.deepEqual(
          await db.execute(
            'SELECT owner_url FROM lattice_owners WHERE realm_url=$1 AND NOT retired',
            { bind: [realm] },
          ),
          [],
        );
        files.set(
          sourceURL,
          files.get(sourceURL)!.replace('"amount":3', '"amount":4'),
        );
        await db.execute(
          'UPDATE source_input_revisions SET revision=$1 WHERE url=$2',
          { bind: [hash(files.get(sourceURL)!), sourceURL] },
        );
        await run([sourceURL]);
        const [updated] = await db.execute(
          "SELECT pristine_doc FROM boxel_index WHERE url=$1 AND type='instance'",
          { bind: [ownerURL] },
        );
        assert.strictEqual(
          (updated.pristine_doc as any).attributes.value,
          24,
          'source dependency triggers next ordinary index job',
        );
      },
    );
  test('ordinary indexing retires a formerly materialized derivation', async (assert) => {
    await run([sourceURL, ownerURL]);
    await db.execute(
      `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired) VALUES($1,$2,1,1,1,'old-review',FALSE)`,
      { bind: [realm, ownerURL] },
    );
    await run([ownerURL]);
    const [owner] = await db.execute(
      'SELECT retired,dirty_generation FROM lattice_owners WHERE realm_url=$1 AND owner_url=$2',
      { bind: [realm, ownerURL] },
    );
    assert.true(owner.retired);
    assert.strictEqual(owner.dirty_generation, null);
  });

  for (const changed of [sourceURL, 'code', 'runtime'])
    test('changed input rejects complete batch: ' + changed, async (assert) => {
      beforeCommit = async () => {
        await db.execute(
          'UPDATE source_input_revisions SET revision=$1 WHERE url=$2',
          { bind: ['changed', changed] },
        );
      };
      await assert.rejects(run([ownerURL, sourceURL]), /Source input changed/);
      assert.deepEqual(
        await db.execute('SELECT url FROM boxel_index WHERE realm_url=$1', {
          bind: [realm],
        }),
        [],
        'no partial promotion',
      );
    });
  test('source-only probe cannot recursively admit a derived card', async (assert) => {
    assert.strictEqual(
      await indexer()({ ...request(ownerURL), sourceInputOnly: true }),
      undefined,
    );
  });
  test('batch capability rejects wrong generation and does not enter for cross-realm, self or nested links', async (assert) => {
    await assert.rejects(
      indexer()({
        ...request(ownerURL),
        sourceInput: async () => receipt(sourceURL, 2),
      }),
      /another indexing batch/,
    );
    for (const target of [
      ownerURL.replace(/\.json$/, ''),
      'https://elsewhere.example/source',
    ]) {
      const doc = JSON.parse(files.get(ownerURL)!);
      doc.data.relationships.source.links.self = target;
      files.set(ownerURL, JSON.stringify(doc));
      await db.execute(
        'UPDATE source_input_revisions SET revision=$1 WHERE url=$2',
        { bind: [hash(files.get(ownerURL)!), ownerURL] },
      );
      assert.strictEqual(
        await indexer()({
          ...request(ownerURL),
          sourceInput: async () => {
            throw new Error('Unexpected source read');
          },
        }),
        undefined,
      );
    }
    const nested = structuredClone(derivedDefinition);
    nested.definition.nativeLinkInputs!.source = {
      links: { next: { many: false, projection: {} } },
    };
    assert.strictEqual(
      await indexer(nested)({
        ...request(ownerURL),
        sourceInput: async () => {
          throw new Error('Unexpected recursive read');
        },
      }),
      undefined,
    );
  });
  test('flag off never invokes the native capability', async (assert) => {
    await run([sourceURL, ownerURL], false);
    assert.deepEqual(visits, []);
  });
});
