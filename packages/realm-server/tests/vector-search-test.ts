import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  InvalidQueryError,
  VectorSerializer,
  VirtualNetwork,
  assertQuery,
  combineSearchEntryResults,
  isClientEvaluable,
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
  collectSearchDocVectors,
  hasVectorIndex,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// VectorField end to end against real Postgres + pgvector: the serializer,
// the index writer's copy of search-doc vectors into `boxel_index_vectors`,
// and the engine's `near` sort, alone and with filters.

const { encodeVector, decodeVector, queryableValue, deserializeSync } =
  VectorSerializer;

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const vectorRef = ref('@cardstack/base/vector', 'default');
const momentRef = ref(`${testRealm}moment`, 'Moment');
const segmentRef = ref(`${testRealm}moment`, 'Segment');

const segmentDef: Definition = {
  type: 'field-def',
  codeRef: segmentRef,
  displayName: 'Segment',
  fields: { embedding: 'f0' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: vectorRef,
      serializerName: 'vector',
    },
  },
};

const momentDef: Definition = {
  type: 'card-def',
  codeRef: momentRef,
  displayName: 'Moment',
  fields: { title: 'f0', topic: 'f0', embedding: 'f1', segments: 'f2' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
    f1: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: vectorRef,
      serializerName: 'vector',
    },
    f2: {
      type: 'containsMany',
      isPrimitive: false,
      isComputed: false,
      fieldOrCard: segmentRef,
    },
  },
};

function makeDefinitionLookup(): DefinitionLookup {
  const lookup: DefinitionLookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      for (let def of [momentDef, segmentDef]) {
        let defRef = def.codeRef as ResolvedCodeRef;
        if (defRef.module === codeRef.module && defRef.name === codeRef.name) {
          return def;
        }
      }
      throw new Error(
        `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
      );
    },
    async lookupDefinitionEntry(): Promise<never> {
      throw new Error('lookupDefinitionEntry is not used by these tests');
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    async invalidate() {
      return [];
    },
    async clearRealmDefinitions() {},
    async clearAllDefinitions() {},
    registerRealm() {},
    async getCachedDefinitions() {
      return undefined;
    },
    async populateDefinitionCacheEntry() {
      return undefined;
    },
    async getCachedDefinitionsBatch() {
      return {};
    },
    forRealm() {
      return lookup;
    },
  };
  return lookup;
}

const vec = (components: number[]) => queryableValue(encodeVector(components));
const url = (name: string) => `${testRealm}Moment/${name}.json`;

module(basename(import.meta.filename), function () {
  module('VectorField serialization', function () {
    test('int8 encoding round-trips within one quantization step', function (assert) {
      let components = [0.5, -0.25, 0.125, -1, 0];
      let vector = encodeVector(components);
      assert.strictEqual(vector.dims, 5);
      assert.strictEqual(vector.encoding, 'int8');
      assert.strictEqual(vector.data.length, 8, '5 bytes is 8 base64 chars');
      let decoded = Array.from(decodeVector(vector));
      let step = vector.scale!;
      components.forEach((c, i) =>
        assert.ok(
          Math.abs(decoded[i] - c) <= step / 2 + 1e-9,
          `component ${i}`,
        ),
      );
    });

    test('float32 encoding round-trips exactly at float32 precision', function (assert) {
      let components = [0.1, -2.5, 3.75];
      let vector = encodeVector(components, { encoding: 'float32' });
      assert.strictEqual(vector.scale, undefined);
      assert.deepEqual(
        Array.from(decodeVector(vector)),
        Array.from(Float32Array.from(components)),
      );
    });

    test('the stored form validates on deserialize', function (assert) {
      let vector = encodeVector([1, 2, 3]);
      let json = VectorSerializer.serialize(vector)!;
      assert.deepEqual(deserializeSync(json), vector, 'round-trips via JSON');
      assert.deepEqual(
        deserializeSync([1, 2, 3]),
        vector,
        'a plain number array is encoded as int8',
      );
      assert.throws(
        () => deserializeSync({ ...json, dims: 4 }),
        /4 int8 components need 4/,
        'data length must match dims',
      );
      assert.throws(
        () => deserializeSync({ ...json, encoding: 'int4' }),
        /encoding must be/,
      );
      assert.throws(
        () => deserializeSync(json, 256),
        /expected 256 dimensions, got 3/,
        'a field dimension is enforced',
      );
      assert.throws(() => encodeVector([1, NaN]), /not a finite number/);
      assert.strictEqual(deserializeSync(null), null);
    });

    test('the search-doc form is a marked, pgvector-castable string', function (assert) {
      assert.strictEqual(vec([1, -1, 0]), 'vec:[127,-127,0]');
      assert.strictEqual(
        queryableValue(encodeVector([0.5, 0.25], { encoding: 'float32' })),
        'vec:[0.5,0.25]',
      );
    });

    test('cosine similarity is scale-invariant across encodings', function (assert) {
      let a = encodeVector([1, 2, 3]);
      let b = encodeVector([2, 4, 6], { encoding: 'float32' });
      assert.ok(Math.abs(VectorSerializer.cosineSimilarity(a, b) - 1) < 1e-3);
      assert.ok(
        Math.abs(VectorSerializer.cosineSimilarity([1, 0], [0, 1])) < 1e-9,
      );
    });

    test('collectSearchDocVectors finds own vectors by path and position, not linked cards', function (assert) {
      let found = collectSearchDocVectors({
        title: 'x',
        embedding: vec([1, 0]),
        segments: [{ embedding: vec([0, 1]) }, { embedding: vec([1, 1]) }],
        related: { id: 'http://x/Moment/2', embedding: vec([1, 0]) },
      });
      assert.deepEqual(
        found.map(({ fieldPath, ordinal }) => [fieldPath, ordinal]),
        [
          ['embedding', 0],
          ['segments.embedding', 0],
          ['segments.embedding', 1],
        ],
      );
    });
  });

  module('near through the search wire grammar and federation', function () {
    test('the wire translation keeps a near filter and a near sort', function (assert) {
      let query: Query = {
        filter: {
          on: momentRef,
          near: { embedding: { to: [1, 0, 0], minSimilarity: 0.5 } },
        },
        sort: [{ on: momentRef, by: 'embedding', near: [1, 0, 0] }],
        page: { size: 3 },
      };
      let wire = searchEntryWireQueryFromQuery(query);
      assert.deepEqual(wire.filter, {
        'item.on': momentRef,
        near: { 'item.embedding': { to: [1, 0, 0], minSimilarity: 0.5 } },
      });
      assert.deepEqual(wire.sort, [
        { by: 'item.embedding', 'item.on': momentRef, near: [1, 0, 0] },
      ]);
      let parsed = parseSearchEntryQueryFromPayload(wire);
      assert.deepEqual(
        parsed.itemQuery.filter,
        query.filter,
        'the filter round-trips',
      );
      assert.deepEqual(
        parsed.itemQuery.sort,
        query.sort,
        'the sort round-trips',
      );
    });

    test('a near filter is left to the server by live queries', function (assert) {
      assert.false(
        isClientEvaluable({
          on: momentRef,
          near: { embedding: { to: [1, 0, 0] } },
        }),
      );
    });

    test('the federated merge orders near-ranked pages by similarity', function (assert) {
      let entry = (id: string, similarity?: number) => ({
        type: 'entry' as const,
        id,
        relationships: {},
        ...(similarity == null
          ? {}
          : { meta: { _nearSimilarity: similarity } }),
      });
      let docs = [
        {
          data: [entry('a1', 0.9), entry('a2', 0.2), entry('a3')],
          meta: { page: { total: 3 } },
        },
        {
          data: [entry('b1', 0.95), entry('b2', 0.5)],
          meta: { page: { total: 2 } },
        },
      ] as any;
      let ranked = combineSearchEntryResults(docs, 2, {
        nearSimilarity: 'desc',
      });
      assert.deepEqual(
        ranked.data.map((e) => e.id),
        ['b1', 'a1', 'b2', 'a2', 'a3'],
      );
      assert.strictEqual(ranked.meta.page.total, 5);
      let unranked = combineSearchEntryResults(docs, 2);
      assert.deepEqual(
        unranked.data.map((e) => e.id),
        ['a1', 'a2', 'a3', 'b1', 'b2'],
        'other queries keep realm order',
      );
    });
  });

  module('near query validation', function () {
    test('assertQuery accepts a near sort and rejects malformed ones', function (assert) {
      let ok: Query = {
        sort: [{ on: momentRef, by: 'embedding', near: [1, 0, 0] }],
      };
      assertQuery(ok);
      assertQuery({
        sort: [
          { on: momentRef, by: 'embedding', near: encodeVector([1, 0, 0]) },
        ],
      });
      assert.throws(
        () => assertQuery({ sort: [{ by: 'embedding', near: [1] }] } as any),
        /near sort needs an on object/,
      );
      assert.throws(
        () =>
          assertQuery({
            sort: [{ on: momentRef, by: 'embedding', near: [1, 'x'] }],
          } as any),
        /array of finite numbers/,
      );
      assert.throws(
        () =>
          assertQuery({
            sort: [{ on: momentRef, by: 'embedding', near: { dims: 2 } }],
          } as any),
        /array of numbers or a vector/,
      );
      assertQuery({
        filter: {
          on: momentRef,
          near: { embedding: { to: [1, 0], minSimilarity: 0.5 } },
        },
      });
      assert.throws(
        () =>
          assertQuery({
            filter: {
              on: momentRef,
              near: { embedding: { to: [1, 0], k: 10 } },
            },
          } as any),
        /unknown member "k".*set page.size/,
        'k is refused with a pointer to page.size',
      );
      assert.throws(
        () =>
          assertQuery({
            filter: {
              on: momentRef,
              near: { embedding: { to: [1, 0], minSimilarity: 2 } },
            },
          } as any),
        /minSimilarity must be a number from -1 to 1/,
      );
      assert.throws(
        () =>
          assertQuery({
            filter: {
              on: momentRef,
              near: { a: { to: [1] }, b: { to: [1] } },
            },
          } as any),
        /exactly one field path/,
      );
    });
  });

  module('vector index and near sort (Postgres + pgvector)', function (hooks) {
    let adapter: PgAdapter;
    let indexWriter: IndexWriter;
    let engine: IndexQueryEngine;
    let virtualNetwork: VirtualNetwork;
    let momentKey: string;
    let vectorsAvailable: boolean;

    // These need pgvector, which the CI Postgres image does not ship yet; on
    // a database without it each one passes with a note instead of running.
    // The 'without pgvector' module below covers that database.
    function pgvectorTest(name: string, fn: (assert: Assert) => Promise<void>) {
      test(name, async (assert) => {
        if (!vectorsAvailable) {
          assert.ok(true, 'skipped: this Postgres has no pgvector');
          return;
        }
        await fn(assert);
      });
    }

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
      indexWriter = new IndexWriter(adapter);
      virtualNetwork = new VirtualNetwork();
      engine = new IndexQueryEngine(
        adapter,
        makeDefinitionLookup(),
        virtualNetwork,
      );
      momentKey = internalKeyFor(momentRef, undefined, virtualNetwork);
      vectorsAvailable = await hasVectorIndex(adapter);
    });

    hooks.afterEach(async function () {
      await closeTestPgAdapter(adapter);
    });

    async function index(
      cards: Record<string, Record<string, unknown>>,
      deleted: string[] = [],
    ) {
      let batch = await indexWriter.createBatch(
        new URL(testRealm),
        virtualNetwork,
        undefined,
        { splitPrerenderHtml: false },
      );
      for (let [name, searchData] of Object.entries(cards)) {
        let cardURL = new URL(url(name));
        await batch.updateEntry(cardURL, {
          type: 'instance',
          resource: {
            id: rri(cardURL.href),
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: { module: rri(momentRef.module), name: 'Moment' },
            },
          },
          lastModified: Date.now(),
          resourceCreatedAt: Date.now(),
          searchData,
          deps: new Set(),
          displayNames: ['Moment'],
          types: [momentKey],
          isolatedHtml: `<div>${name}</div>`,
        });
      }
      if (deleted.length) {
        await batch.invalidate(deleted.map((name) => new URL(url(name))));
      }
      await batch.done();
    }

    async function vectorRows() {
      return (await adapter.execute(
        `SELECT url, field_path, ordinal, dims, embedding::text AS embedding
         FROM boxel_index_vectors ORDER BY url, field_path, ordinal`,
      )) as {
        url: string;
        field_path: string;
        ordinal: number;
        dims: number;
        embedding: string;
      }[];
    }

    async function nearIds(query: Query): Promise<string[]> {
      let { cards } = await engine.searchCards(new URL(testRealm), query);
      return cards.map((c) => c.id!.replace(`${testRealm}Moment/`, ''));
    }

    const seed = {
      same: { title: 'same', topic: 'a', embedding: vec([1, 0, 0]) },
      close: { title: 'close', topic: 'b', embedding: vec([1, 1, 0]) },
      orthogonal: {
        title: 'orthogonal',
        topic: 'a',
        embedding: vec([0, 1, 0]),
      },
      opposite: { title: 'opposite', topic: 'b', embedding: vec([-1, 0, 0]) },
      none: { title: 'none', topic: 'a' },
    };

    pgvectorTest(
      'indexing copies search-doc vectors into boxel_index_vectors',
      async (assert) => {
        await index({
          ...seed,
          segmented: {
            title: 'segmented',
            segments: [
              { embedding: vec([0, 0, 1]) },
              { embedding: vec([0, 1, 1]) },
            ],
          },
        });
        let rows = await vectorRows();
        assert.deepEqual(
          rows.map((r) => [
            r.url.replace(`${testRealm}Moment/`, ''),
            r.field_path,
            r.ordinal,
            r.dims,
          ]),
          [
            ['close.json', 'embedding', 0, 3],
            ['opposite.json', 'embedding', 0, 3],
            ['orthogonal.json', 'embedding', 0, 3],
            ['same.json', 'embedding', 0, 3],
            ['segmented.json', 'segments.embedding', 0, 3],
            ['segmented.json', 'segments.embedding', 1, 3],
          ],
        );
        assert.strictEqual(
          rows.find((r) => r.url === url('same'))!.embedding,
          '[127,0,0]',
        );
      },
    );

    pgvectorTest(
      're-indexing a card replaces its vectors, and deleting it removes them',
      async (assert) => {
        await index(seed);
        await index({ same: { title: 'same', embedding: vec([0, 0, 1]) } });
        let rows = await vectorRows();
        assert.strictEqual(
          rows.find((r) => r.url === url('same'))!.embedding,
          '[0,0,127]',
          'the new vector replaced the old',
        );
        await index({ close: { title: 'close' } }, ['opposite']);
        rows = await vectorRows();
        assert.notOk(
          rows.some((r) => r.url === url('close')),
          'a card that dropped its vector keeps none',
        );
        assert.notOk(
          rows.some((r) => r.url === url('opposite')),
          'a deleted card keeps none',
        );
        assert.strictEqual(rows.length, 2);
      },
    );

    pgvectorTest(
      'a near sort orders by cosine similarity, most similar first, cards without a vector last',
      async (assert) => {
        await index(seed);
        assert.deepEqual(
          await nearIds({
            sort: [{ on: momentRef, by: 'embedding', near: [1, 0, 0] }],
          }),
          [
            'same.json',
            'close.json',
            'orthogonal.json',
            'opposite.json',
            'none.json',
          ],
        );
        assert.deepEqual(
          await nearIds({
            sort: [
              {
                on: momentRef,
                by: 'embedding',
                near: [1, 0, 0],
                direction: 'asc',
              },
            ],
          }),
          [
            'opposite.json',
            'orthogonal.json',
            'close.json',
            'same.json',
            'none.json',
          ],
          'asc puts the least similar first; no vector stays last',
        );
        assert.deepEqual(
          (
            await nearIds({
              sort: [
                {
                  on: momentRef,
                  by: 'embedding',
                  near: encodeVector([0, 1, 0], { encoding: 'float32' }),
                },
              ],
            })
          ).slice(0, 2),
          ['orthogonal.json', 'close.json'],
          'a stored-form target works too',
        );
      },
    );

    pgvectorTest(
      'a near sort combines with filters and paging',
      async (assert) => {
        await index(seed);
        assert.deepEqual(
          await nearIds({
            filter: { on: momentRef, eq: { topic: 'b' } },
            sort: [{ on: momentRef, by: 'embedding', near: [1, 0, 0] }],
          }),
          ['close.json', 'opposite.json'],
        );
        assert.deepEqual(
          await nearIds({
            filter: {
              on: momentRef,
              every: [
                { eq: { topic: 'a' } },
                { not: { eq: { title: 'same' } } },
              ],
            },
            sort: [{ on: momentRef, by: 'embedding', near: [1, 0, 0] }],
            page: { size: 1 },
          }),
          ['orthogonal.json'],
          'excludes the source card and keeps the top hit',
        );
        let { meta } = await engine.searchCards(new URL(testRealm), {
          filter: { on: momentRef, eq: { topic: 'a' } },
          sort: [{ on: momentRef, by: 'embedding', near: [1, 0, 0] }],
          page: { size: 2 },
        });
        assert.strictEqual(meta.page.total, 3, 'total counts every match');
      },
    );

    pgvectorTest(
      'a plural vector field ranks a card by its nearest vector',
      async (assert) => {
        await index({
          far: { title: 'far', segments: [{ embedding: vec([-1, 0, 0]) }] },
          mixed: {
            title: 'mixed',
            segments: [
              { embedding: vec([0, -1, 0]) },
              { embedding: vec([1, 0.1, 0]) },
            ],
          },
          middle: {
            title: 'middle',
            segments: [{ embedding: vec([1, 1, 0]) }],
          },
        });
        assert.deepEqual(
          await nearIds({
            sort: [
              { on: momentRef, by: 'segments.embedding', near: [1, 0, 0] },
            ],
          }),
          ['mixed.json', 'middle.json', 'far.json'],
        );
      },
    );

    pgvectorTest(
      'a target of another dimension ranks nothing, and a non-vector field is refused',
      async (assert) => {
        await index(seed);
        assert.deepEqual(
          (
            await nearIds({
              sort: [{ on: momentRef, by: 'embedding', near: [1, 0] }],
            })
          ).length,
          5,
          'every card still matches, unranked (no vector of that dimension)',
        );
        try {
          await nearIds({
            sort: [{ on: momentRef, by: 'title', near: [1, 0, 0] }],
          });
          assert.ok(false, 'expected an error');
        } catch (e) {
          assert.ok(e instanceof InvalidQueryError);
          assert.ok(/requires "title" to be a VectorField/.test(String(e)));
        }
      },
    );

    pgvectorTest(
      'a near sort works through the realm search projection',
      async (assert) => {
        await index(seed);
        let { results } = await engine.search(
          new URL(testRealm),
          {
            sort: [{ on: momentRef, by: 'embedding', near: [1, 0, 0] }],
            page: { size: 2 },
          },
          {},
          { kind: 'renderSet' },
        );
        assert.deepEqual(
          results.map((r) => [
            r.url!.replace(`${testRealm}Moment/`, ''),
            Number((r as any)._nearSimilarity).toFixed(3),
          ]),
          [
            ['same.json', '1.000'],
            ['close.json', '0.707'],
          ],
        );
      },
    );

    pgvectorTest(
      'a near filter keeps cards at least minSimilarity similar, and composes',
      async (assert) => {
        await index(seed);
        let near = (minSimilarity?: number) => ({
          on: momentRef,
          near: {
            embedding: {
              to: [1, 0, 0],
              ...(minSimilarity == null ? {} : { minSimilarity }),
            },
          },
        });
        assert.deepEqual(
          (await nearIds({ filter: near(0.5) })).sort(),
          ['close.json', 'same.json'],
          'cosine 1 and 0.707 pass 0.5; 0 and -1 do not',
        );
        assert.deepEqual(
          (await nearIds({ filter: near() })).sort(),
          ['close.json', 'opposite.json', 'orthogonal.json', 'same.json'],
          'without a threshold it keeps every card with a vector',
        );
        assert.deepEqual(
          await nearIds({
            filter: {
              on: momentRef,
              every: [{ eq: { topic: 'a' } }, near(-0.5)],
            },
            sort: [{ on: momentRef, by: 'embedding', near: [1, 0, 0] }],
          }),
          ['same.json', 'orthogonal.json'],
          'with eq under every, ranked by the near sort',
        );
        assert.deepEqual(
          (await nearIds({ filter: { not: near(0.5) } })).sort(),
          ['none.json', 'opposite.json', 'orthogonal.json'],
          'negated',
        );
        try {
          await nearIds({
            filter: {
              on: momentRef,
              near: { title: { to: [1, 0, 0] } },
            },
          });
          assert.ok(false, 'expected an error');
        } catch (e) {
          assert.ok(/requires "title" to be a VectorField/.test(String(e)));
        }
      },
    );

    pgvectorTest(
      'a near filter on a plural field matches when any vector qualifies',
      async (assert) => {
        await index({
          far: { title: 'far', segments: [{ embedding: vec([-1, 0, 0]) }] },
          mixed: {
            title: 'mixed',
            segments: [
              { embedding: vec([0, -1, 0]) },
              { embedding: vec([1, 0.1, 0]) },
            ],
          },
        });
        assert.deepEqual(
          await nearIds({
            filter: {
              on: momentRef,
              near: {
                'segments.embedding': { to: [1, 0, 0], minSimilarity: 0.9 },
              },
            },
          }),
          ['mixed.json'],
        );
      },
    );
  });

  module('without pgvector', function (hooks) {
    let adapter: PgAdapter;

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
      // Recreate a database whose Postgres has no pgvector: the migration
      // leaves no vector table there. Dropped before anything probes this
      // adapter, since the probe is cached per adapter.
      await adapter.execute(`DROP TABLE IF EXISTS boxel_index_vectors`);
    });

    hooks.afterEach(async function () {
      await closeTestPgAdapter(adapter);
    });

    test('indexing still works, and a near sort is refused with a clear message', async function (assert) {
      assert.false(await hasVectorIndex(adapter));
      let virtualNetwork = new VirtualNetwork();
      let batch = await new IndexWriter(adapter).createBatch(
        new URL(testRealm),
        virtualNetwork,
        undefined,
        { splitPrerenderHtml: false },
      );
      let cardURL = new URL(url('solo'));
      await batch.updateEntry(cardURL, {
        type: 'instance',
        resource: {
          id: rri(cardURL.href),
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: { module: rri(momentRef.module), name: 'Moment' },
          },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData: { title: 'solo', embedding: vec([1, 0, 0]) },
        deps: new Set(),
        displayNames: ['Moment'],
        types: [internalKeyFor(momentRef, undefined, virtualNetwork)],
        isolatedHtml: '<div>solo</div>',
      });
      await batch.done();

      let engine = new IndexQueryEngine(
        adapter,
        makeDefinitionLookup(),
        virtualNetwork,
      );
      let { cards } = await engine.searchCards(new URL(testRealm), {});
      assert.strictEqual(cards.length, 1, 'the card indexed');
      try {
        await engine.searchCards(new URL(testRealm), {
          sort: [{ on: momentRef, by: 'embedding', near: [1, 0, 0] }],
        });
        assert.ok(false, 'expected an error');
      } catch (e) {
        assert.ok(e instanceof InvalidQueryError);
        assert.ok(/needs the pgvector Postgres extension/.test(String(e)));
      }
    });
  });
});
