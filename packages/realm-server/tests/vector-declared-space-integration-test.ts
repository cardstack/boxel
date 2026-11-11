import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  VectorSerializer,
  VirtualNetwork,
  hasVectorIndex,
  internalKeyFor,
  rri,
  vectorSpace,
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

// The space a near search compares in is the one the type's definition
// declares for the field (`FieldDefinition.vectorSpace`), not one inferred
// from whichever cards the database returns. These tests seed a type in the
// middle of a reindex from space A to space B through the real index writer,
// against real Postgres + pgvector, and check that every run of a query
// compares in the declared space.
//
// Every expectation is worked out here, from the fixture and the rule: a
// card whose vector is stored in the declared space is compared (cosine
// similarity, computed below); any other card is stale, so a near sort gives
// it no similarity, a near filter leaves it out, and `vectorStatus` says so.

const SPACE_A = 'old-model@1 test 3';
const SPACE_B = 'new-model@2 test 3';
const TARGET = [1, 0, 0];
const MIN_SIMILARITY = 0.45;
const RUNS = 20;

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const vectorRef = ref('@cardstack/base/vector', 'default');
const docRef = ref(`${testRealm}doc`, 'Doc');

// The Doc type. `declared` is the space its definition records for
// `embedding`; left out, the definition is one stored before the member
// existed.
function docDefinition(declared?: string): Definition {
  return {
    type: 'card-def',
    codeRef: docRef,
    displayName: 'Doc',
    fields: { id: 'f0', title: 'f0', embedding: 'f1' },
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
        ...(declared === undefined ? {} : { vectorSpace: declared }),
      },
    },
  };
}

function definitionLookupFor(definition: Definition): DefinitionLookup {
  const lookup: DefinitionLookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      let own = definition.codeRef as ResolvedCodeRef;
      if (own.module === codeRef.module && own.name === codeRef.name) {
        return definition;
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

// One fixture card: its vector as stored (float32), and the space its search
// doc records for the field (`null`: the doc records no vector fields, as a
// card with a plain vector may).
interface Doc {
  name: string;
  components: number[];
  space: string | null;
}

// Sixty vectors fanned out from the target, 2.5 degrees apart, with a small
// third component so they are not all in one plane.
function fixture(spaceOf: (i: number) => string | null): Doc[] {
  return Array.from({ length: 60 }, (_, i) => {
    let angle = ((i + 1) * 2.5 * Math.PI) / 180;
    return {
      name: `d${String(i).padStart(2, '0')}`,
      components: [Math.cos(angle), Math.sin(angle), (i % 4) / 20].map((c) =>
        Math.fround(c),
      ),
      space: spaceOf(i),
    };
  });
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
}

// Postgres scores the stored float32 vectors and JS scores them in double
// precision, so a similarity is compared to within this.
const TOLERANCE = 1e-5;
const byName = (a: Doc, b: Doc) => a.name.localeCompare(b.name);

// What a near sort (most similar first, then by title) answers when the
// field compares in `space`: the cards stored in it by similarity, then the
// rest, with no similarity, by title.
function expectedSort(
  docs: Doc[],
  space: string,
  target = TARGET,
): [string, number | null][] {
  let similarity = (d: Doc) => cosine(d.components, target);
  let compared = docs
    .filter((d) => d.space === space)
    .sort((a, b) => similarity(b) - similarity(a));
  let stale = docs.filter((d) => d.space !== space).sort(byName);
  return [
    ...compared.map((d): [string, number] => [d.name, similarity(d)]),
    ...stale.map((d): [string, null] => [d.name, null]),
  ];
}

// What a near filter admits, by title: the cards stored in `space`, within
// `minSimilarity` of the target when one is given.
function expectedFilter(
  docs: Doc[],
  space: string,
  minSimilarity?: number,
): string[] {
  return docs
    .filter(
      (d) =>
        d.space === space &&
        (minSimilarity === undefined ||
          cosine(d.components, TARGET) >= minSimilarity),
    )
    .sort(byName)
    .map((d) => d.name);
}

// The fixture must not make an expectation depend on rounding: no two
// similarities too close to order, and none at the filter's threshold.
function assertFixtureIsUnambiguous(docs: Doc[]) {
  let sims = docs
    .map((d) => cosine(d.components, TARGET))
    .sort((a, b) => a - b);
  for (let i = 1; i < sims.length; i++) {
    if (sims[i] - sims[i - 1] < 1e-4) {
      throw new Error('fixture: two similarities are too close to order');
    }
  }
  if (sims.some((s) => Math.abs(s - MIN_SIMILARITY) < 1e-3)) {
    throw new Error('fixture: a similarity sits at the filter threshold');
  }
}

const sortQuery: Query = {
  filter: { type: docRef },
  sort: [
    { on: docRef, by: 'embedding', near: TARGET },
    { on: docRef, by: 'title' },
  ],
  page: { size: 100 },
};

const filterQuery = (minSimilarity?: number): Query => ({
  filter: {
    on: docRef,
    near: {
      embedding: {
        to: TARGET,
        ...(minSimilarity === undefined ? {} : { minSimilarity }),
      },
    },
  },
  sort: [{ on: docRef, by: 'title' }],
  page: { size: 100 },
});

const url = (name: string) => `${testRealm}Doc/${name}.json`;
const nameOf = (cardURL: string) =>
  cardURL.replace(`${testRealm}Doc/`, '').replace(/\.json$/, '');

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let indexWriter: IndexWriter;
  let virtualNetwork: VirtualNetwork;
  let docKey: string;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    // These tests are about pgvector's table: without the extension they
    // fail, they never pass unrun.
    if (!(await hasVectorIndex(adapter))) {
      await closeTestPgAdapter(adapter);
      throw new Error(
        'this Postgres has no pgvector extension; the declared-space tests need it',
      );
    }
    indexWriter = new IndexWriter(adapter);
    virtualNetwork = new VirtualNetwork();
    docKey = internalKeyFor(docRef, undefined, virtualNetwork);
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  // Indexes `docs` in one pass of the real index writer.
  async function index(docs: Doc[]) {
    let batch = await indexWriter.createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    for (let doc of docs) {
      let cardURL = new URL(url(doc.name));
      await batch.updateEntry(cardURL, {
        type: 'instance',
        resource: {
          id: rri(cardURL.href),
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: { module: rri(docRef.module), name: 'Doc' } },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData: {
          id: `${testRealm}Doc/${doc.name}`,
          title: doc.name,
          embedding: VectorSerializer.queryableValue(
            VectorSerializer.encodeVector(doc.components, {
              encoding: 'float32',
            }),
          ),
          ...(doc.space === null
            ? {}
            : {
                _vectorFields: {
                  embedding: {
                    space: doc.space,
                    list: false,
                    computed: false,
                  },
                },
              }),
        },
        deps: new Set(),
        displayNames: ['Doc'],
        types: [docKey],
        isolatedHtml: `<div>${doc.name}</div>`,
      });
    }
    await batch.done();
  }

  // Indexes the cards of each space in its own pass, in the order given, far
  // enough apart that the later pass is the more recently indexed.
  async function indexInOrder(docs: Doc[], spaces: (string | null)[]) {
    for (let space of spaces) {
      let pass = docs.filter((d) => d.space === space);
      if (pass.length > 0) {
        await index(pass);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  }

  // A fresh engine each time, so no run can answer from what an earlier one
  // remembered.
  const engineFor = (definition: Definition) =>
    new IndexQueryEngine(
      adapter,
      definitionLookupFor(definition),
      virtualNetwork,
    );

  async function sorted(
    definition: Definition,
    query: Query = sortQuery,
  ): Promise<[string, number | null][]> {
    let { results } = await engineFor(definition).search(
      new URL(testRealm),
      query,
      {},
      { kind: 'dataOnly' },
    );
    return results.map((r: any) => [
      nameOf(r.url),
      r._nearSimilarity == null ? null : Number(r._nearSimilarity),
    ]);
  }

  async function admitted(
    definition: Definition,
    query: Query,
  ): Promise<string[]> {
    let { results } = await engineFor(definition).search(
      new URL(testRealm),
      query,
      {},
      { kind: 'dataOnly' },
    );
    return results.map((r: any) => nameOf(r.url));
  }

  // Runs `ask` RUNS times and checks every answer is the expected one.
  async function assertEveryRun<T>(
    assert: Assert,
    ask: () => Promise<T>,
    expected: T,
    message: string,
  ) {
    let answers: T[] = [];
    for (let run = 0; run < RUNS; run++) {
      answers.push(await ask());
    }
    assert.deepEqual(answers[0], expected, message);
    assert.strictEqual(
      answers.filter(
        (answer) => JSON.stringify(answer) !== JSON.stringify(expected),
      ).length,
      0,
      `${message}: the same answer on each of ${RUNS} runs`,
    );
  }

  // The checks every mid-reindex fixture gets: the sort, the filter with and
  // without a threshold, and each card's vector status, all in `space`.
  // A near sort's answer: every run the same, in the expected order, each
  // similarity within TOLERANCE of the one computed here (null for a card
  // that is not compared).
  async function assertSortedAs(
    assert: Assert,
    ask: () => Promise<[string, number | null][]>,
    expected: [string, number | null][],
    message: string,
  ) {
    let answers: [string, number | null][][] = [];
    for (let run = 0; run < RUNS; run++) {
      answers.push(await ask());
    }
    let first = answers[0];
    assert.deepEqual(
      first.map(([name, sim]) => [name, sim === null]),
      expected.map(([name, sim]) => [name, sim === null]),
      `${message}: the order, and which cards are compared`,
    );
    let off = first.filter(([, sim], i) => {
      let want = expected[i]?.[1];
      return (
        sim !== null &&
        (want == null || Math.abs(sim - (want as number)) > TOLERANCE)
      );
    });
    assert.deepEqual(off, [], `${message}: the similarities`);
    assert.strictEqual(
      answers.filter((a) => JSON.stringify(a) !== JSON.stringify(first)).length,
      0,
      `${message}: the same answer on each of ${RUNS} runs`,
    );
  }

  async function assertComparesIn(
    assert: Assert,
    definition: Definition,
    docs: Doc[],
    space: string,
  ) {
    await assertSortedAs(
      assert,
      () => sorted(definition),
      expectedSort(docs, space),
      `a near sort compares in "${space}"`,
    );
    await assertEveryRun(
      assert,
      () => admitted(definition, filterQuery(MIN_SIMILARITY)),
      expectedFilter(docs, space, MIN_SIMILARITY),
      `a near filter with a threshold compares in "${space}"`,
    );
    await assertEveryRun(
      assert,
      () => admitted(definition, filterQuery()),
      expectedFilter(docs, space),
      `a near filter with no threshold admits only the cards in "${space}"`,
    );
  }

  async function assertStatuses(
    assert: Assert,
    definition: Definition,
    docs: Doc[],
    space: string,
  ) {
    let engine = engineFor(definition);
    let statuses: Record<string, unknown> = {};
    for (let doc of docs) {
      statuses[doc.name] = (
        await engine.vectorStatus(new URL(url(doc.name)))
      ).embedding;
    }
    assert.deepEqual(
      statuses,
      Object.fromEntries(
        docs.map((d) => [
          d.name,
          d.space === space
            ? { status: 'ok', space, count: 1 }
            : { status: 'stale', space, count: 0 },
        ]),
      ),
      `vectorStatus: ok for a card stored in "${space}", stale for any other`,
    );
  }

  const orders: [string, string[]][] = [
    ['the old space indexed first', [SPACE_A, SPACE_B]],
    ['the new space indexed first', [SPACE_B, SPACE_A]],
  ];

  module('a definition that declares the space', function () {
    for (let [label, order] of orders) {
      test(`half the cards reindexed: every query compares in the declared space (${label})`, async function (assert) {
        let docs = fixture((i) => (i % 2 === 0 ? SPACE_A : SPACE_B));
        assertFixtureIsUnambiguous(docs);
        await indexInOrder(docs, order);
        let definition = docDefinition(SPACE_B);
        await assertComparesIn(assert, definition, docs, SPACE_B);
        await assertStatuses(assert, definition, docs, SPACE_B);
      });

      test(`one card of sixty reindexed: every query still compares in the declared space (${label})`, async function (assert) {
        let docs = fixture((i) => (i === 7 ? SPACE_B : SPACE_A));
        await indexInOrder(docs, order);
        let definition = docDefinition(SPACE_B);
        await assertComparesIn(assert, definition, docs, SPACE_B);
        await assertStatuses(assert, definition, docs, SPACE_B);
      });
    }

    test('no card reindexed yet: there is nothing to compare, and every card is stale', async function (assert) {
      let docs = fixture(() => SPACE_A);
      await index(docs);
      let definition = docDefinition(SPACE_B);
      assert.deepEqual(
        expectedSort(docs, SPACE_B).filter(([, s]) => s !== null),
        [],
        'the rule gives no card a similarity',
      );
      await assertComparesIn(assert, definition, docs, SPACE_B);
      await assertStatuses(assert, definition, docs, SPACE_B);
    });

    test('a plain VectorField compares with plain vectors of its size only', async function (assert) {
      // What `VectorField.space` answers for a type naming no vectorizer.
      let plain = vectorSpace({ dimensions: 3 });
      assert.strictEqual(plain, 'vector 3');
      // A third of the cards record no vector fields (their vectors are
      // stored as plain vectors of their size), a third record the plain
      // space, and a third are in a named space of the same size.
      let docs = fixture((i) =>
        i % 3 === 0 ? null : i % 3 === 1 ? plain : SPACE_A,
      );
      await indexInOrder(docs, [SPACE_A, null, plain]);
      let stored = docs.map((d) => ({ ...d, space: d.space ?? plain }));
      let definition = docDefinition(plain);
      await assertComparesIn(assert, definition, stored, plain);
      await assertStatuses(
        assert,
        definition,
        // a card that records no vector fields reports no status for one
        stored.filter((_, i) => docs[i].space !== null),
        plain,
      );
    });

    test('a target read from a card in another space is refused; one in the declared space is compared', async function (assert) {
      let docs = fixture((i) => (i % 2 === 0 ? SPACE_A : SPACE_B));
      await indexInOrder(docs, [SPACE_A, SPACE_B]);
      let definition = docDefinition(SPACE_B);
      let nearCard = (doc: Doc): Query =>
        ({
          let: {
            $source: {
              from: {
                filter: {
                  on: docRef,
                  eq: { id: `${testRealm}Doc/${doc.name}` },
                },
              },
              one: true,
            },
          },
          filter: { type: docRef },
          sort: [
            {
              on: docRef,
              by: 'embedding',
              near: '$source.embedding',
            },
            { on: docRef, by: 'title' },
          ],
          page: { size: 100 },
        }) as unknown as Query;
      let inA = docs.find((d) => d.space === SPACE_A)!;
      let inB = docs.find((d) => d.space === SPACE_B)!;
      for (let run = 0; run < RUNS; run++) {
        let refusal: { code?: string } | undefined;
        try {
          await sorted(definition, nearCard(inA));
        } catch (e) {
          refusal = e as { code?: string };
        }
        if (refusal?.code !== 'vector-space-mismatch') {
          assert.ok(false, `run ${run}: got ${JSON.stringify(refusal)}`);
        }
      }
      assert.ok(true, `refused on each of ${RUNS} runs`);
      await assertSortedAs(
        assert,
        () => sorted(definition, nearCard(inB)),
        expectedSort(docs, SPACE_B, inB.components),
        'a target from a card in the declared space ranks the cards in it',
      );
    });
  });

  // A definition stored before `vectorSpace` was recorded: the engine falls
  // back to the space the type's most recently indexed card records.
  module('a definition without the declared space', function () {
    for (let [label, order] of orders) {
      test(`compares in the space of the most recently indexed card, on every run (${label})`, async function (assert) {
        let docs = fixture((i) => (i % 2 === 0 ? SPACE_A : SPACE_B));
        await indexInOrder(docs, order);
        let latest = order[order.length - 1];
        await assertComparesIn(assert, docDefinition(), docs, latest);
      });
    }

    test('one card of sixty reindexed, and it is the latest: compares in its space on every run', async function (assert) {
      let docs = fixture((i) => (i === 7 ? SPACE_B : SPACE_A));
      await indexInOrder(docs, [SPACE_A, SPACE_B]);
      await assertComparesIn(assert, docDefinition(), docs, SPACE_B);
    });
  });
});
