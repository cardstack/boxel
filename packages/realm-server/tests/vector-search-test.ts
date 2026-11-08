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
      // opted in to look-alike lookups (rerank compare.near)
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
              a: {
                from: { filter: { on: momentRef, eq: { title: 'a' } } },
                one: true,
              },
            },
            filter: {
              on: momentRef,
              near: {
                embedding: {
                  to: { $let: 'a', path: 'embedding' },
                  minSimilarity: 0.5,
                },
              },
            },
            sort: [
              {
                on: momentRef,
                by: 'embedding',
                near: { $let: 'a', path: 'embedding' },
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
          a: { strategy: 'card', found: true },
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
              me: {
                from: { filter: { on: momentRef, eq: { title: 'a' } } },
                one: true,
              },
            },
            filter: { type: momentRef },
            sort: [
              {
                on: momentRef,
                by: 'embedding',
                near: { $let: 'me', path: 'embedding' },
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
              rerank: {
                expr: 'views / stats.views.median',
                compare: {
                  near: 'embedding',
                  k: 2,
                  minSimilarity: 0.5,
                  filter: grant,
                },
              },
            } as Query,
            { grantFilter: grant },
            { kind: 'renderSet' },
          );
          return {
            rows: results.map((r: any) => [
              r.url.replace(`${testRealm}Moment/`, '').replace('.json', ''),
              r._rerank == null ? null : Number(Number(r._rerank).toFixed(3)),
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
      'rerank compares each card with its own look-alikes',
      async function (assert) {
        await index({
          a: { title: 'a', views: 10, embedding: vec([1, 0, 0]) },
          b: { title: 'b', views: 50, embedding: vec([0.99, 0.1, 0]) },
          c: { title: 'c', views: 20, embedding: vec([0.98, 0.15, 0]) },
          d: { title: 'd', views: 5, embedding: vec([0, 1, 0]) },
          e: { title: 'e', views: 100, embedding: vec([0, 0.99, 0.1]) },
        });
        let rerankRows = async (rerank: any) => {
          let { results, meta } = await engine.search(
            new URL(testRealm),
            { filter: { type: momentRef }, rerank } as Query,
            {},
            { kind: 'renderSet' },
          );
          return {
            rows: results.map((r: any) => [
              r.url.replace(`${testRealm}Moment/`, '').replace('.json', ''),
              r._rerank == null ? null : Number(Number(r._rerank).toFixed(3)),
            ]),
            meta,
          };
        };
        // Views against the median of each card's two nearest look-alikes
        // (d and e have only each other above 0.5).
        let { rows } = await rerankRows({
          expr: 'views / stats.views.median',
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
          expr: 'MAX(peers.similarity)',
          compare: { near: 'embedding', k: 1 },
        });
        assert.ok(
          similar.rows.every(([, v]) => typeof v === 'number' && v > 0.9),
          "each card's twin is nearly identical",
        );
        await assert.rejects(
          rerankRows({ expr: 'views', compare: { near: 'views' } }),
          /declare the field with search: \{ neighbors: true \}/,
          'a field that has not opted in is refused',
        );
        let built = false;
        for (let i = 0; i < 50 && !built; i++) {
          let [row] = await adapter.execute(
            `SELECT count(*) AS n FROM pg_indexes WHERE indexname = 'boxel_index_vectors_nb_embedding_3'`,
          );
          built = Number(row.n) > 0;
          if (!built) await new Promise((r) => setTimeout(r, 100));
        }
        assert.ok(built, "the first lookup builds the field's neighbour index");
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
