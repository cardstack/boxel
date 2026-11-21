// The fixture realms, and the ways to query them, that the
// query-recorded-gaps-*integration-test.ts files share. Each fixture is a realm
// of its own, written through the index writer once per file.

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  SEARCH_TEXT_KEY,
  VectorSerializer,
  VirtualNetwork,
  baseCardRef,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { hasVectorIndex } from '@cardstack/runtime-common/vector-index';
import type { Query } from '@cardstack/runtime-common/query';
import { parseSearchEntryQueryFromPayload } from '@cardstack/runtime-common/search-entry';
import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './index.ts';
import { definitionLookupOf } from './definition-lookup.ts';
function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const booleanRef = ref('@cardstack/base/boolean', 'default');
const datetimeRef = ref('@cardstack/base/datetime', 'default');
const vectorRef = ref('@cardstack/base/vector', 'default');

export type Q = Record<string, any>;
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
export const idOf = (set: string, type: TypeName, name: string) =>
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
  return definitionLookupOf((codeRef) => {
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
  });
}

// Two int8 components, the larger of them 127, so the stored vector is these
// numbers and a cosine computed here is the one stored.
const vec = (components: number[]) =>
  VectorSerializer.queryableValue(VectorSerializer.encodeVector(components));

export const RRF_K = 60;

interface Fixture {
  set: string;
  rows: Partial<Record<TypeName, Record<string, Doc>>>;
}

export interface Answer {
  names: string[];
  rows: Record<string, any>[];
  meta: Record<string, any>;
}

export interface Refusal {
  code: string | undefined;
  message: string;
}
export function setupRecordedGaps(hooks: NestedHooks) {
  const FIXTURES: Fixture[] = [];
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
  return {
    fixture,
    link,
    brand,
    nameOf,
    run,
    refusalOf,
    outcome,
    isCodedRefusal,
    close,
    rerankOf,
    facetOf,
    table,
  };
}
