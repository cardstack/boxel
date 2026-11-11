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
  isClientSortable,
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
  collectSearchDocVectors,
  hasVectorIndex,
  internalKeyFor,
  rri,
  setVectorSearchSettings,
  vectorStoreFor,
  type Definition,
  type DefinitionLookup,
  type EveryFilter,
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
const numberRef = ref('@cardstack/base/number', 'default');
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
  fields: {
    title: 'f0',
    topic: 'f0',
    embedding: 'f1',
    segments: 'f2',
    views: 'f3',
  },
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
      // opted in to look-alike lookups (a window's compare.near)
      search: { neighbors: true },
    },
    f2: {
      type: 'containsMany',
      isPrimitive: false,
      isComputed: false,
      fieldOrCard: segmentRef,
    },
    f3: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: numberRef,
      serializerName: 'number',
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

    test('a blend sort round-trips through the wire grammar', function (assert) {
      let query: Query = {
        filter: { on: momentRef, matches: 'pasta' },
        sort: [
          {
            by: '_blend',
            k: 30,
            of: [
              { by: '_matchRelevance' },
              { on: momentRef, by: 'embedding', near: [1, 0, 0], weight: 2 },
              { by: 'createdAt', direction: 'desc' },
            ],
          },
        ],
      };
      let wire = searchEntryWireQueryFromQuery(query);
      assert.deepEqual(wire.sort as any, [
        {
          k: 30,
          blend: [
            { by: 'item.textRelevance' },
            {
              by: 'item.embedding',
              'item.on': momentRef,
              near: [1, 0, 0],
              weight: 2,
            },
            { by: 'item.createdAt', direction: 'desc' },
          ],
        },
      ]);
      let parsed = parseSearchEntryQueryFromPayload(wire);
      assert.deepEqual(parsed.itemQuery.sort, query.sort);
    });

    test('blend sorts defer to the server in live queries', function (assert) {
      assert.false(
        isClientSortable([{ by: '_blend', of: [{ by: 'createdAt' }] }] as any),
      );
      assert.true(
        isClientSortable([
          { on: momentRef, by: 'embedding', near: [1] },
        ] as any),
      );
    });

    test('the federated merge orders a blend-sorted search by _blendScore', function (assert) {
      let entry = (id: string, score?: number) => ({
        type: 'entry' as const,
        id,
        relationships: {},
        ...(score == null ? {} : { meta: { _blendScore: score } }),
      });
      let docs = [
        {
          data: [entry('a1', 0.03), entry('a2', 0.01)],
          meta: { page: { total: 2 } },
        },
        {
          data: [entry('b1', 0.032), entry('b2')],
          meta: { page: { total: 2 } },
        },
      ] as any;
      let merged = combineSearchEntryResults(docs, 2, {
        key: '_blendScore',
        direction: 'desc',
      });
      assert.deepEqual(
        merged.data.map((e) => e.id),
        ['b1', 'a1', 'a2', 'b2'],
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
        key: '_nearSimilarity',
        direction: 'desc',
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
      assertQuery({
        sort: [
          {
            by: '_blend',
            of: [
              { by: 'createdAt' },
              { on: momentRef, by: 'views', weight: 0.5 },
            ],
          },
        ],
      } as any);
      assert.throws(
        () => assertQuery({ sort: [{ by: '_blend', of: [] }] } as any),
        /a blend needs an array of the sort entries/,
      );
      assert.throws(
        () =>
          assertQuery({
            sort: [
              {
                by: '_blend',
                of: [{ by: '_blend', of: [{ by: 'createdAt' }] }],
              },
            ],
          } as any),
        /cannot contain another/,
      );
      assert.throws(
        () =>
          assertQuery({
            sort: [
              { by: '_blend', method: 'weighted', of: [{ by: 'createdAt' }] },
            ],
          } as any),
        /supports method "rrf"/,
      );
      assert.throws(
        () =>
          assertQuery({
            sort: [{ by: '_blend', of: [{ by: 'createdAt', weight: 0 }] }],
          } as any),
        /weight must be a nonzero number/,
      );
      assert.throws(
        () =>
          assertQuery({
            sort: [{ by: '_blend', of: [{ by: '_matchRelevance' }] }],
          } as any),
        /requires at least one positive `matches` filter/,
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
      for (let [name, card] of Object.entries(cards)) {
        // `__createdAt` and `__markdown` set the row's creation time and its
        // rendered text (what `matches` searches); the rest is the search doc.
        let { __createdAt, __markdown, ...searchData } = card as {
          __createdAt?: number;
          __markdown?: string;
        } & Record<string, unknown>;
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
          resourceCreatedAt: __createdAt ?? Date.now(),
          searchData,
          ...(__markdown ? { markdown: __markdown } : {}),
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

    test("promotion stores each row's full-text vector and keeps it in step with its markdown", async function (assert) {
      let tsvOf = async (name: string) =>
        (
          (await adapter.execute(
            `SELECT markdown_tsv::text AS tsv FROM prerendered_html WHERE url = $1 AND type = 'instance'`,
            { bind: [url(name)] },
          )) as { tsv: string | null }[]
        )[0]?.tsv ?? null;
      await index({
        talk: { title: 'talk', __markdown: 'a talk about lighthouses' },
      });
      assert.ok(
        (await tsvOf('talk'))?.includes("'lighthous'"),
        'the first promotion stores the vector',
      );
      await index({ talk: { title: 'talk', __markdown: 'notes on harbours' } });
      let updated = await tsvOf('talk');
      assert.ok(updated?.includes("'harbour'"), 'a later pass replaces it');
      assert.notOk(updated?.includes('lighthous'), 'the old words are gone');
      await index({ talk: { title: 'talk' } });
      assert.strictEqual(
        await tsvOf('talk'),
        null,
        'a pass with no markdown clears it',
      );
      await index({ talk: { title: 'talk', __markdown: 'notes on harbours' } });
      let { meta } = await engine.searchCards(new URL(testRealm), {
        filter: { matches: '"notes on harbours"' },
      });
      assert.strictEqual(meta.page.total, 1, 'a phrase finds the promoted row');
    });

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

    // Blend fixtures (target [1, 0, 0]):
    //   near:   a 1.0, b 0.707, c 0.0, d no vector
    //   views:  b 1000, c 500, d 50, a 10
    //   age:    b oldest, then a, d, c newest
    //   text:   only c mentions "recipe"
    const t = Date.UTC(2026, 0, 1);
    const blendSeed = {
      a: {
        title: 'a',
        views: 10,
        embedding: vec([1, 0, 0]),
        __createdAt: t + 1000,
        __markdown: 'cooking pasta',
      },
      b: {
        title: 'b',
        views: 1000,
        embedding: vec([1, 1, 0]),
        __createdAt: t,
        __markdown: 'pasta',
      },
      c: {
        title: 'c',
        views: 500,
        embedding: vec([0, 1, 0]),
        __createdAt: t + 3000,
        __markdown: 'a pasta recipe',
      },
      d: {
        title: 'd',
        views: 50,
        __createdAt: t + 2000,
        __markdown: 'nothing here',
      },
    };
    const near = { on: momentRef, by: 'embedding', near: [1, 0, 0] };
    const views = { on: momentRef, by: 'views' };

    async function blendRows(query: Query) {
      let { results } = await engine.search(
        new URL(testRealm),
        query,
        {},
        { kind: 'renderSet' },
      );
      return results.map((r) => [
        r.url!.replace(`${testRealm}Moment/`, '').replace('.json', ''),
        Number(Number((r as any)._blendScore).toFixed(6)),
      ]);
    }

    pgvectorTest(
      "a one-card binding's vector is a near target",
      async function (assert) {
        await index({
          a: { title: 'a', views: 10, embedding: vec([1, 0, 0]) },
          b: { title: 'b', views: 50, embedding: vec([0.99, 0.1, 0]) },
          c: { title: 'c', views: 20, embedding: vec([0, 1, 0]) },
        });
        let { results, meta } = await engine.search(
          new URL(testRealm),
          {
            let: {
              $a: {
                from: { filter: { on: momentRef, eq: { title: 'a' } } },
                one: true,
              },
            },
            filter: {
              on: momentRef,
              near: {
                embedding: {
                  to: '$a.embedding',
                  minSimilarity: 0.5,
                },
              },
            },
            sort: [
              {
                on: momentRef,
                by: 'embedding',
                near: '$a.embedding',
              },
            ],
          } as unknown as Query, // a binding reference resolves before the engine reads it
          {},
          { kind: 'renderSet' },
        );
        assert.deepEqual(
          results.map((r: any) =>
            r.url.replace(`${testRealm}Moment/`, '').replace('.json', ''),
          ),
          ['a', 'b'],
          'nearest first, and c is too far',
        );
        assert.deepEqual((meta as any).lets, {
          $a: { strategy: 'card', found: true },
        });
      },
    );

    pgvectorTest(
      "a bound card whose vector can't be read is a missing near target, not an error",
      async function (assert) {
        await index({
          a: { title: 'a', embedding: vec([1, 0, 0]) },
          b: { title: 'b', embedding: vec([0.9, 0.1, 0]) },
        });
        // The search doc keeps a reference to a spilled vector whose row is
        // gone, as an index copied without its spill table has.
        await adapter.execute(
          `UPDATE boxel_index SET search_doc = jsonb_set(search_doc, '{embedding}', '{"ref": "gone", "$spilled": "vector"}'::jsonb) WHERE url = $1 AND type = 'instance'`,
          { bind: [url('a')] },
        );
        let { results } = await engine.search(
          new URL(testRealm),
          {
            let: {
              $me: {
                from: { filter: { on: momentRef, eq: { title: 'a' } } },
                one: true,
              },
            },
            filter: { type: momentRef },
            sort: [
              {
                on: momentRef,
                by: 'embedding',
                near: '$me.embedding',
              },
            ],
          } as unknown as Query,
          {},
          { kind: 'renderSet' },
        );
        assert.strictEqual(results.length, 2, 'the search answers');
      },
    );

    pgvectorTest(
      "under a policy, rows the caller cannot see never take an admitted look-alike's place",
      async function (assert) {
        let visible = {
          a: { title: 'a', views: 10, embedding: vec([1, 0, 0]) },
          b: { title: 'b', views: 50, embedding: vec([0.99, 0.1, 0]) },
          c: { title: 'c', views: 20, embedding: vec([0.98, 0.15, 0]) },
          d: { title: 'd', views: 5, embedding: vec([0, 1, 0]) },
          e: { title: 'e', views: 100, embedding: vec([0, 0.99, 0.1]) },
        };
        let grant = { on: momentRef, in: { title: Object.keys(visible) } };
        let scored = async () => {
          let { results, meta } = await engine.search(
            new URL(testRealm),
            {
              filter: { type: momentRef },
              sort: [
                {
                  expression: 'views / stats.views.median',
                  compare: {
                    near: 'embedding',
                    k: 2,
                    minSimilarity: 0.5,
                    filter: grant,
                  },
                },
              ],
            } as unknown as Query,
            { grantFilter: grant },
            { kind: 'renderSet' },
          );
          return {
            rows: results.map((r: any) => [
              r.url.replace(`${testRealm}Moment/`, '').replace('.json', ''),
              r._window == null ? null : Number(Number(r._window).toFixed(3)),
            ]),
            total: meta.page.total,
          };
        };
        await index(visible);
        let before = await scored();
        // Ten hidden moments, each nearer to a, b and c than any visible one.
        let hidden = Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [
            `h${i}`,
            {
              title: `hidden ${i}`,
              views: 1_000_000,
              embedding: vec([1, 0.001 * (i + 1), 0.0005]),
            },
          ]),
        );
        await index({ ...visible, ...hidden });
        let after = await scored();
        let [vectors] = await adapter.execute(
          `SELECT count(*)::int AS n FROM boxel_index_vectors WHERE realm_url = $1`,
          { bind: [testRealm] },
        );
        assert.strictEqual(vectors.n, 15, 'the hidden moments are indexed');
        assert.deepEqual(
          after,
          before,
          'the rows, their scores and the total are what they were',
        );
        assert.strictEqual(before.total, 5);
      },
    );

    pgvectorTest(
      "near compares only vectors in the field's declared space",
      async function (assert) {
        const space = 'x@1 p 3';
        let declared = {
          _vectorFields: {
            embedding: { space, list: false, computed: false },
          },
        };
        await index({
          a: { title: 'a', views: 10, embedding: vec([1, 0, 0]), ...declared },
          b: {
            title: 'b',
            views: 50,
            embedding: vec([0.9, 0.1, 0]),
            ...declared,
          },
          c: {
            title: 'c',
            views: 20,
            embedding: vec([1, 0.01, 0]),
            ...declared,
          },
          d: { title: 'd', views: 5, embedding: vec([0, 1, 0]), ...declared },
        });
        let stored = await adapter.execute(
          `SELECT DISTINCT space FROM boxel_index_vectors WHERE realm_url = $1`,
          { bind: [testRealm] },
        );
        assert.deepEqual(
          stored.map((r) => r.space),
          [space],
          'each vector is stored in its declared space',
        );
        // c's vector is left from before spaces were recorded: the same size,
        // but in no space the field declares.
        await adapter.execute(
          `UPDATE boxel_index_vectors SET space = '' WHERE url = $1`,
          { bind: [url('c')] },
        );
        let similarity = async (query: Query) =>
          Object.fromEntries(
            (
              await engine.search(
                new URL(testRealm),
                query,
                {},
                {
                  kind: 'dataOnly',
                },
              )
            ).results.map((r: any) => [
              r.url.replace(`${testRealm}Moment/`, '').replace('.json', ''),
              r._nearSimilarity == null
                ? null
                : Number(Number(r._nearSimilarity).toFixed(3)),
            ]),
          );
        let sorted = await similarity({
          filter: { type: momentRef },
          sort: [{ on: momentRef, by: 'embedding', near: [1, 0, 0] }],
        });
        assert.strictEqual(sorted.c, null, 'a numeric target skips c');
        assert.strictEqual(sorted.a, 1);
        assert.deepEqual(
          await nearIds({
            filter: {
              on: momentRef,
              near: { embedding: { to: [1, 0, 0], minSimilarity: 0.5 } },
            },
            sort: [{ on: momentRef, by: 'title' }],
          }),
          ['a.json', 'b.json'],
          'so does a near filter',
        );
        assert.deepEqual(
          await nearIds({
            filter: { type: momentRef },
            sort: [
              {
                by: '_blend',
                of: [{ on: momentRef, by: 'embedding', near: [1, 0, 0] }],
              },
            ],
          }),
          ['a.json', 'b.json', 'd.json', 'c.json'],
          'and a near signal in a blend: c has no signal, so it comes last',
        );
        // The look-alike join pairs a card only with vectors in its space.
        let { results } = await engine.search(
          new URL(testRealm),
          {
            filter: { type: momentRef },
            sort: [
              {
                expression: 'stats.similarity.count',
                compare: { near: 'embedding', k: 3 },
              },
            ],
          } as unknown as Query,
          {},
          { kind: 'dataOnly' },
        );
        let counts = Object.fromEntries(
          results.map((r: any) => [
            r.url.replace(`${testRealm}Moment/`, '').replace('.json', ''),
            r._window == null ? null : Number(r._window),
          ]),
        );
        assert.strictEqual(counts.a, 2, "a's look-alikes are b and d, not c");
        assert.notOk(counts.c, 'c has no look-alikes of its own');
      },
    );

    pgvectorTest(
      'a window compares each card with its own look-alikes',
      async function (assert) {
        await index({
          a: { title: 'a', views: 10, embedding: vec([1, 0, 0]) },
          b: { title: 'b', views: 50, embedding: vec([0.99, 0.1, 0]) },
          c: { title: 'c', views: 20, embedding: vec([0.98, 0.15, 0]) },
          d: { title: 'd', views: 5, embedding: vec([0, 1, 0]) },
          e: { title: 'e', views: 100, embedding: vec([0, 0.99, 0.1]) },
        });
        let rerankRows = async (window: any) => {
          let { results, meta } = await engine.search(
            new URL(testRealm),
            { filter: { type: momentRef }, sort: [window] } as Query,
            {},
            { kind: 'renderSet' },
          );
          return {
            rows: results.map((r: any) => [
              r.url.replace(`${testRealm}Moment/`, '').replace('.json', ''),
              r._window == null ? null : Number(Number(r._window).toFixed(3)),
            ]),
            meta,
          };
        };
        // Views against the median of each card's two nearest look-alikes
        // (d and e have only each other above 0.5).
        let { rows } = await rerankRows({
          expression: 'views / stats.views.median',
          compare: { near: 'embedding', k: 2, minSimilarity: 0.5 },
        });
        assert.deepEqual(rows, [
          ['e', 20],
          ['b', 3.333],
          ['c', 0.667],
          ['a', 0.286],
          ['d', 0.05],
        ]);
        let similar = await rerankRows({
          expression: 'MAX(peers.similarity)',
          compare: { near: 'embedding', k: 1 },
        });
        assert.ok(
          similar.rows.every(([, v]) => typeof v === 'number' && v > 0.9),
          "each card's twin is nearly identical",
        );
        await assert.rejects(
          rerankRows({ expression: 'views', compare: { near: 'views' } }),
          /declare the field with search: \{ neighbors: true \}/,
          'a field that has not opted in is refused',
        );
      },
    );

    pgvectorTest(
      'a blend fuses similarity and engagement by reciprocal rank',
      async (assert) => {
        await index(blendSeed);
        // near ranks a1 b2 c3 (d none); views rank b1 c2 d3 a4; k = 60
        assert.deepEqual(
          await nearIds({ sort: [{ by: '_blend', of: [near, views] }] }),
          ['b.json', 'a.json', 'c.json', 'd.json'],
          'b 1/62+1/61 > a 1/61+1/64 > c 1/63+1/62 > d 1/63',
        );
        assert.deepEqual(
          await blendRows({
            sort: [{ by: '_blend', of: [near, views] }],
            page: { size: 2 },
          }),
          [
            ['b', Number((1 / 62 + 1 / 61).toFixed(6))],
            ['a', Number((1 / 61 + 1 / 64).toFixed(6))],
          ],
          'meta._blendScore carries the fused score; paging keeps global ranks',
        );
        assert.deepEqual(
          await nearIds({
            sort: [{ by: '_blend', of: [{ ...near, weight: 3 }, views] }],
          }),
          ['a.json', 'b.json', 'c.json', 'd.json'],
          'tripling the similarity weight puts a first',
        );
      },
    );

    pgvectorTest(
      'a blend ranks recency, with weights, and a signal a card lacks adds nothing',
      async (assert) => {
        await index(blendSeed);
        // createdAt desc ranks c1 d2 a3 b4; recency at half weight
        assert.deepEqual(
          await nearIds({
            sort: [
              { by: '_blend', of: [near, { by: 'createdAt', weight: 0.5 }] },
            ],
          }),
          ['a.json', 'c.json', 'b.json', 'd.json'],
          'a 1/61+.5/63, c 1/63+.5/61, b 1/62+.5/64, d .5/62',
        );
        assert.deepEqual(
          await nearIds({
            sort: [
              {
                by: '_blend',
                of: [near, { by: 'createdAt', direction: 'asc', weight: 0.5 }],
              },
            ],
          }),
          ['a.json', 'b.json', 'c.json', 'd.json'],
          'direction asc ranks the oldest first',
        );
      },
    );

    pgvectorTest(
      'a blend fuses full-text relevance with similarity over an any() filter',
      async (assert) => {
        await index(blendSeed);
        let filter = {
          any: [
            { on: momentRef, matches: 'recipe' },
            {
              on: momentRef,
              near: { embedding: { to: [1, 0, 0], minSimilarity: -1 } },
            },
          ],
        } as any;
        // a, b, c match (d has no vector and no "recipe"); only c has text
        // relevance, so a and b get similarity alone
        assert.deepEqual(
          await nearIds({
            filter,
            sort: [{ by: '_blend', of: [{ by: '_matchRelevance' }, near] }],
          }),
          ['c.json', 'a.json', 'b.json'],
          'c 1/61+1/63 > a 1/61 > b 1/62',
        );
        try {
          await nearIds({
            filter: { on: momentRef, eq: { title: 'a' } },
            sort: [{ by: '_blend', of: [{ by: '_matchRelevance' }, near] }],
          });
          assert.ok(false, 'expected an error');
        } catch (e) {
          assert.ok(
            /requires at least one positive `matches` filter/.test(String(e)),
          );
        }
      },
    );

    pgvectorTest(
      'a blend composes with filters, a tiebreak sort and the data projection',
      async (assert) => {
        await index(blendSeed);
        assert.deepEqual(
          await nearIds({
            filter: { on: momentRef, not: { eq: { title: 'b' } } },
            sort: [{ by: '_blend', of: [near, views] }, { by: 'cardURL' }],
          }),
          ['c.json', 'a.json', 'd.json'],
          'ranks are over the filtered set: c 1/62+1/61 > a 1/61+1/63 > d 1/62',
        );
      },
    );

    // Where each row sits: the partition (by name) that holds it.
    async function partitionsOf() {
      return (await adapter.execute(
        `SELECT v.url, v.space, c.relname AS part
           FROM boxel_index_vectors AS v JOIN pg_class AS c ON c.oid = v.tableoid
          WHERE v.realm_url = $1 ORDER BY v.url`,
        { bind: [testRealm] },
      )) as { url: string; space: string; part: string }[];
    }
    async function catalog() {
      return Object.fromEntries(
        (
          await adapter.execute(
            'SELECT space, partition_name, dims FROM boxel_vector_spaces',
          )
        ).map((r) => [
          String(r.space),
          { part: String(r.partition_name), dims: Number(r.dims) },
        ]),
      );
    }
    const declaredIn = (space: string) => ({
      _vectorFields: { embedding: { space, list: false, computed: false } },
    });

    pgvectorTest(
      "vectors land in their space's partition, made on the space's first write",
      async (assert) => {
        const A = 'part@1 p 3';
        const B = 'other/model@2 q 3';
        await index({
          a: { title: 'a', embedding: vec([1, 0, 0]), ...declaredIn(A) },
          b: { title: 'b', embedding: vec([0, 1, 0]), ...declaredIn(A) },
          c: { title: 'c', embedding: vec([1, 1, 0]), ...declaredIn(B) },
        });
        let spaces = await catalog();
        assert.deepEqual(
          Object.keys(spaces).sort(),
          [B, A].sort(),
          'each space was given a partition when its first vector was written',
        );
        assert.strictEqual(spaces[A].dims, 3, 'the catalog records the size');
        assert.ok(
          /^boxel_index_vectors_part_3_[0-9a-f]{8}$/.test(spaces[A].part),
          `a readable prefix and a hash of the space: ${spaces[A].part}`,
        );
        assert.deepEqual(
          (await partitionsOf()).map((r) => [r.url, r.part]),
          [
            [url('a'), spaces[A].part],
            [url('b'), spaces[A].part],
            [url('c'), spaces[B].part],
          ],
          "each row is in its space's partition",
        );
        let [inDefault] = await adapter.execute(
          'SELECT count(*)::int AS n FROM boxel_index_vectors_default',
        );
        assert.strictEqual(inDefault.n, 0, 'the default partition is empty');

        // c's field moves to another space: its row leaves B's partition.
        const C = 'part@3 p 3';
        await index({
          c: { title: 'c', embedding: vec([1, 1, 0]), ...declaredIn(C) },
        });
        spaces = await catalog();
        let rows = await partitionsOf();
        assert.deepEqual(
          rows.filter((r) => r.url === url('c')).map((r) => [r.space, r.part]),
          [[C, spaces[C].part]],
          "a field that changes space moves its row to the new space's partition",
        );
        let [leftInB] = await adapter.execute(
          `SELECT count(*)::int AS n FROM ${spaces[B].part}`,
        );
        assert.strictEqual(leftInB.n, 0, 'and nothing is left in the old one');
        assert.deepEqual(
          await nearIds({
            filter: { type: momentRef },
            sort: [{ on: momentRef, by: 'embedding', near: [1, 0, 0] }],
          }),
          ['c.json', 'a.json', 'b.json'],
          // This fixture's definition declares no space, so the engine falls
          // back to the space of the most recently indexed card: c, in C.
          'with no space in the definition, a near sort reads the space of the most recently indexed card, from its partition',
        );
      },
    );

    pgvectorTest(
      'a vector written before its space has a partition is moved into it',
      async (assert) => {
        const A = 'late@1 p 3';
        // A writer that does not make partitions (the previous revision,
        // mid-rollout) leaves its rows in the default partition.
        await adapter.execute(
          `INSERT INTO boxel_index_vectors (realm_url, url, type, field_path, item_id, dims, embedding, space)
           VALUES ($1, $2, 'instance', 'embedding', '', 3, '[0,0,1]'::vector, $3)`,
          { bind: [testRealm, url('early'), A] },
        );
        let [before] = await adapter.execute(
          'SELECT count(*)::int AS n FROM boxel_index_vectors_default',
        );
        assert.strictEqual(
          before.n,
          1,
          'the row waits in the default partition',
        );
        await index({
          a: { title: 'a', embedding: vec([1, 0, 0]), ...declaredIn(A) },
        });
        let spaces = await catalog();
        assert.deepEqual(
          (await partitionsOf()).map((r) => [r.url, r.part]),
          [
            [url('a'), spaces[A].part],
            [url('early'), spaces[A].part],
          ],
          "both rows are in the space's partition",
        );
      },
    );

    pgvectorTest(
      'the partitioning migration goes down to one table and up again, keeping every row',
      async (assert) => {
        // a few spaces, and a row of each
        for (let [i, space] of ['m@1 p 3', 'm@2 p 3', ''].entries()) {
          await adapter.execute(
            `INSERT INTO boxel_index_vectors (realm_url, url, type, field_path, item_id, dims, embedding, space)
             VALUES ($1, $2, 'instance', 'embedding', '', 3, '[1,2,3]'::vector, $3)`,
            { bind: [testRealm, url(`m${i}`), space] },
          );
        }
        let migration = (await import(
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore a CommonJS migration, required for its SQL
          '../../postgres/migrations/1794253807954_partition-boxel-index-vectors-by-space.js'
        )) as { up: Function; down: Function };
        let run = async (step: Function) => {
          let statements: string[] = [];
          step({ sql: (sql: string) => statements.push(sql) });
          for (let sql of statements) {
            await adapter.execute(sql);
          }
        };
        let shape = async () => {
          let [row] = await adapter.execute(
            `SELECT c.relkind AS kind,
                    (SELECT count(*)::int FROM boxel_index_vectors) AS n,
                    to_regclass('boxel_vector_spaces') IS NOT NULL AS catalog
               FROM pg_class AS c WHERE c.relname = 'boxel_index_vectors'`,
          );
          return [row.kind, row.n, row.catalog];
        };
        assert.deepEqual(await shape(), ['p', 3, true], 'partitioned');
        await run(migration.down);
        assert.deepEqual(await shape(), ['r', 3, false], 'down: one table');
        await run(migration.up);
        assert.deepEqual(await shape(), ['p', 3, true], 'up again');
        let [parts] = await adapter.execute(
          `SELECT count(*)::int AS n FROM boxel_vector_spaces`,
        );
        assert.strictEqual(
          parts.n,
          3,
          'one partition per space, the empty one too',
        );
        let [inDefault] = await adapter.execute(
          'SELECT count(*)::int AS n FROM boxel_index_vectors_default',
        );
        assert.strictEqual(inDefault.n, 0, 'and none in the default partition');
        await run(migration.up);
        assert.deepEqual(
          await shape(),
          ['p', 3, true],
          'a second up changes nothing',
        );
      },
    );
  });

  module('approximate near search (Postgres + pgvector)', function (hooks) {
    let adapter: PgAdapter;
    let indexWriter: IndexWriter;
    let engine: IndexQueryEngine;
    let virtualNetwork: VirtualNetwork;
    let momentKey: string;
    let vectorsAvailable: boolean;
    const otherRealm = testRealm.replace(/\/$/, '-other/');
    const SPACE = 'seg/model@1 test 16';
    const DIMS = 16;
    // The threshold these tests run under: a few thousand vectors stand in
    // for a space past the deployment's (100,000).
    const APPROXIMATE = { exactThreshold: 5_000 };

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
      setVectorSearchSettings(APPROXIMATE);
    });

    hooks.afterEach(async function () {
      setVectorSearchSettings();
      await closeTestPgAdapter(adapter);
    });

    // A seeded random number generator (mulberry32), so every run sees the
    // same vectors.
    function random(seed: number) {
      return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
      };
    }
    function randomVector(next: () => number) {
      return Array.from({ length: DIMS }, () => next());
    }

    // `cards` cards in `realm`, each holding `perCard` segment vectors in
    // SPACE, and its own `views`.
    async function seed(realm: string, cards: number, perCard: number) {
      let next = random(realm.length * 7919 + cards);
      let batch = await indexWriter.createBatch(
        new URL(realm),
        virtualNetwork,
        undefined,
        { splitPrerenderHtml: false },
      );
      for (let c = 0; c < cards; c++) {
        let cardURL = new URL(`${realm}Moment/m${c}.json`);
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
          searchData: {
            title: `m${c}`,
            topic: c % 10 === 0 ? 'rare' : 'common',
            views: c,
            segments: Array.from({ length: perCard }, () => ({
              embedding: vec(randomVector(next)),
            })),
            _vectorFields: {
              'segments.embedding': {
                space: SPACE,
                list: true,
                computed: false,
              },
            },
          },
          deps: new Set(),
          displayNames: ['Moment'],
          types: [momentKey],
          isolatedHtml: `<div>m${c}</div>`,
        });
      }
      await batch.done();
      // the index the writer starts building after the commit
      await vectorStoreFor(adapter).buildIndexes();
      await adapter.execute('ANALYZE boxel_index_vectors');
    }

    async function nearPage(
      realm: string,
      target: number[],
      extra: Partial<Query> = {},
    ) {
      let { results, meta } = await engine.search(
        new URL(realm),
        {
          filter: { type: momentRef },
          sort: [{ on: momentRef, by: 'segments.embedding', near: target }],
          page: { size: 10 },
          ...extra,
        } as Query,
        {},
        { kind: 'dataOnly' },
      );
      return {
        meta,
        rows: results.map((r: any) => ({
          url: String(r.url),
          sim: r._nearSimilarity == null ? null : Number(r._nearSimilarity),
        })),
      };
    }

    async function exactly<T>(fn: () => Promise<T>): Promise<T> {
      setVectorSearchSettings({ exactThreshold: Number.MAX_SAFE_INTEGER });
      try {
        return await fn();
      } finally {
        setVectorSearchSettings(APPROXIMATE);
      }
    }

    pgvectorTest(
      'over more vectors than the threshold, a near sort reads an approximate index and re-scores exactly',
      async (assert) => {
        await seed(testRealm, 100, 60); // 6,000 vectors
        let [index] = await adapter.execute(
          `SELECT count(*)::int AS n FROM pg_indexes WHERE indexname LIKE 'boxel_index_vectors_seg_model_16_%_hnsw'`,
        );
        assert.strictEqual(index.n, 1, "the space's partition has its index");
        let next = random(42);
        let recall = 0;
        const QUERIES = 10;
        for (let q = 0; q < QUERIES; q++) {
          let target = randomVector(next);
          let approximate = await nearPage(testRealm, target);
          let exact = await exactly(() => nearPage(testRealm, target));
          assert.strictEqual(approximate.meta.near?.path, 'hnsw');
          assert.strictEqual(exact.meta.near?.path, 'exact');
          assert.strictEqual(approximate.rows.length, 10, 'a full page');
          let exactSims = new Map(exact.rows.map((r) => [r.url, r.sim]));
          recall +=
            approximate.rows.filter((r) => exactSims.has(r.url)).length / 10;
          assert.ok(
            approximate.rows.every(
              (r, i) => i === 0 || approximate.rows[i - 1].sim! >= r.sim!,
            ),
            'the page is ordered by exact similarity',
          );
          assert.ok(
            approximate.rows
              .filter((r) => exactSims.has(r.url))
              .every((r) => Math.abs(r.sim! - exactSims.get(r.url)!) < 1e-9),
            'each similarity is the exact one, not the index estimate',
          );
          assert.strictEqual(
            approximate.meta.page.total,
            exact.meta.page.total,
            'the total counts every match',
          );
        }
        assert.ok(
          recall / QUERIES >= 0.95,
          `recall@10 against exact search is ${(recall / QUERIES).toFixed(3)}`,
        );
        let report = (await nearPage(testRealm, randomVector(next))).meta.near!;
        assert.strictEqual(report.threshold, 5000);
        assert.ok(report.candidates > 5000, 'it counted past the threshold');
        assert.strictEqual(report.efSearch, 100);
        assert.ok((report.rescored ?? 0) >= 10, 'and re-scored the candidates');
      },
    );

    pgvectorTest(
      'below the threshold a near sort is exact, as before',
      async (assert) => {
        await seed(testRealm, 20, 10); // 200 vectors
        let target = randomVector(random(7));
        let page = await nearPage(testRealm, target);
        assert.deepEqual(
          { path: page.meta.near?.path, reason: page.meta.near?.reason },
          { path: 'exact', reason: 'below-threshold' },
        );
        assert.strictEqual(page.meta.near?.candidates, 200);
        assert.notOk(page.meta.warnings, 'no warning');
      },
    );

    pgvectorTest(
      'a space is read exactly until its vectors pass the threshold, then its index is built and read, with the same answers',
      async (assert) => {
        let validIndexes = async () =>
          Number(
            (
              await adapter.execute(
                `SELECT count(*)::int AS n FROM pg_index AS i JOIN pg_class AS c ON c.oid = i.indexrelid
                  WHERE c.relname LIKE 'boxel_index_vectors_seg_model_16_%_hnsw' AND i.indisvalid`,
              )
            )[0].n,
          );
        setVectorSearchSettings({ exactThreshold: 1_000 });
        await seed(testRealm, 20, 10); // 200 vectors
        assert.strictEqual(
          await validIndexes(),
          0,
          'a space under the threshold has no index',
        );
        let target = randomVector(random(11));
        setVectorSearchSettings({ exactThreshold: 100 });
        let before = await nearPage(testRealm, target);
        assert.deepEqual(
          { path: before.meta.near?.path, reason: before.meta.near?.reason },
          { path: 'exact', reason: 'no-index' },
          'past the threshold, a space with no index yet is read exactly',
        );
        // another realm's vectors take the space past the threshold: the
        // writer builds its index after the commit (`seed` waits for it)
        await seed(otherRealm, 20, 10);
        assert.strictEqual(await validIndexes(), 1, 'the index is built');
        let after = await nearPage(testRealm, target);
        assert.strictEqual(after.meta.near?.path, 'hnsw', 'and read');
        assert.deepEqual(
          after.rows,
          before.rows,
          'the same page, with the same similarities',
        );
        setVectorSearchSettings({ exactThreshold: 1_000_000 });
        await vectorStoreFor(adapter).buildIndexes([SPACE]);
        assert.strictEqual(
          await validIndexes(),
          1,
          'an index is never dropped when its space falls under the threshold',
        );
      },
    );

    pgvectorTest(
      'a realm sharing a space with another gets a full page of its own rows',
      async (assert) => {
        await seed(testRealm, 100, 60);
        await seed(otherRealm, 100, 60);
        let next = random(99);
        for (let q = 0; q < 3; q++) {
          let target = randomVector(next);
          let page = await nearPage(otherRealm, target);
          assert.strictEqual(page.meta.near?.path, 'hnsw');
          assert.strictEqual(page.rows.length, 10, 'a full page');
          assert.ok(
            page.rows.every(
              (r) => r.url.startsWith(otherRealm) && r.sim != null,
            ),
            "only the realm's own cards, each with its similarity",
          );
          let exact = await exactly(() => nearPage(otherRealm, target));
          let overlap = page.rows.filter((r) =>
            exact.rows.some((e) => e.url === r.url),
          ).length;
          assert.ok(overlap >= 9, `${overlap} of the exact top 10`);
        }
      },
    );

    pgvectorTest(
      'a filter that admits cards the approximate read missed sends the search down the exact path',
      async (assert) => {
        await seed(testRealm, 100, 60);
        let target = randomVector(random(5));
        // the cards furthest from the target are no approximate candidates
        let exactAll = await exactly(() =>
          nearPage(testRealm, target, { page: { size: 100 } }),
        );
        let far = exactAll.rows
          .slice(-3)
          .map((r) =>
            r.url.replace(`${testRealm}Moment/`, '').replace('.json', ''),
          );
        let filtered = await nearPage(testRealm, target, {
          filter: {
            on: momentRef,
            any: far.map((title) => ({ eq: { title } })),
          },
        });
        assert.deepEqual(
          {
            path: filtered.meta.near?.path,
            reason: filtered.meta.near?.reason,
          },
          { path: 'exact', reason: 'filtered-out' },
        );
        assert.deepEqual(
          filtered.rows.map((r) => r.url),
          exactAll.rows.slice(-3).map((r) => r.url),
          'every admitted card, each with its similarity, in order',
        );
        assert.ok(filtered.rows.every((r) => r.sim != null));
      },
    );

    pgvectorTest(
      'an approximate near filter checks each candidate exactly',
      async (assert) => {
        await seed(testRealm, 100, 60);
        let next = random(11);
        let target = randomVector(next);
        let all = await exactly(() =>
          nearPage(testRealm, target, { page: { size: 100 } }),
        );
        // a threshold that admits about a dozen cards
        let minSimilarity = all.rows[11].sim!;
        let query = {
          filter: {
            every: [
              { type: momentRef },
              {
                on: momentRef,
                near: {
                  'segments.embedding': { to: target, minSimilarity },
                },
              },
            ],
          },
          sort: [{ by: 'title', on: momentRef }],
          page: { size: 100 },
        } as Query;
        let run = async () => {
          let { results, meta } = await engine.search(
            new URL(testRealm),
            query,
            {},
            { kind: 'dataOnly' },
          );
          return { urls: results.map((r: any) => String(r.url)), meta };
        };
        let approximate = await run();
        let exact = await exactly(run);
        assert.strictEqual(approximate.meta.near?.path, 'hnsw');
        assert.strictEqual(exact.meta.near?.path, 'exact');
        assert.ok(
          approximate.urls.every((u) => exact.urls.includes(u)),
          'nothing below the threshold is admitted',
        );
        assert.ok(
          approximate.urls.length >= Math.floor(exact.urls.length * 0.9),
          `${approximate.urls.length} of the ${exact.urls.length} cards within it`,
        );
        // negated, the complement
        let { meta } = await engine.search(
          new URL(testRealm),
          {
            filter: {
              every: [
                { type: momentRef },
                { not: (query.filter as EveryFilter).every[1] },
              ],
            },
            page: { size: 1 },
          } as Query,
          {},
          { kind: 'dataOnly' },
        );
        assert.strictEqual(
          meta.page.total,
          100 - approximate.urls.length,
          'under not, every other card',
        );
      },
    );

    pgvectorTest(
      'a near signal in a blend ranks the candidates of an approximate read',
      async (assert) => {
        await seed(testRealm, 100, 60);
        let target = randomVector(random(3));
        let blend = {
          by: '_blend',
          of: [{ on: momentRef, by: 'segments.embedding', near: target }],
        };
        let approximate = await nearPage(testRealm, target, {
          sort: [blend as any],
        });
        let exact = await exactly(() =>
          nearPage(testRealm, target, { sort: [blend as any] }),
        );
        assert.strictEqual(approximate.meta.near?.path, 'hnsw');
        let near = await exactly(() => nearPage(testRealm, target));
        let overlap = approximate.rows.filter((r) =>
          near.rows.some((e) => e.url === r.url),
        ).length;
        assert.ok(
          overlap >= 9,
          `the blend's top 10 hold ${overlap} of the nearest 10`,
        );
        assert.strictEqual(approximate.rows.length, exact.rows.length);
      },
    );

    pgvectorTest(
      'look-alikes over a large realm read the index and keep the exact neighbours',
      async (assert) => {
        // 300 cards with one vector each, past a lowered threshold
        setVectorSearchSettings({ exactThreshold: 100 });
        let next = random(17);
        let batch = await indexWriter.createBatch(
          new URL(testRealm),
          virtualNetwork,
          undefined,
          { splitPrerenderHtml: false },
        );
        const space = 'look@1 test 16';
        for (let c = 0; c < 300; c++) {
          let cardURL = new URL(url(`l${c}`));
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
            searchData: {
              title: `l${c}`,
              views: c,
              embedding: vec(randomVector(next)),
              _vectorFields: {
                embedding: { space, list: false, computed: false },
              },
            },
            deps: new Set(),
            displayNames: ['Moment'],
            types: [momentKey],
            isolatedHtml: `<div>l${c}</div>`,
          });
        }
        await batch.done();
        await vectorStoreFor(adapter).buildIndexes();
        let lookalikes = async () => {
          let { results } = await engine.search(
            new URL(testRealm),
            {
              filter: { type: momentRef },
              sort: [
                {
                  expression: 'MAX(peers.similarity)',
                  compare: { near: 'embedding', k: 3 },
                },
                { by: 'views', on: momentRef },
              ],
              page: { size: 20 },
            } as Query,
            {},
            { kind: 'renderSet' },
          );
          return results.map((r: any) => [
            String(r.url),
            Number(Number(r._window).toFixed(9)),
          ]);
        };
        let approximate = await lookalikes();
        setVectorSearchSettings({ exactThreshold: Number.MAX_SAFE_INTEGER });
        let exact = await lookalikes();
        assert.strictEqual(approximate.length, 20);
        let same = approximate.filter(([u, v]) =>
          exact.some(([eu, ev]) => eu === u && ev === v),
        ).length;
        assert.ok(
          same >= 19,
          `${same} of 20 cards have the exact nearest look-alike's similarity`,
        );
      },
    );

    pgvectorTest(
      'the index migration drops the per-space indexes and builds them again',
      async (assert) => {
        setVectorSearchSettings({ exactThreshold: 5 });
        await seed(testRealm, 5, 2);
        let migration = (await import(
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore a CommonJS migration, required for its SQL
          '../../postgres/migrations/1794254974149_vector-space-hnsw-indexes.js'
        )) as { up: Function; down: Function };
        let run = async (step: Function) => {
          let statements: string[] = [];
          await step({
            noTransaction() {},
            sql: (sql: string) => statements.push(sql),
            db: { select: (sql: string) => adapter.execute(sql) },
          });
          for (let sql of statements) {
            await adapter.execute(sql);
          }
        };
        let indexes = async () =>
          (
            await adapter.execute(
              `SELECT c.relname AS name, i.indisvalid AS valid
                 FROM pg_class AS c JOIN pg_index AS i ON i.indexrelid = c.oid
                WHERE c.relname LIKE 'boxel_index_vectors_%_hnsw'`,
            )
          ).map((r) => [String(r.name), r.valid]);
        let built = await indexes();
        assert.strictEqual(built.length, 1, 'the engine built one');
        await run(migration.down);
        assert.deepEqual(await indexes(), [], 'down drops it');
        await run(migration.up);
        assert.deepEqual(await indexes(), built, 'up builds it again');
        await run(migration.up);
        assert.deepEqual(await indexes(), built, 'and leaves a valid one be');
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
