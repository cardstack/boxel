import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  facetFieldSpecsOf,
  SEARCH_TEXT_KEY,
  VectorSerializer,
  VirtualNetwork,
  baseCardRef,
  hasVectorIndex,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { parseSearchEntryQueryFromPayload } from '@cardstack/runtime-common/search-entry';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './helpers/index.ts';

// What a shop's gallery of saved searches recorded as going wrong without an
// error, each pinned to the behavior docs/search.md describes, and the
// focused cases that gallery suggested.
//
// The rule every test here holds the engine to: a query either returns the
// right rows and values, or is refused with a coded error that names what it
// cannot do. An empty or blank answer to a query the engine accepted is never
// right.
//
// - 'recorded gaps still open': the recorded failure still happens. These
//   tests fail, and stay failing until the engine is fixed.
// - 'recorded gaps now closed': the recorded failure no longer happens.
// - 'focused cases': one rule each, on the smallest rows that tell a right
//   answer from a wrong one.
// - 'pinned, rule not yet decided': what the engine does where the docs say
//   nothing.
// - 'refusals': the grammar's refusals, by code.
//
// Each fixture is a realm of its own, declared above the test that reads it
// and written through the index writer with the text a render would stamp
// for the declarations below (role-weighted words, the typo word list,
// pattern values), so full text, typos, patterns, vectors and links are the
// writer's own. No card is rendered and no server runs. A query goes in as a
// client sends it: in the newer spelling, through the search wire's parser.
//
// Every expectation is worked out here from the rows: a filter, a count, a
// cosine, reciprocal rank fusion as the docs state it.
//
// These need pgvector in the test Postgres, and fail without it.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const booleanRef = ref('@cardstack/base/boolean', 'default');
const datetimeRef = ref('@cardstack/base/datetime', 'default');
const vectorRef = ref('@cardstack/base/vector', 'default');

type Q = Record<string, any>;
type Doc = Record<string, unknown>;

// Every text, number, boolean and date field here is a facet: these cases
// record how facets count, not which fields declare one.
const text = (search?: Record<string, unknown>) => ({
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: stringRef,
  search: { ...(search ?? {}), facet: true },
});
const number = (search?: Record<string, unknown>) => ({
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: numberRef,
  serializerName: 'number',
  search: { ...(search ?? {}), facet: true },
});
const boolean = {
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: booleanRef,
  serializerName: 'boolean',
  search: { facet: true },
};

const TYPES = ['Item', 'Variant', 'List', 'Brand', 'Dims'] as const;
type TypeName = (typeof TYPES)[number];

const realmOf = (set: string) => `http://recorded-gaps-${set}/`;
const typeOf = (set: string, name: TypeName) =>
  ref(`${realmOf(set)}shop`, name);
const idOf = (set: string, type: TypeName, name: string) =>
  `${realmOf(set)}${type}/${name}`;

function fieldDefsOf(set: string, name: TypeName): Record<string, unknown> {
  switch (name) {
    case 'Item':
      return {
        id: text(),
        title: text({ role: 'title', typos: true }),
        body: text({ role: 'body' }),
        kind: text(),
        color: text(),
        material: text(),
        path: text(),
        dept: text(),
        cat: text(),
        size: text(),
        sku: text({ role: 'identifier', patterns: true }),
        code: text(),
        price: number(),
        rating: number({ rank: 'quality' }),
        reviewCount: number(),
        sold: number({ rank: 'popularity' }),
        stock: number(),
        a: number(),
        b: number(),
        inStock: boolean,
        onSale: boolean,
        tags: { ...text(), type: 'containsMany' },
        listedAt: {
          type: 'contains',
          isPrimitive: true,
          isComputed: false,
          fieldOrCard: datetimeRef,
          serializerName: 'datetime',
          search: { facet: true },
        },
        vec: {
          type: 'contains',
          isPrimitive: true,
          isComputed: false,
          fieldOrCard: vectorRef,
          serializerName: 'vector',
          search: { neighbors: true },
        },
        // not indexed: the search doc never holds it
        dims: {
          type: 'contains',
          isPrimitive: false,
          isComputed: false,
          fieldOrCard: typeOf(set, 'Dims'),
          search: false,
        },
        brand: {
          type: 'linksTo',
          isPrimitive: false,
          isComputed: false,
          fieldOrCard: typeOf(set, 'Brand'),
          searchable: true,
          search: { facet: true },
        },
      };
    case 'Variant':
      return {
        id: text(),
        parent: {
          type: 'linksTo',
          isPrimitive: false,
          isComputed: false,
          fieldOrCard: typeOf(set, 'Item'),
        },
        size: text(),
        available: boolean,
        price: number(),
      };
    case 'List':
      return {
        id: text(),
        items: {
          type: 'linksToMany',
          isPrimitive: false,
          isComputed: false,
          fieldOrCard: typeOf(set, 'Item'),
        },
      };
    case 'Brand':
      return { id: text(), name: text({ role: 'title' }) };
    case 'Dims':
      return { width: number() };
  }
}

function definitionOf(set: string, name: TypeName): Definition {
  let fieldDefs = fieldDefsOf(set, name);
  return {
    type: name === 'Dims' ? 'field-def' : 'card-def',
    codeRef: typeOf(set, name),
    displayName: name,
    fields: Object.fromEntries(Object.keys(fieldDefs).map((n) => [n, n])),
    fieldDefs,
  } as unknown as Definition;
}

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      if (
        codeRef.module === baseCardRef.module &&
        codeRef.name === baseCardRef.name
      ) {
        return {
          type: 'card-def',
          codeRef: baseCardRef,
          displayName: 'Card',
          fields: {},
          fieldDefs: {},
        } as unknown as Definition;
      }
      let found = /^http:\/\/recorded-gaps-([a-z0-9-]+)\/shop$/.exec(
        codeRef.module,
      );
      if (!found || !(TYPES as readonly string[]).includes(codeRef.name)) {
        throw new Error(
          `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
        );
      }
      return definitionOf(found[1], codeRef.name as TypeName);
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
  } as unknown as DefinitionLookup;
  return lookup;
}

// Two int8 components, the larger of them 127, so the stored vector is these
// numbers and a cosine computed here is the one stored.
const vec = (components: number[]) =>
  VectorSerializer.queryableValue(VectorSerializer.encodeVector(components));

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / Math.sqrt(aa * bb);
}

const RRF_K = 60;

interface Fixture {
  set: string;
  rows: Partial<Record<TypeName, Record<string, Doc>>>;
}
const FIXTURES: Fixture[] = [];

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let engine: IndexQueryEngine;

  function fixture(set: string, rows: Fixture['rows']) {
    FIXTURES.push({ set, rows });
    return {
      set,
      realm: new URL(realmOf(set)),
      Item: typeOf(set, 'Item'),
      Variant: typeOf(set, 'Variant'),
      List: typeOf(set, 'List'),
      Brand: typeOf(set, 'Brand'),
      id: (type: TypeName, name: string) => idOf(set, type, name),
    };
  }
  type Fx = ReturnType<typeof fixture>;
  // A link as the search doc holds it: the linked card's id, and for a brand
  // the name its link includes.
  const link = (set: string, type: TypeName, name: string) => ({
    id: idOf(set, type, name),
  });
  const brand = (set: string, name: string) => ({
    id: idOf(set, 'Brand', name),
    name,
  });

  hooks.before(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    if (!(await hasVectorIndex(adapter))) {
      throw new Error(
        'query-recorded-gaps-integration-test needs the pgvector extension in the test Postgres, and this database does not have it. Install pgvector in the test database image; these tests do not skip.',
      );
    }
    let vn = new VirtualNetwork();
    let lookup = makeDefinitionLookup();
    engine = new IndexQueryEngine(adapter, lookup, vn);
    for (let { set, rows } of FIXTURES) {
      let batch = await new IndexWriter(adapter).createBatch(
        new URL(realmOf(set)),
        vn,
        undefined,
        { splitPrerenderHtml: false },
      );
      for (let [type, byName] of Object.entries(rows) as [
        TypeName,
        Record<string, Doc>,
      ][]) {
        for (let [name, doc] of Object.entries(byName)) {
          let cardURL = new URL(`${idOf(set, type, name)}.json`);
          let title = (doc.title ?? doc.name) as string | undefined;
          // What a render stamps for the declarations: the title's words at
          // the top tier and in the typo word list, the body's at the low
          // tier, the stock code as a pattern value.
          let groups: Record<string, unknown> = {};
          if (title) groups.A = title;
          if (doc.body) groups.D = doc.body;
          if (doc.title) groups.typos = doc.title;
          if (doc.sku) groups.patterns = doc.sku;
          // and the declared facet fields, for the facet table
          let facets = await facetFieldSpecsOf(definitionOf(set, type), (r) =>
            lookup.lookupDefinition(r as ResolvedCodeRef),
          );
          if (Object.keys(facets).length) groups.facets = facets;
          let { vec: vector, ...rest } = doc;
          await batch.updateEntry(cardURL, {
            type: 'instance',
            resource: {
              id: rri(cardURL.href),
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: rri(typeOf(set, type).module),
                  name: type,
                },
              },
            },
            lastModified: Date.now(),
            resourceCreatedAt: Date.now(),
            searchData: {
              id: idOf(set, type, name),
              ...rest,
              ...(vector ? { vec: vec(vector as number[]) } : {}),
              ...(Object.keys(groups).length
                ? { [SEARCH_TEXT_KEY]: groups }
                : {}),
              ...(title ? { _typeahead: title } : {}),
            },
            ...(title
              ? { markdown: `# ${title}\n\n${doc.body ?? ''}`.trim() }
              : {}),
            deps: new Set(),
            displayNames: [type],
            types: [internalKeyFor(typeOf(set, type), undefined, vn)],
            isolatedHtml: `<div>${name}</div>`,
          });
        }
      }
      await batch.done();
    }
  });

  hooks.after(async function () {
    if (adapter) {
      await closeTestPgAdapter(adapter);
    }
  });

  const nameOf = (url: unknown) =>
    String(url)
      .split('/')
      .pop()!
      .replace(/\.json$/, '');

  interface Answer {
    names: string[];
    rows: Record<string, any>[];
    meta: Record<string, any>;
  }

  // The query as a client sends it and the realm reads it.
  async function run(fx: Fx, q: Q): Promise<Answer> {
    let parsed = parseSearchEntryQueryFromPayload(
      JSON.parse(JSON.stringify(q)),
    );
    let { results, meta } = await engine.search(
      fx.realm,
      parsed.itemQuery as Query,
      {},
      { kind: 'dataOnly' },
    );
    let rows = results as Record<string, any>[];
    return {
      names: rows.map((r) => nameOf(r.url)),
      rows,
      meta: meta as Record<string, any>,
    };
  }

  interface Refusal {
    code: string | undefined;
    message: string;
  }

  // A refusal is one of the grammar's two errors, and carries the code a 400
  // would. Anything else a search throws (a database error, say) is not a
  // refusal and fails the test that met it.
  function refusalOf(e: unknown): Refusal {
    let error = e as { name?: string; code?: string; queryCode?: string };
    if (error?.name === 'SearchRequestError') {
      return { code: error.queryCode, message: String((e as Error).message) };
    }
    if (error?.name === 'InvalidQueryError') {
      return { code: error.code, message: String((e as Error).message) };
    }
    throw e;
  }

  async function outcome<T>(
    ask: () => Promise<T>,
  ): Promise<{ answer?: T; refused?: Refusal }> {
    try {
      return { answer: await ask() };
    } catch (e) {
      return { refused: refusalOf(e) };
    }
  }

  // The refusal has a code and its message names what was refused.
  function isCodedRefusal(
    assert: Assert,
    refused: Refusal | undefined,
    names: RegExp,
    why: string,
    code?: string,
  ) {
    if (!refused) {
      assert.ok(false, `${why}: the query was accepted`);
      return;
    }
    if (code) {
      assert.strictEqual(refused.code, code, `${why}: code`);
    } else {
      assert.true(
        typeof refused.code === 'string' && refused.code.length > 0,
        `${why}: the refusal carries a code (got ${refused.code})`,
      );
    }
    assert.true(
      names.test(refused.message),
      `${why}: the message names it (${refused.message})`,
    );
  }

  const close = (actual: unknown, expected: number) =>
    actual != null && Math.abs(Number(actual) - expected) < 1e-9;
  const rerankOf = (answer: Answer) =>
    Object.fromEntries(
      answer.rows.map((r) => [
        nameOf(r.url),
        r._window == null ? null : Number(r._window),
      ]),
    );
  const facetOf = (answer: Answer, by: string): Record<string, number> =>
    Object.fromEntries(
      (answer.meta.facets?.[by] ?? []).map((e: any) => [
        String(e.value),
        Number(e.count),
      ]),
    );

  // A `select` search as the realm answers one: the wire query's columns are
  // planned against its type, then read off each row of the page.
  async function table(fx: Fx, payload: Q) {
    let parsed = parseSearchEntryQueryFromPayload(
      JSON.parse(JSON.stringify(payload)),
    );
    let plans = await engine.planColumns(
      parsed.typeAnchors![0],
      parsed.columns!,
    );
    let { rows, meta } = await engine.searchColumns(
      fx.realm,
      parsed.itemQuery,
      {},
      plans,
    );
    return {
      columns: ['id', ...parsed.columns!.map((c) => c.name)],
      rows: rows.map((r) => [nameOf(r[0]), ...r.slice(1)]),
      meta: meta as any,
    };
  }

  // ==========================================================================
  module('recorded gaps still open', function () {
    // Recorded: a range on a field declared `search: false` runs and returns
    // nothing. The index never holds such a field, so no row can match and
    // the empty answer says nothing about the cards.
    const unindexed = fixture('unindexed', {
      // `dims` is declared `search: false`, so the search doc has no `dims`
      Item: { A: { title: 'wide shelf', price: 10 } },
    });
    test('a range on a field declared search: false is refused, not answered with nothing', async function (assert) {
      let { answer, refused } = await outcome(() =>
        run(unindexed, {
          type: unindexed.Item,
          filter: { range: { 'dims.width': { lte: 80 } } },
        }),
      );
      isCodedRefusal(
        assert,
        refused,
        /dims/,
        `a range on dims.width (answered with ${JSON.stringify(answer?.names)})`,
      );
    });

    // Recorded: typos miss two swapped letters. docs/search-intent.md: "a
    // swapped pair of letters is one edit", and a six-letter word has one.
    const swapped = fixture('swapped', {
      Item: { A: { title: 'closed' }, B: { title: 'window' } },
    });
    test('typos corrects two swapped letters, as it corrects a dropped one', async function (assert) {
      let find = async (term: string) =>
        (
          await run(swapped, {
            type: swapped.Item,
            filter: { matches: term, typos: true },
          })
        ).names;
      assert.deepEqual(await find('closd'), ['A'], 'a dropped letter');
      assert.deepEqual(await find('clsoed'), ['A'], 'two swapped letters');
    });

    // Recorded: with `typos: true` an excluded word is no longer excluded,
    // and the result inverts. docs/search-intent.md: typos "widens each
    // word"; the term's syntax (`"phrase"`, `-excluded`) is docs/search.md's.
    const excluded = fixture('excluded', {
      Item: {
        A: { title: 'closed toe flat' },
        B: { title: 'closed toe heel' },
      },
    });
    test('with typos on, an excluded word is still excluded', async function (assert) {
      let find = async (filter: Q) =>
        (await run(excluded, { type: excluded.Item, filter })).names;
      assert.deepEqual(
        await find({ matches: '"closed toe" -heel' }),
        ['A'],
        'spelled right, without typos: the card with "heel" is left out',
      );
      assert.deepEqual(
        await find({ matches: '"closed toe" -heel', typos: true }),
        ['A'],
        'spelled right, with typos',
      );
      assert.deepEqual(
        await find({ matches: '"closd toe" -heel', typos: true }),
        ['A'],
        'misspelled, with typos',
      );
    });

    // Recorded: an `expression` sort that names a one-card binding is
    // accepted and every row scores blank (today the binding reads as 0, so
    // each row carries a wrong number). docs/search.md: an expression reads
    // a one-card binding as `$name.path`, so it either reads it or says it
    // cannot.
    const anchored = fixture('anchored', {
      Item: {
        R: { title: 'reference', price: 100 },
        A: { title: 'first', price: 40 },
        B: { title: 'second', price: 70 },
      },
    });
    test('an expression sort that names a one-card binding reads it, or is refused', async function (assert) {
      let { answer, refused } = await outcome(() =>
        run(anchored, {
          type: anchored.Item,
          let: {
            $ref: {
              from: {
                type: anchored.Item,
                filter: { eq: { id: anchored.id('Item', 'R') } },
              },
              one: true,
            },
          },
          sort: [{ expression: '$ref.price - price' }],
        }),
      );
      if (refused) {
        isCodedRefusal(assert, refused, /ref|binding/, 'the expression sort');
      } else {
        // 100 - 40, 100 - 70, 100 - 100, highest first
        assert.deepEqual(
          answer!.names,
          ['A', 'B', 'R'],
          'ordered by the value',
        );
        assert.deepEqual(
          answer!.rows.map((r) =>
            r._expression == null ? null : Number(r._expression),
          ),
          [60, 30, 0],
          'each row carries the value',
        );
      }
    });

    // Recorded: a value like "Grey/Copper" is one word to a `fields` match.
    // docs/search.md: `fields` is "the same stemmed, case-insensitive word
    // match"; a slash is not part of a word.
    const slashed = fixture('slashed', {
      Item: {
        A: { title: 'kettle', color: 'Grey/Copper' },
        B: { title: 'pan', color: 'Grey' },
        C: { title: 'pot', color: 'Blue' },
      },
    });
    test('words joined by a slash are separate words to a fields match', async function (assert) {
      let find = async (term: string) =>
        (
          await run(slashed, {
            type: slashed.Item,
            filter: { matches: term, fields: ['color'] },
          })
        ).names.sort();
      assert.deepEqual(await find('copper'), ['A'], 'the word after the slash');
      assert.deepEqual(
        await find('grey'),
        ['A', 'B'],
        'the word before the slash',
      );
    });

    // Recorded: arithmetic over a `peers.` list inside an aggregate scores
    // no row, with no warning. docs/search.md: `peers.<field>` is "the set's
    // values as a list ... for any Excel function".
    const ratios = fixture('ratios', {
      Item: {
        A: { title: 'one', kind: 'k', a: 2, b: 1 },
        B: { title: 'two', kind: 'k', a: 4, b: 2 },
        C: { title: 'three', kind: 'k', a: 6, b: 2 },
      },
    });
    for (let [expression, expected, how] of [
      // the ratios are 2, 2 and 3
      ['MEDIAN(peers.a / peers.b)', 2, 'a list divided by a list'],
      [
        'AVERAGE(LN(peers.a + 1))',
        (Math.log(3) + Math.log(5) + Math.log(7)) / 3,
        'a function of a list plus a number',
      ],
    ] as [string, number, string][]) {
      test(`list arithmetic over peers gives a number or a refusal: ${how}`, async function (assert) {
        let { answer, refused } = await outcome(() =>
          run(ratios, {
            type: ratios.Item,
            sort: [{ expression, compare: { by: 'kind' } }, { by: 'a' }],
          }),
        );
        if (refused) {
          isCodedRefusal(assert, refused, /peers|list/, expression);
        } else {
          let values = rerankOf(answer!);
          for (let name of ['A', 'B', 'C']) {
            assert.true(
              close(values[name], expected),
              `${name}: ${values[name]} is ${expected}`,
            );
          }
          assert.strictEqual(
            answer!.meta.window?.scored,
            3,
            'three rows scored',
          );
        }
      });
    }

    // Recorded: COUNTIFS over peers lists scores almost no row.
    test('COUNTIFS over two peers lists counts the peers meeting both', async function (assert) {
      let { answer, refused } = await outcome(() =>
        run(ratios, {
          type: ratios.Item,
          sort: [
            {
              expression: 'COUNTIFS(peers.a, ">=4", peers.b, ">=2")',
              compare: { by: 'kind' },
            },
            { by: 'a' },
          ],
        }),
      );
      if (refused) {
        isCodedRefusal(assert, refused, /COUNTIFS|peers/, 'COUNTIFS');
      } else {
        // B (4, 2) and C (6, 2) meet both; A (2, 1) meets neither
        assert.deepEqual(rerankOf(answer!), { A: 2, B: 2, C: 2 });
      }
    });

    // Decided (2026-11-10): COUNTIF over a text field counts text equality,
    // ignoring case, as Excel does; a text criterion has no wildcards, and a
    // field's text is never read as an operator.
    const kinds = fixture('kinds', {
      Item: {
        A: { title: 'one', kind: 'k', price: 1 },
        B: { title: 'two', kind: 'K', price: 2 },
        C: { title: 'three', kind: 'j', price: 3 },
      },
    });
    for (let [expression, expected, why] of [
      [
        'COUNTIF(peers.kind, kind)',
        { A: 2, B: 2, C: 1 },
        "each row's own kind: k and K are one kind, j is alone",
      ],
      [
        'COUNTIF(peers.kind, "K")',
        { A: 2, B: 2, C: 2 },
        'a text literal, any case',
      ],
      ['COUNTIF(peers.kind, "<>k")', { A: 1, B: 1, C: 1 }, 'not equal to k'],
      ['COUNTIF(peers.kind, "k*")', { A: 0, B: 0, C: 0 }, 'no wildcards'],
    ] as const) {
      test(`COUNTIF over a text field: ${expression}, ${why}`, async function (assert) {
        let answer = await run(kinds, {
          type: kinds.Item,
          sort: [{ expression, top: 100 }, { by: 'price' }],
        });
        assert.deepEqual(rerankOf(answer), expected);
        assert.strictEqual(answer.meta.window?.scored, 3, 'every row scored');
      });
    }

    // Recorded: a label in a facet `measure` is accepted and the measure is
    // missing from every entry. docs/search.md: a field "may be written as
    // ... a label in any case and spacing".
    const labeled = fixture('labeled', {
      Brand: { x: { name: 'Xeno' }, y: { name: 'Yarrow' } },
      Item: {
        A: { title: 'one', price: 10, brand: brand('labeled', 'Xeno') },
        B: { title: 'two', price: 30, brand: brand('labeled', 'Xeno') },
        C: { title: 'three', price: 50, brand: brand('labeled', 'Yarrow') },
      },
    });
    // Xeno's cards cost 10 and 30, Yarrow's 50
    const AVERAGES = { Xeno: 20, Yarrow: 50 };
    const measuresOf = (answer: Answer, by: string) =>
      Object.fromEntries(
        (answer.meta.facets?.[by] ?? []).map((e: any) => [
          String(e.value),
          e.measure?.avg ?? null,
        ]),
      );
    test('a label in a facet measure resolves, or is refused by name', async function (assert) {
      let { answer, refused } = await outcome(() =>
        run(labeled, {
          type: labeled.Item,
          facets: [{ by: 'brand.name', measure: { avg: 'Price' } }],
        }),
      );
      if (refused) {
        isCodedRefusal(assert, refused, /Price/, 'the label Price');
      } else {
        assert.deepEqual(measuresOf(answer!, 'brand.name'), AVERAGES);
      }
    });

    // Found while reproducing the one above: the same happens to a measure
    // on a name the type does not have. docs/search.md: "a field the type
    // does not have" is `unknown-field`.
    test('a facet measure on a field the type does not have is refused', async function (assert) {
      let { answer, refused } = await outcome(() =>
        run(labeled, {
          type: labeled.Item,
          facets: [{ by: 'brand.name', measure: { avg: 'cost' } }],
        }),
      );
      isCodedRefusal(
        assert,
        refused,
        /cost/,
        `a measure on "cost" (answered ${JSON.stringify(answer?.meta.facets)})`,
        'unknown-field',
      );
    });

    // Recorded: a quoted label through a link, "Brand.Name", resolves to a
    // field that does not exist (`brandName`), which then counts nothing.
    // docs/search.md: `Brand.Name` resolves to `brand.name`.
    test('a quoted label through a link resolves to the linked field, or is refused', async function (assert) {
      let { answer, refused } = await outcome(() =>
        run(labeled, {
          type: labeled.Item,
          facets: [{ by: '"Brand.Name"' }],
        }),
      );
      if (refused) {
        isCodedRefusal(
          assert,
          refused,
          /Brand\.Name|brandName/,
          'the quoted label',
          'unknown-field',
        );
      } else {
        assert.deepEqual(
          answer!.meta.facets,
          {
            'brand.name': [
              { value: 'Xeno', count: 2 },
              { value: 'Yarrow', count: 1 },
            ],
          },
          'counted under brand.name',
        );
      }
    });

    // Recorded: `prefix: true` with `or` returns nothing, though each word
    // alone finds rows. docs/search.md: `or` takes either word, and with
    // `prefix` the last word matches any word that starts with it.
    const either = fixture('either', {
      Item: {
        A: { title: 'Café cups' },
        B: { title: 'Crème tea' },
        C: { title: 'Mug' },
      },
    });
    test('prefix with "or" is the union, the last word a prefix', async function (assert) {
      let find = async (term: string) =>
        (
          await run(either, {
            type: either.Item,
            filter: { matches: term, prefix: true },
          })
        ).names.sort();
      assert.deepEqual(await find('cafe'), ['A'], 'the first word alone');
      assert.deepEqual(await find('crem'), ['B'], 'the unfinished word alone');
      assert.deepEqual(await find('cafe or crem'), ['A', 'B'], 'either');
    });
  });

  // ==========================================================================
  module('recorded gaps now closed', function () {
    // Recorded: `_nearSimilarity` is null on every row once a window
    // (an expression sort entry with top) is present. docs/search.md: "A
    // re-ranked row keeps everything else the query computed for it: ...
    // `_nearSimilarity`".
    const NEAR = [127, 0];
    const VECTORS = { A: [127, 0], B: [96, 127] };
    const alike = fixture('alike', {
      Item: {
        A: { title: 'one', price: 10, vec: VECTORS.A },
        B: { title: 'two', price: 5, vec: VECTORS.B },
      },
    });
    const alikeQuery = {
      type: alike.Item,
      sort: [
        { expression: '100 - price', top: 100 },
        { by: 'vec', near: NEAR },
      ],
    };
    test('a re-ranked row keeps its near similarity', async function (assert) {
      let { names, rows } = await run(alike, alikeQuery);
      // 100 - 5 is above 100 - 10
      assert.deepEqual(names, ['B', 'A'], 'in the rerank order');
      assert.true(
        close(rows[0]._nearSimilarity, cosine(VECTORS.B, NEAR)),
        `B: ${rows[0]._nearSimilarity}`,
      );
      assert.true(
        close(rows[1]._nearSimilarity, cosine(VECTORS.A, NEAR)),
        `A: ${rows[1]._nearSimilarity}`,
      );
    });

    test('a re-ranked row keeps its near similarity as a select column', async function (assert) {
      let { columns, rows } = await table(alike, {
        ...alikeQuery,
        select: ['price', '_nearSimilarity', '_window'],
      });
      assert.deepEqual(columns, ['id', 'price', '_nearSimilarity', '_window']);
      assert.deepEqual(
        rows.map((r) => [r[0], r[1], r[3]]),
        [
          ['B', 5, 95],
          ['A', 10, 90],
        ],
        'the rows, their prices and rerank values',
      );
      assert.true(
        close(rows[0][2], cosine(VECTORS.B, NEAR)),
        `B: ${rows[0][2]}`,
      );
      assert.true(
        close(rows[1][2], cosine(VECTORS.A, NEAR)),
        `A: ${rows[1][2]}`,
      );
    });

    // Recorded beside COUNTIFS: SUMPRODUCT over peers lists scored almost no
    // row. Every expression now runs in SQL, whose score profile has no
    // SUMPRODUCT: it is refused before anything runs, rather than scoring
    // nothing.
    const products = fixture('products', {
      Item: {
        A: { title: 'one', a: 2, b: 1 },
        B: { title: 'two', a: 4, b: 2 },
        C: { title: 'three', a: 6, b: 2 },
      },
    });
    test('SUMPRODUCT over two peers lists is refused: SQL cannot run it', async function (assert) {
      let { refused } = await outcome(() =>
        run(products, {
          type: products.Item,
          sort: [
            { expression: 'SUMPRODUCT(peers.a, peers.b)', top: 100 },
            { by: 'a' },
          ],
        }),
      );
      isCodedRefusal(
        assert,
        refused!,
        /SUMPRODUCT/,
        'SUMPRODUCT',
        'expression-unsupported',
      );
    });
  });

  // ==========================================================================
  module('focused cases', function () {
    // ---- labels -----------------------------------------------------------
    const named = fixture('named', {
      Brand: { x: { name: 'Xeno' } },
      Item: {
        A: {
          title: 'one',
          kind: 'lamp',
          price: 10,
          reviewCount: 7,
          brand: brand('named', 'Xeno'),
        },
        B: {
          title: 'two',
          kind: 'lamp',
          price: 30,
          reviewCount: 2,
          brand: brand('named', 'Xeno'),
        },
        C: { title: 'three', kind: 'rug', price: 20, reviewCount: 5 },
      },
    });
    test('a label in eq, range, sort and collapse gives the rows its path gives', async function (assert) {
      let both = async (
        labeledForm: Q,
        pathForm: Q,
        expected: string[],
        what: string,
      ) => {
        for (let [form, q] of [
          ['label', labeledForm],
          ['path', pathForm],
        ] as [string, Q][]) {
          assert.deepEqual(
            (await run(named, { type: named.Item, ...q })).names,
            expected,
            `${what} (${form})`,
          );
        }
      };
      let byPrice = [{ by: 'price' }];
      await both(
        { filter: { eq: { Kind: 'lamp' } }, sort: byPrice },
        { filter: { eq: { kind: 'lamp' } }, sort: byPrice },
        ['A', 'B'],
        'eq',
      );
      await both(
        { filter: { range: { Price: { gte: 20 } } }, sort: byPrice },
        { filter: { range: { price: { gte: 20 } } }, sort: byPrice },
        ['C', 'B'],
        'range',
      );
      await both(
        { sort: [{ by: 'Review Count' }] },
        { sort: [{ by: 'reviewCount' }] },
        ['B', 'C', 'A'],
        'sort, lowest first',
      );
      // the cheapest of each kind
      await both(
        { sort: byPrice, collapse: 'Kind' },
        { sort: byPrice, collapse: 'kind' },
        ['A', 'C'],
        'collapse',
      );
    });

    test('a label through a link names the facet by its path', async function (assert) {
      let answer = await run(named, {
        type: named.Item,
        facets: [{ by: 'Brand.Name' }],
      });
      assert.deepEqual(answer.meta.facets, {
        'brand.name': [{ value: 'Xeno', count: 2 }],
      });
    });

    test('a label in select reads the column, or is refused by name', async function (assert) {
      let { answer, refused } = await outcome(() =>
        table(named, {
          type: named.Item,
          sort: [{ by: 'price' }],
          select: ['Price'],
        }),
      );
      if (refused) {
        isCodedRefusal(assert, refused, /Price/, 'the label Price');
      } else {
        assert.deepEqual(answer!.rows, [
          ['A', 10],
          ['C', 20],
          ['B', 30],
        ]);
      }
    });

    // ---- text -------------------------------------------------------------
    const makers = fixture('makers', {
      Brand: {
        solo: { name: 'Solo' },
        works: { name: 'Solo Works' },
        other: { name: 'Other' },
      },
      Item: {
        A: { title: 'cup', brand: brand('makers', 'Solo') },
        B: { title: 'bowl', brand: brand('makers', 'Solo Works') },
        // the word is in its title, not its brand
        C: { title: 'Solo cup', brand: brand('makers', 'Other') },
      },
    });
    test('matches with fields reads a field through a link', async function (assert) {
      let { names } = await run(makers, {
        type: makers.Item,
        filter: { matches: 'solo', fields: ['brand.name'] },
      });
      assert.deepEqual(names.sort(), ['A', 'B']);
    });

    const coded = fixture('coded', {
      Item: {
        A: { title: 'one', sku: 'FG-0346-X', vec: [127, 0] },
        // cosine to A: 127 / sqrt(127² + 60²) = 0.904
        B: { title: 'two', sku: 'ZZ-1', vec: [127, 60] },
        C: { title: 'three', sku: 'ZZ-2', vec: [0, 127] },
      },
    });
    test('a pattern anchors a one-card binding, and the same glob admits and boosts', async function (assert) {
      let glob = { pattern: { sku: 'fg-0346*' } };
      let answer = await run(coded, {
        type: coded.Item,
        let: {
          $typed: { from: { type: coded.Item, filter: glob }, one: true },
        },
        filter: {
          any: [
            glob,
            {
              near: {
                vec: {
                  to: '$typed.vec',
                  minSimilarity: 0.8,
                },
              },
            },
          ],
        },
        sort: [{ blend: [{ boost: glob }] }],
      });
      assert.deepEqual(answer.meta.lets, {
        $typed: { strategy: 'card', found: true },
      });
      // A by the glob (and its own vector), B by its vector; the boost lifts
      // only A
      assert.deepEqual(answer.names, ['A', 'B']);
      assert.true(close(answer.rows[0]._blendScore, 1 / (RRF_K + 1)), 'A');
      assert.true(close(answer.rows[1]._blendScore, 0), 'B');
    });

    // ---- rerank -----------------------------------------------------------
    const rated = fixture('rated', {
      Brand: { x: { name: 'Xeno' } },
      Item: {
        A: { title: 'one', rating: 3, brand: brand('rated', 'Xeno') },
        B: { title: 'two', rating: 4, brand: brand('rated', 'Xeno') },
        C: { title: 'three', rating: 5, brand: brand('rated', 'Xeno') },
      },
    });
    test('COUNTIF over peers with a built criterion counts the peers above the row', async function (assert) {
      let answer = await run(rated, {
        type: rated.Item,
        sort: [
          {
            expression: 'COUNTIF(peers.rating, ">" & rating)',
            compare: { by: 'brand.name' },
            direction: 'asc',
          },
          { by: 'rating' },
        ],
      });
      assert.deepEqual(rerankOf(answer), { A: 2, B: 1, C: 0 });
      assert.deepEqual(answer.names, ['C', 'B', 'A'], 'fewest above first');
    });

    const priced = fixture('priced', {
      Item: {
        K10: { title: 'one', kind: 'k', price: 10, rating: 5 },
        K20: { title: 'two', kind: 'k', price: 20, rating: 3 },
        K30: { title: 'three', kind: 'k', price: 30, rating: 3 },
        J100: { title: 'four', kind: 'j', price: 100, rating: 5 },
      },
    });
    test("compare.by with compare.filter: the set is the filter's rows of the row's group, not the query's matches", async function (assert) {
      let ask = (compare: Q) =>
        run(priced, {
          type: priced.Item,
          filter: { range: { rating: { gte: 5 } } },
          sort: [
            { expression: 'price / stats.price.median', compare },
            { by: 'price' },
          ],
        });
      // against every card of its kind: 10 over the median of 10, 20, 30
      assert.deepEqual(
        rerankOf(await ask({ by: 'kind', filter: { type: priced.Item } })),
        { K10: 0.5, J100: 1 },
        'the set is every card of the kind',
      );
      // against the query's matches of its kind: itself
      assert.deepEqual(
        rerankOf(await ask({ by: 'kind' })),
        { K10: 1, J100: 1 },
        'the set is the matches of the kind',
      );
    });

    const blanks = fixture('blanks', {
      Item: {
        R5: { title: 'one', rating: 5 },
        R4: { title: 'two', rating: 4 },
        R3: { title: 'three', rating: 3 },
        R2: { title: 'four', rating: 2 },
      },
    });
    for (let blank of ['NA()']) {
      test(`a row whose window value is ${blank} keeps its place after the scored rows`, async function (assert) {
        let answer = await run(blanks, {
          type: blanks.Item,
          sort: [
            { expression: `IF(rating <= 3, 10 - rating, ${blank})`, top: 100 },
            { by: 'rating', direction: 'desc' },
          ],
        });
        // 10 - 2 and 10 - 3 first, then the unscored rows in the query's
        // order (rating, highest first)
        assert.deepEqual(answer.names, ['R2', 'R3', 'R5', 'R4']);
        assert.deepEqual(rerankOf(answer), {
          R2: 8,
          R3: 7,
          R5: null,
          R4: null,
        });
        assert.strictEqual(answer.meta.window?.scored, 2, 'two rows scored');
      });
    }
    // Text is no score: an expression whose value can be text ("") is
    // outside the score profile, and refused.
    test('an expression whose value can be text is refused', async function (assert) {
      let { refused } = await outcome(() =>
        run(blanks, {
          type: blanks.Item,
          sort: [
            { expression: 'IF(rating <= 3, 10 - rating, "")', top: 100 },
            { by: 'rating', direction: 'desc' },
          ],
        }),
      );
      isCodedRefusal(
        assert,
        refused!,
        /text/,
        'a text value',
        'expression-unsupported',
      );
    });

    const unsorted = fixture('unsorted', {
      Item: {
        A: { title: 'one', price: 20 },
        B: { title: 'two', price: 30 },
        C: { title: 'three', price: 10 },
      },
    });
    test('a window with no other sort orders the rows by its value, and pages cover each row once', async function (assert) {
      let query = {
        type: unsorted.Item,
        sort: [{ expression: 'price', top: 100 }],
      };
      assert.deepEqual((await run(unsorted, query)).names, ['B', 'A', 'C']);
      let paged: string[] = [];
      for (let number of [0, 1, 2]) {
        let { names } = await run(unsorted, {
          ...query,
          page: { size: 1, number },
        });
        paged.push(...names);
      }
      assert.deepEqual(paged, ['B', 'A', 'C'], 'one row a page, in order');
    });

    const grouped = fixture('grouped', {
      Brand: { x: { name: 'Xeno' }, y: { name: 'Yarrow' } },
      Item: {
        // nearest first to [127, 0]: X10, X20, Y5
        X10: {
          title: 'one',
          price: 10,
          vec: [127, 0],
          brand: brand('grouped', 'Xeno'),
        },
        X20: {
          title: 'two',
          price: 20,
          vec: [127, 40],
          brand: brand('grouped', 'Xeno'),
        },
        Y5: {
          title: 'three',
          price: 5,
          vec: [127, 90],
          brand: brand('grouped', 'Yarrow'),
        },
      },
    });
    test('collapse, then the window: it sees the kept row of each group, and the group size survives', async function (assert) {
      let answer = await run(grouped, {
        type: grouped.Item,
        sort: [
          { expression: '100 - price', top: 100 },
          { by: 'vec', near: [127, 0] },
        ],
        collapse: 'brand.name',
      });
      // X10 is the nearest Xeno card; 100 - 5 is above 100 - 10
      assert.deepEqual(answer.names, ['Y5', 'X10']);
      assert.deepEqual(rerankOf(answer), { Y5: 95, X10: 90 });
      assert.deepEqual(
        answer.rows.map((r) => Number(r._collapseSize)),
        [1, 2],
        'each row says how many matches its group holds',
      );
    });

    const lookalikes = fixture('lookalikes', {
      Item: {
        A: { title: 'one', kind: 'k', vec: [127, 0] },
        B: { title: 'two', kind: 'k', vec: [127, 26] },
        // nearer to A than B is, and of another kind
        C: { title: 'three', kind: 'j', vec: [127, 18] },
      },
    });
    test("compare.near with a filter draws the look-alikes from the filter's rows only", async function (assert) {
      let ask = async (expression: string, filter?: Q) =>
        rerankOf(
          await run(lookalikes, {
            type: lookalikes.Item,
            filter: { eq: { title: 'one' } },
            sort: [
              {
                expression,
                compare: {
                  near: 'vec',
                  k: 5,
                  minSimilarity: 0.9,
                  ...(filter ? { filter } : {}),
                },
              },
            ],
          }),
        );
      let ofKind = { on: lookalikes.Item, eq: { kind: 'k' } };
      assert.deepEqual(
        await ask('COUNT(peers.similarity)'),
        { A: 2 },
        'with no filter, both other cards are look-alikes',
      );
      assert.deepEqual(
        await ask('COUNT(peers.similarity)', ofKind),
        { A: 1 },
        'with the filter, only the one of its kind',
      );
      let average = (await ask('AVERAGE(peers.similarity)', ofKind)).A;
      assert.true(
        close(average, cosine([127, 0], [127, 26])),
        `peers.similarity is the cosine to B: ${average}`,
      );
    });

    // ---- blends and boosts ------------------------------------------------
    const cover = fixture('cover', {
      Item: {
        A: { title: 'one', stock: 5, sold: 1 },
        B: { title: 'two', stock: 1, sold: 1 },
      },
    });
    // docs/search.md, Blended ranking: "Each signal ranks best first,
    // meaning highest value first unless the entry says `direction: 'asc'`",
    // and an expression is one of the entries the list takes.
    test("an expression signal in a blend honors direction: 'asc'", async function (assert) {
      let ask = async (direction?: string) =>
        (
          await run(cover, {
            type: cover.Item,
            sort: [
              {
                blend: [
                  {
                    expression: 'stock / sold',
                    ...(direction ? { direction } : {}),
                  },
                ],
              },
            ],
          })
        ).names;
      assert.deepEqual(await ask(), ['A', 'B'], 'highest first by default');
      assert.deepEqual(await ask('asc'), ['B', 'A'], 'lowest first when asked');
    });

    const lifted = fixture('lifted', {
      Item: {
        A: { title: 'vase', material: 'stone', sku: 'ab-1' },
        B: { title: 'metal pot', material: 'steel', sku: 'cd-2' },
        C: { title: 'bowl', material: 'wood', sku: 'ef-3' },
        D: { title: 'tray', material: 'cork', sku: 'gh-4' },
      },
      List: {
        L: {
          items: [link('lifted', 'Item', 'C'), link('lifted', 'Item', 'D')],
        },
      },
    });
    // docs/search.md: every card a boost's filter admits gains
    // weight / (k + 1), and a card it does not admit gains nothing.
    for (let [what, boost, liftedNames] of [
      [
        'a union of a field value and a title word',
        {
          any: [
            { eq: { material: 'stone' } },
            { matches: 'metal', scope: 'title' },
          ],
        },
        ['A', 'B'],
      ],
      ['a glob', { pattern: { sku: 'ab*' } }, ['A']],
      [
        'a saved list',
        { linkedFrom: { card: idOf('lifted', 'List', 'L'), field: 'items' } },
        ['C', 'D'],
      ],
    ] as [string, Q, string[]][]) {
      test(`a boost takes any filter: ${what}`, async function (assert) {
        let { rows } = await run(lifted, {
          type: lifted.Item,
          sort: [{ blend: [{ boost, weight: 1 }] }],
        });
        for (let r of rows) {
          let name = nameOf(r.url);
          let expected = liftedNames.includes(name) ? 1 / (RRF_K + 1) : 0;
          assert.true(
            close(r._blendScore, expected),
            `${name}: ${r._blendScore} is ${expected}`,
          );
        }
        assert.strictEqual(rows.length, 4, 'no card is dropped');
      });
    }

    const bounded = fixture('bounded', {
      Item: {
        R: { title: 'reference', price: 50 },
        A: { title: 'one', price: 40 },
        B: { title: 'two', price: 60 },
      },
    });
    test('a boost reads a one-card binding in a range bound and in an eq', async function (assert) {
      let ref = {
        from: {
          type: bounded.Item,
          filter: { eq: { id: bounded.id('Item', 'R') } },
        },
        one: true,
      };
      let scores = async (boost: Q, weight: number) =>
        Object.fromEntries(
          (
            await run(bounded, {
              type: bounded.Item,
              let: { $ref: ref },
              sort: [{ blend: [{ boost, weight }] }],
            })
          ).rows.map((r) => [nameOf(r.url), Number(r._blendScore)]),
        );
      // only A costs less than the reference
      let under = await scores({ range: { price: { lt: '$ref.price' } } }, 1);
      assert.true(close(under.A, 1 / (RRF_K + 1)), `A: ${under.A}`);
      assert.true(close(under.B, 0), `B gains nothing: ${under.B}`);
      assert.true(close(under.R, 0), `R gains nothing: ${under.R}`);
      let same = await scores({ eq: { id: '$ref.id' } }, 5);
      assert.true(close(same.R, 5 / (RRF_K + 1)), `R: ${same.R}`);
      assert.true(close(same.A, 0), `A gains nothing: ${same.A}`);
      assert.true(close(same.B, 0), `B gains nothing: ${same.B}`);
    });

    // ---- select -----------------------------------------------------------
    const scored = fixture('scored', {
      Item: {
        P: { title: 'one', kind: 'k', price: 30, rating: 3 },
        Q: { title: 'two', kind: 'k', price: 20, rating: 5 },
        R: { title: 'three', kind: 'j', price: 10, rating: 4 },
      },
    });
    test("select returns the query's scores as columns", async function (assert) {
      // price ranks P, Q, R and rating ranks Q, R, P, highest first
      let rrf = (a: number, b: number) => 1 / (RRF_K + a) + 1 / (RRF_K + b);
      let fused = await table(scored, {
        type: scored.Item,
        sort: [{ blend: [{ by: 'price' }, { by: 'rating' }] }],
        select: ['_blendScore'],
      });
      assert.deepEqual(
        fused.rows.map((r) => r[0]),
        ['Q', 'P', 'R'],
        'in fused order',
      );
      [rrf(2, 1), rrf(1, 3), rrf(3, 2)].forEach((expected, i) =>
        assert.true(
          close(fused.rows[i][1], expected),
          `${fused.rows[i][0]}: ${fused.rows[i][1]} is ${expected}`,
        ),
      );

      let collapsed = await table(scored, {
        type: scored.Item,
        sort: [{ by: 'price', direction: 'desc' }],
        collapse: 'kind',
        select: ['_collapseSize'],
      });
      assert.deepEqual(
        collapsed.rows.map((r) => [r[0], Number(r[1])]),
        [
          ['P', 2],
          ['R', 1],
        ],
        'the dearest of each kind, with its group size',
      );

      let reranked = await table(scored, {
        type: scored.Item,
        sort: [{ expression: 'price', top: 100 }, { by: 'rating' }],
        select: [{ saving: '_window' }],
      });
      assert.deepEqual(reranked.columns, ['id', 'saving'], 'a renamed score');
      assert.deepEqual(
        reranked.rows.map((r) => [r[0], Number(r[1])]),
        [
          ['P', 30],
          ['Q', 20],
          ['R', 10],
        ],
      );
    });

    // ---- bindings ---------------------------------------------------------
    const sized = fixture('sized', {
      Item: {
        A: { title: 'one' },
        B: { title: 'two' },
        C: { title: 'three' },
      },
      Variant: {
        a7: { parent: link('sized', 'Item', 'A'), size: '7' },
        a9: { parent: link('sized', 'Item', 'A'), size: '9' },
        b9: { parent: link('sized', 'Item', 'B'), size: '9' },
      },
    });
    test('a list binding from another type joins through a link id, both ways', async function (assert) {
      let items = await run(sized, {
        type: sized.Item,
        let: {
          $fit: {
            from: { type: sized.Variant, filter: { eq: { size: '7' } } },
            select: 'parent.id',
          },
        },
        filter: { in: { id: '$fit' } },
      });
      assert.deepEqual(items.names, ['A'], 'the item with a size 7 variant');
      assert.deepEqual(items.meta.lets, {
        $fit: { strategy: 'list', values: 1 },
      });

      let variants = await run(sized, {
        type: sized.Variant,
        let: {
          $some: {
            from: { type: sized.Item, filter: { eq: { title: 'two' } } },
            select: 'id',
          },
        },
        filter: { in: { 'parent.id': '$some' } },
      });
      assert.deepEqual(variants.names, ['b9'], "that item's variants");
      assert.deepEqual(variants.meta.lets, {
        $some: { strategy: 'list', values: 1 },
      });
    });

    test('"has the wanted variant, or has none": in one list, or not in another', async function (assert) {
      let { names } = await run(sized, {
        type: sized.Item,
        let: {
          $withAny: { from: { type: sized.Variant }, select: 'parent.id' },
          $withSeven: {
            from: { type: sized.Variant, filter: { eq: { size: '7' } } },
            select: 'parent.id',
          },
        },
        filter: {
          any: [
            { in: { id: '$withSeven' } },
            { not: { in: { id: '$withAny' } } },
          ],
        },
      });
      // A has a 7; B has variants but no 7; C has no variant
      assert.deepEqual(names.sort(), ['A', 'C']);
    });

    const saved = fixture('saved', {
      Item: {
        A: { title: 'one', kind: 'sofa', price: 20 },
        B: { title: 'two', kind: 'lamp', price: 80 },
        C: { title: 'three', kind: 'sofa', price: 50 },
        D: { title: 'four', kind: 'rug', price: 10 },
        E: { title: 'five', kind: 'bed', price: 90 },
      },
      List: {
        L: { items: [link('saved', 'Item', 'A'), link('saved', 'Item', 'B')] },
      },
    });
    const onList = {
      linkedFrom: { card: idOf('saved', 'List', 'L'), field: 'items' },
    };
    test("a binding's query can read a saved list, as a list of values and as one card", async function (assert) {
      let more = await run(saved, {
        type: saved.Item,
        let: {
          $kinds: {
            from: { type: saved.Item, filter: onList },
            select: 'kind',
          },
        },
        filter: {
          every: [{ in: { kind: '$kinds' } }, { not: onList }],
        },
      });
      // the list holds a sofa and a lamp; C is the only other sofa or lamp
      assert.deepEqual(more.names, ['C']);
      assert.deepEqual(more.meta.lets, {
        $kinds: { strategy: 'list', values: 2 },
      });

      let one = await run(saved, {
        type: saved.Item,
        let: {
          $pick: {
            from: {
              type: saved.Item,
              filter: { every: [onList, { eq: { kind: 'sofa' } }] },
            },
            one: true,
          },
        },
        filter: { eq: { id: '$pick.id' } },
      });
      assert.deepEqual(one.names, ['A'], 'the sofa on the list');
      assert.deepEqual(one.meta.lets, {
        $pick: { strategy: 'card', found: true },
      });
    });

    test('two one-card bindings, each the first of an opposite sort, bound a range', async function (assert) {
      let first = (direction: string) => ({
        from: {
          type: saved.Item,
          filter: onList,
          sort: [{ by: 'price', direction }],
        },
        one: true,
      });
      let { names } = await run(saved, {
        type: saved.Item,
        let: { $low: first('asc'), $high: first('desc') },
        filter: {
          range: {
            price: {
              gte: '$low.price',
              lte: '$high.price',
            },
          },
        },
        sort: [{ by: 'price' }],
      });
      // the list's prices are 20 and 80; 10 and 90 fall outside
      assert.deepEqual(names, ['A', 'C', 'B']);
    });

    const pointed = fixture('pointed', {
      Item: {
        A: { title: 'one', kind: 'a', vec: [127, 0] },
        B: { title: 'two', kind: 'b', vec: [0, 127] },
      },
    });
    test('a one-card binding found by a near sort with no filter is the nearest card', async function (assert) {
      let answer = await run(pointed, {
        type: pointed.Item,
        let: {
          $best: {
            from: {
              type: pointed.Item,
              sort: [{ by: 'vec', near: [127, 0] }],
            },
            one: true,
          },
        },
        filter: { eq: { kind: '$best.kind' } },
      });
      assert.deepEqual(answer.names, ['A']);
      assert.deepEqual(answer.meta.lets, {
        $best: { strategy: 'card', found: true },
      });
    });

    const branded = fixture('branded', {
      Brand: { x: { name: 'Xeno' }, y: { name: 'Yarrow' } },
      Item: {
        R: { title: 'reference', brand: brand('branded', 'Xeno') },
        A: { title: 'one', brand: brand('branded', 'Xeno') },
        B: { title: 'two', brand: brand('branded', 'Yarrow') },
        C: { title: 'three' },
      },
    });
    for (let [how, none] of [
      ['missing', { missing: 'brand.name' }],
      ['eq null', { eq: { 'brand.name': null } }],
    ] as [string, Q][]) {
      test(`"a different brand" keeps the cards with no brand (${how})`, async function (assert) {
        let { names } = await run(branded, {
          type: branded.Item,
          let: {
            $ref: {
              from: {
                type: branded.Item,
                filter: { eq: { id: branded.id('Item', 'R') } },
              },
              one: true,
            },
          },
          filter: {
            any: [
              none,
              {
                not: {
                  eq: { 'brand.name': '$ref.brand.name' },
                },
              },
            ],
          },
        });
        // not Xeno: B by its brand, C by having none
        assert.deepEqual(names.sort(), ['B', 'C']);
      });
    }

    // ---- facets -----------------------------------------------------------
    const tiers = fixture('tiers', {
      Item: {
        A: { title: 'one', price: 5 },
        B: { title: 'two', price: 15 },
        C: { title: 'three', price: 25 },
      },
    });
    test('statistics and range buckets on the same field both come back', async function (assert) {
      let { meta } = await run(tiers, {
        type: tiers.Item,
        facets: [
          { by: 'price', stats: true },
          { by: 'price', ranges: [{ to: 10 }, { from: 10 }] },
        ],
      });
      let stats = meta.facetStats?.price ?? {};
      assert.deepEqual(
        { min: stats.min, max: stats.max, avg: stats.avg, count: stats.count },
        { min: 5, max: 25, avg: 15, count: 3 },
        'the statistics',
      );
      assert.deepEqual(
        meta.facets?.price,
        [
          { value: '*-10', count: 1 },
          { value: '10-*', count: 2 },
        ],
        'the buckets',
      );
    });

    const shelves = fixture('shelves', {
      Item: {
        Da1: { title: 'one', dept: 'D', cat: 'a', price: 10 },
        Da2: { title: 'two', dept: 'D', cat: 'a', price: 15 },
        Db: { title: 'three', dept: 'D', cat: 'b', price: 30 },
        Ea: { title: 'four', dept: 'E', cat: 'a', price: 12 },
      },
    });
    test("own: 'ignore' lifts only the facet's own clause: an in", async function (assert) {
      let answer = await run(shelves, {
        type: shelves.Item,
        filter: { every: [{ eq: { dept: 'D' } }, { in: { cat: ['a'] } }] },
        facets: [{ by: 'cat', own: 'ignore' }, { by: 'dept' }],
      });
      assert.deepEqual(answer.names.sort(), ['Da1', 'Da2'], 'the rows');
      // without the pick on cat: department D's three cards
      assert.deepEqual(facetOf(answer, 'cat'), { a: 2, b: 1 }, 'cat');
      // with both clauses
      assert.deepEqual(facetOf(answer, 'dept'), { D: 2 }, 'dept');
    });

    test("own: 'ignore' lifts only the facet's own clause: a range", async function (assert) {
      let answer = await run(shelves, {
        type: shelves.Item,
        filter: {
          every: [{ eq: { dept: 'D' } }, { range: { price: { lt: 20 } } }],
        },
        facets: [
          {
            by: 'price',
            own: 'ignore',
            ranges: [
              { to: 20, key: 'low' },
              { from: 20, key: 'high' },
            ],
          },
        ],
      });
      assert.deepEqual(answer.names.sort(), ['Da1', 'Da2'], 'the rows');
      // department D without the price cap: the bucket above it is counted
      assert.deepEqual(facetOf(answer, 'price'), { low: 2, high: 1 });
    });

    const five = fixture('five', {
      Item: {
        A: { title: 'one', kind: 'k', price: 1 },
        B: { title: 'two', kind: 'k', price: 2 },
        C: { title: 'three', kind: 'k', price: 3 },
        D: { title: 'four', kind: 'j', price: 4 },
        E: { title: 'five', kind: 'j', price: 5 },
      },
    });
    test('facets count every match while a window reorders and a page cuts', async function (assert) {
      let answer = await run(five, {
        type: five.Item,
        sort: [{ expression: 'price', top: 2 }, { by: 'price' }],
        page: { size: 2 },
        facets: [{ by: 'kind' }],
      });
      // the window is the two cheapest, dearest of them first
      assert.deepEqual(answer.names, ['B', 'A'], 'the page');
      assert.deepEqual(facetOf(answer, 'kind'), { k: 3, j: 2 }, 'every match');
      assert.strictEqual(answer.meta.page.total, 5, 'the total');
    });

    const dated = fixture('dated', {
      Item: {
        A: { title: 'one', listedAt: '2024-12-31T23:59:00.000Z' },
        B: { title: 'two', listedAt: '2025-01-01T00:00:00.000Z' },
        C: { title: 'three', listedAt: '2025-06-01T00:00:00.000Z' },
      },
    });
    test("interval: 'year' buckets by UTC year", async function (assert) {
      let answer = await run(dated, {
        type: dated.Item,
        facets: [{ by: 'listedAt', interval: 'year' }],
      });
      let byYear = Object.fromEntries(
        (answer.meta.facets?.listedAt ?? []).map((e: any) => [
          String(e.value).slice(0, 4),
          Number(e.count),
        ]),
      );
      assert.deepEqual(byYear, { '2024': 1, '2025': 2 });
    });

    const sizes = fixture('sizes', {
      Item: {
        L1: { title: 'one', size: 'L', price: 20 },
        L2: { title: 'two', size: 'L', price: 30 },
        S1: { title: 'three', size: 'S', price: 50 },
      },
    });
    test("a facet measure of min, with order: 'value'", async function (assert) {
      let { meta } = await run(sizes, {
        type: sizes.Item,
        facets: [{ by: 'size', measure: { min: 'price' }, order: 'value' }],
      });
      assert.deepEqual(meta.facets?.size, [
        { value: 'L', count: 2, measure: { min: 20 } },
        { value: 'S', count: 1, measure: { min: 50 } },
      ]);
    });

    const paths = fixture('paths', {
      Item: {
        A: { title: 'one', path: 'F / L / Sofas', price: 10 },
        B: { title: 'two', path: 'F / L / Sofas', price: 30 },
        C: { title: 'three', path: 'F / L / Chairs', price: 20 },
        D: { title: 'four', path: 'K / Pans', price: 99 },
      },
    });
    test('a prefix facet keeps the measure of the values it keeps', async function (assert) {
      let { meta } = await run(paths, {
        type: paths.Item,
        facets: [{ by: 'path', prefix: 'F / L', measure: { avg: 'price' } }],
      });
      assert.deepEqual(meta.facets?.path, [
        { value: 'F / L / Sofas', count: 2, measure: { avg: 20 } },
        { value: 'F / L / Chairs', count: 1, measure: { avg: 20 } },
      ]);
    });
  });

  // ==========================================================================
  // What the engine does today where docs/search.md does not give the rule.
  module('pinned, rule not yet decided', function () {
    const typed = fixture('typed', {
      Item: {
        A: { title: 'Storage Ottoman', sold: 3 },
        B: { title: 'Ottoman', sold: 9 },
      },
    });
    // docs/search.md says a `textRelevance` signal "needs a positive
    // `matches` term in the filter" (`matches-required`); it also says a
    // type-ahead (`matches`, `prefix`, `scope: 'title'`) is "sorted by text relevance", and docs/search-intent.md
    // makes `textRelevance` the search pane's sort "whenever there is a
    // term". Whether a type-ahead term counts is not said.
    test('a textRelevance signal beside a type-ahead term (matches, prefix, title scope) is accepted', async function (assert) {
      // pins current behavior; rule not yet decided
      let { answer, refused } = await outcome(() =>
        run(typed, {
          type: typed.Item,
          filter: { prefix: true, scope: 'title', matches: 'otto stor' },
          sort: [
            { blend: [{ by: 'textRelevance' }, { by: 'sold', weight: 0.5 }] },
          ],
        }),
      );
      assert.strictEqual(refused, undefined, 'not refused');
      assert.deepEqual(answer?.names, ['A'], 'the type-ahead still filters');
    });

    const peers = fixture('peers', {
      Item: {
        K10: { title: 'one', kind: 'k', price: 10, rating: 5 },
        K20: { title: 'two', kind: 'k', price: 20, rating: 3 },
        K30: { title: 'three', kind: 'k', price: 30, rating: 3 },
      },
    });
    // docs/search.md lists the filter, every sort entry and the collapse as
    // inheriting the query's `type`. It does not say whether a window's
    // comparison filter does.
    test("a window's comparison filter inherits the query's type, as every clause does", async function (assert) {
      // decided (DO5): a top-level `type` anchors every clause, the
      // comparison set's filter included
      let ask = (filter: Q) =>
        outcome(() =>
          run(peers, {
            type: peers.Item,
            filter: { range: { rating: { gte: 5 } } },
            sort: [
              { expression: 'price / stats.price.median', compare: { filter } },
            ],
          }),
        );
      let bare = await ask({ eq: { kind: 'k' } });
      let anchored = await ask({ on: peers.Item, eq: { kind: 'k' } });
      // 10 over the median of 10, 20 and 30
      assert.deepEqual(rerankOf(anchored.answer!), { K10: 0.5 }, 'with `on`');
      assert.deepEqual(
        bare.answer ? rerankOf(bare.answer) : bare.refused,
        rerankOf(anchored.answer!),
        'with no anchor, the same as with `on`',
      );
    });

    const titled = fixture('titled', {
      Item: {
        A: { title: 'recliner', body: 'a chair' },
        B: { title: 'rocker', body: 'not a recliner' },
      },
    });
    // docs/search.md says which options `fields` excludes, and nothing of
    // `typos` beside `scope`.
    test("typos with scope: 'title' corrects the word and still reads only the title", async function (assert) {
      // pins current behavior; rule not yet decided
      let { names } = await run(titled, {
        type: titled.Item,
        filter: { matches: 'reclinr', typos: true, scope: 'title' },
      });
      assert.deepEqual(names, ['A']);
    });

    const flags = fixture('flags', {
      Item: {
        A: { title: 'one', inStock: true, onSale: true },
        B: { title: 'two', inStock: true, onSale: false },
        C: { title: 'three', inStock: false, onSale: true },
      },
    });
    // docs/search.md shows several fields in one clause for `range` only.
    test('several fields in one eq are all required', async function (assert) {
      // pins current behavior; rule not yet decided
      let { names } = await run(flags, {
        type: flags.Item,
        filter: { eq: { inStock: true, onSale: true } },
      });
      assert.deepEqual(names, ['A']);
    });

    const measured = fixture('measured', {
      Item: {
        L1: { title: 'one', size: 'L', price: 20 },
        L2: { title: 'two', size: 'L', price: 30 },
        S1: { title: 'three', size: 'S', price: 50 },
      },
    });
    // docs/search.md gives `order: 'measure'` and no direction for it.
    test("order: 'measure' lists the largest measure first", async function (assert) {
      // pins current behavior; rule not yet decided
      let { meta } = await run(measured, {
        type: measured.Item,
        facets: [{ by: 'size', measure: { min: 'price' }, order: 'measure' }],
      });
      // by count or by value L would come first
      assert.deepEqual(
        (meta.facets?.size ?? []).map((e: any) => [e.value, e.measure?.min]),
        [
          ['S', 50],
          ['L', 20],
        ],
      );
    });
  });

  // ==========================================================================
  module('refusals', function () {
    const shop = fixture('shop', {
      Item: { A: { title: 'one', kind: 'k', price: 10, reviewCount: 1 } },
    });
    const byKind = { by: 'kind' };
    // [what is refused, the query, its code, what the message names]
    const REFUSED: [string, Q, string, RegExp][] = [
      [
        'a direction on a facet',
        {
          facets: [
            {
              ...byKind,
              measure: { avg: 'price' },
              order: 'measure',
              direction: 'asc',
            },
          ],
        },
        'unknown-key',
        /"direction"/,
      ],
      [
        'a facet inside a facet',
        { facets: [{ ...byKind, facets: [{ by: 'color' }] }] },
        'unknown-key',
        /"facets"/,
      ],
      [
        'levels on a facet',
        { facets: [{ by: 'path', levels: 2 }] },
        'unknown-key',
        /"levels"/,
      ],
      [
        'an expression as a filter',
        {
          filter: {
            every: [{ eq: { kind: 'k' } }, { expression: 'price > 5' }],
          },
        },
        'unknown-key',
        /"expression"/,
      ],
      [
        'a distinct-count facet measure',
        { facets: [{ ...byKind, measure: { distinct: 'color' } }] },
        'invalid-value',
        /measure/,
      ],
      [
        'a label with a space in a facet measure',
        { facets: [{ ...byKind, measure: { avg: 'Review Count' } }] },
        'invalid-value',
        /measure/,
      ],
      [
        'a label with a space in select',
        { select: ['Review Count'] },
        'invalid-value',
        /"Review Count"/,
      ],
    ];
    for (let [what, query, code, names] of REFUSED) {
      test(`${what} is ${code}`, async function (assert) {
        let { refused } = await outcome(() =>
          run(shop, { type: shop.Item, ...query }),
        );
        isCodedRefusal(assert, refused, names, what, code);
      });
    }
  });
});
