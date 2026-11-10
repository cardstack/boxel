import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  internalKeyFor,
  param,
  query,
  VirtualNetwork,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { lowerQuery } from '@cardstack/runtime-common/query-syntax';

import { setupDB } from './helpers/index.ts';

// What holds for every query, checked over generated ones rather than a few
// chosen by hand. Three small card types stand in for the three apps the
// engine was built against (talks to explore, products to filter, posts to
// recommend). Every row is seeded straight into boxel_index, and a filter is
// also evaluated here in plain JavaScript over the same rows, so the engine's
// SQL is compared with an answer it had no part in producing.
//
// The filters are written the way queries saved in realms are written (an
// `on` anchor and one operator), so this file is also the standing check that
// such a query returns what it always did.
//
// A predicate on a list field holds when some element satisfies it, so its
// `not` selects the cards with no such element, a card with an empty list
// among them. Lists of text and lists of numbers are both generated, under
// `not`, `any` and `every` alike: the two are answered by different SQL.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const realm = 'http://query-invariants-test/';
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const cardDefRef = ref('@cardstack/base/card-api', 'CardDef');

type Kind = 'string' | 'number' | 'strings' | 'numbers';
interface TypeSpec {
  name: string;
  ref: ResolvedCodeRef;
  fields: Record<string, Kind>;
}

function typeSpec(name: string, fields: Record<string, Kind>): TypeSpec {
  return { name, ref: ref(`${realm}${name.toLowerCase()}`, name), fields };
}

const Talk = typeSpec('Talk', {
  title: 'string',
  channel: 'string',
  speakers: 'strings',
  chapters: 'numbers',
  hnScore: 'number',
  year: 'number',
});
const Product = typeSpec('Product', {
  name: 'string',
  brand: 'string',
  tags: 'strings',
  sizes: 'numbers',
  price: 'number',
  rating: 'number',
});
const Post = typeSpec('Post', {
  author: 'string',
  body: 'string',
  topics: 'strings',
  scores: 'numbers',
  likes: 'number',
  reposts: 'number',
});
const TYPES = [Talk, Product, Post];

function isList(kind: Kind): boolean {
  return kind === 'strings' || kind === 'numbers';
}
function isNumeric(kind: Kind): boolean {
  return kind === 'number' || kind === 'numbers';
}

function definitionOf(spec: TypeSpec): Definition {
  let names = Object.keys(spec.fields);
  return {
    type: 'card-def',
    codeRef: spec.ref,
    displayName: spec.name,
    fields: Object.fromEntries(names.map((n, i) => [n, `f${i}`])),
    fieldDefs: Object.fromEntries(
      names.map((n, i) => [
        `f${i}`,
        {
          type: isList(spec.fields[n]) ? 'containsMany' : 'contains',
          isPrimitive: true,
          isComputed: false,
          fieldOrCard: isNumeric(spec.fields[n]) ? numberRef : stringRef,
          ...(isNumeric(spec.fields[n]) ? { serializerName: 'number' } : {}),
        },
      ]),
    ),
  } as Definition;
}

function refsEqual(a: CodeRef, b: CodeRef): boolean {
  return (
    'module' in a && 'module' in b && a.module === b.module && a.name === b.name
  );
}

function makeDefinitionLookup(): DefinitionLookup {
  let definitions = [
    ...TYPES.map(definitionOf),
    {
      type: 'card-def',
      codeRef: cardDefRef,
      displayName: 'Card',
      fields: {},
      fieldDefs: {},
    } as Definition,
  ];
  const lookup: DefinitionLookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      let found = definitions.find((d) => refsEqual(d.codeRef, codeRef));
      if (!found) {
        throw new Error(
          `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
        );
      }
      return found;
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

// A fixed pseudo-random sequence, so every run generates the same rows and
// the same queries and a failure names a query that fails again.
function sequence(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = {
  string: ['Alpha', 'beta', 'Gamma', 'delta', 'Alpha Beta', 'gamma ray', 'Zed'],
  strings: ['red', 'green', 'blue', 'amber'],
};

type Doc = Record<string, string | number | string[] | number[] | null>;
interface Row {
  url: string;
  spec: TypeSpec;
  lastModified: number;
  doc: Doc;
}

const ROWS_PER_TYPE = 40;

// Few distinct values, so there are ties to order and groups to count; about
// one value in eight is missing, and about one list in four is empty.
function makeRows(): Row[] {
  let next = sequence(20261110);
  let pick = <T>(list: T[]): T => list[Math.floor(next() * list.length)];
  let rows: Row[] = [];
  for (let spec of TYPES) {
    for (let n = 0; n < ROWS_PER_TYPE; n++) {
      let doc: Doc = {};
      for (let [field, kind] of Object.entries(spec.fields)) {
        if (kind === 'strings') {
          let size = Math.floor(next() * 4);
          doc[field] = [
            ...new Set(Array.from({ length: size }, () => pick(WORDS.strings))),
          ];
        } else if (kind === 'numbers') {
          let size = Math.floor(next() * 4);
          doc[field] = [
            ...new Set(
              Array.from({ length: size }, () => Math.floor(next() * 6) * 5),
            ),
          ];
        } else if (next() < 0.125) {
          doc[field] = null;
        } else if (kind === 'number') {
          doc[field] = Math.floor(next() * 6) * 5;
        } else {
          doc[field] = pick(WORDS.string);
        }
      }
      rows.push({
        url: `${realm}${spec.name}/${String(n).padStart(2, '0')}`,
        spec,
        lastModified: 1_000 + Math.floor(next() * 20),
        doc,
      });
    }
  }
  return rows;
}

const ROWS = makeRows();

async function seed(dbAdapter: PgAdapter, vn: VirtualNetwork, row: Row) {
  let typeKey = internalKeyFor(row.spec.ref, undefined, vn);
  await query(dbAdapter, [
    `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified) VALUES (`,
    param(row.url),
    `,`,
    param(row.url),
    `,`,
    param(realm),
    `,`,
    param(1),
    `,`,
    param('instance'),
    `,`,
    param(JSON.stringify({ id: row.url, type: 'card' })),
    `::jsonb,`,
    param(JSON.stringify(row.doc)),
    `::jsonb,`,
    `'[]'::jsonb,`,
    param(JSON.stringify([typeKey])),
    `::jsonb,`,
    param(false),
    `,`,
    param(false),
    `,`,
    param(Date.now()),
    `,`,
    param(row.lastModified),
    `)`,
  ]);
}

// --- the plain evaluation ---------------------------------------------------

type Leaf =
  | { op: 'eq'; field: string; value: string | number }
  | { op: 'in'; field: string; value: (string | number)[] }
  | { op: 'contains'; field: string; value: string }
  | { op: 'range'; field: string; bounds: Record<string, number> };
type Node =
  | Leaf
  | { op: 'not'; of: Node }
  | { op: 'any' | 'every'; of: Node[] };

function valuesOf(row: Row, field: string): (string | number)[] {
  let v = row.doc[field];
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

// A comparison with a missing value is neither true nor false, as in SQL, and
// `not`, `any` and `every` carry that through: a card with no brand is not
// returned by `eq: { brand: 'Zed' }`, nor by its `not`. Queries saved in
// realms have always been answered this way.
type Truth = true | false | null;

function leafHolds(row: Row, node: Leaf): Truth {
  let raw = row.doc[node.field];
  if (raw == null) return null;
  let values: (string | number)[] = Array.isArray(raw) ? raw : [raw];
  switch (node.op) {
    case 'eq':
      return values.includes(node.value);
    case 'in':
      return values.some((v) => node.value.includes(v));
    case 'contains':
      return values.some((v) =>
        String(v).toLowerCase().includes(node.value.toLowerCase()),
      );
    case 'range':
      return values.some((v) =>
        Object.entries(node.bounds).every(([bound, n]) =>
          bound === 'gt'
            ? (v as number) > n
            : bound === 'gte'
              ? (v as number) >= n
              : bound === 'lt'
                ? (v as number) < n
                : (v as number) <= n,
        ),
      );
  }
}

function truth(row: Row, node: Node): Truth {
  switch (node.op) {
    case 'not': {
      let inner = truth(row, node.of);
      return inner === null ? null : !inner;
    }
    case 'any': {
      let all = node.of.map((n) => truth(row, n));
      return all.includes(true) ? true : all.includes(null) ? null : false;
    }
    case 'every': {
      let all = node.of.map((n) => truth(row, n));
      return all.includes(false) ? false : all.includes(null) ? null : true;
    }
    default:
      return leafHolds(row, node);
  }
}

function holds(row: Row, node: Node): boolean {
  return truth(row, node) === true;
}

// The same node as a saved query writes it.
function asFilter(spec: TypeSpec, node: Node): Record<string, any> {
  let on = spec.ref;
  switch (node.op) {
    case 'eq':
      return { on, eq: { [node.field]: node.value } };
    case 'in':
      return { on, in: { [node.field]: node.value } };
    case 'contains':
      return { on, contains: { [node.field]: node.value } };
    case 'range':
      return { on, range: { [node.field]: node.bounds } };
    case 'not':
      return { on, not: asFilter(spec, node.of) };
    case 'any':
      return { on, any: node.of.map((n) => asFilter(spec, n)) };
    case 'every':
      return { on, every: node.of.map((n) => asFilter(spec, n)) };
  }
}

function generateNodes(spec: TypeSpec, count: number, seedValue: number) {
  let next = sequence(seedValue);
  let pick = <T>(list: T[]): T => list[Math.floor(next() * list.length)];
  let fieldsOf = (...kinds: Kind[]) =>
    Object.keys(spec.fields).filter((f) => kinds.includes(spec.fields[f]));
  let valueFor = (kind: Kind): string | number =>
    isNumeric(kind)
      ? Math.floor(next() * 6) * 5
      : pick(kind === 'strings' ? WORDS.strings : WORDS.string);
  let leaf = (): Leaf => {
    let r = next();
    if (r < 0.3) {
      let field = pick(fieldsOf('string', 'number', 'strings', 'numbers'));
      return { op: 'eq', field, value: valueFor(spec.fields[field]) };
    }
    if (r < 0.5) {
      let field = pick(fieldsOf('string', 'strings', 'numbers'));
      let kind = spec.fields[field];
      return { op: 'in', field, value: [valueFor(kind), valueFor(kind)] };
    }
    if (r < 0.7) {
      return {
        op: 'contains',
        field: pick(fieldsOf('string')),
        value: pick(['alpha', 'ETA', 'ma', 'ray', 'z', 'nothing']),
      };
    }
    let bounds: Record<string, number> = {};
    bounds[pick(['gt', 'gte'])] = Math.floor(next() * 4) * 5;
    if (next() < 0.5)
      bounds[pick(['lt', 'lte'])] = 10 + Math.floor(next() * 4) * 5;
    return {
      op: 'range',
      field: pick(fieldsOf('number', 'numbers')),
      bounds,
    };
  };
  let node = (depth: number): Node => {
    let r = next();
    if (depth === 0 || r < 0.45) return leaf();
    if (r < 0.6) return { op: 'not', of: node(depth - 1) };
    return {
      op: r < 0.8 ? 'any' : 'every',
      of: Array.from({ length: 2 + Math.floor(next() * 2) }, () =>
        node(depth - 1),
      ),
    };
  };
  return Array.from({ length: count }, () => node(2));
}

function expectedUrls(spec: TypeSpec, node: Node): string[] {
  return ROWS.filter((row) => row.spec === spec && holds(row, node))
    .map((row) => row.url)
    .sort();
}

module(basename(import.meta.filename), function () {
  module('query invariants (Postgres integration)', function (hooks) {
    let engine: IndexQueryEngine;

    setupDB(hooks, {
      before: async (dbAdapter) => {
        let vn = new VirtualNetwork();
        engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
        for (let row of ROWS) {
          await seed(dbAdapter, vn, row);
        }
      },
    });

    async function search(q: Record<string, any>) {
      let { cards, meta } = await engine.searchCards(
        new URL(realm),
        q as Query,
      );
      return { urls: cards.map((c) => String(c.id)), meta };
    }

    const everything = { size: 500, total: 'exact' as const };

    for (let spec of TYPES) {
      test(`${spec.name}: a generated filter returns the rows a plain evaluation picks`, async function (assert) {
        for (let node of generateNodes(spec, 80, spec.name.length * 7919)) {
          let filter = asFilter(spec, node);
          let expected = expectedUrls(spec, node);
          let { urls, meta } = await search({ filter, page: everything });
          assert.deepEqual([...urls].sort(), expected, JSON.stringify(filter));
          assert.strictEqual(
            meta.page.total,
            expected.length,
            `total of ${JSON.stringify(filter)}`,
          );
        }
      });
    }

    test('a list field: some element matches, and `not` means none does', async function (assert) {
      let products = ROWS.filter((row) => row.spec === Product);
      let tags = (row: Row) => row.doc.tags as string[];
      let sizes = (row: Row) => row.doc.sizes as number[];
      let urlsWhere = (keep: (row: Row) => boolean) =>
        products
          .filter(keep)
          .map((row) => row.url)
          .sort();
      let on = Product.ref;
      let cases: [string, Record<string, any>, (row: Row) => boolean][] = [
        [
          'not tagged red, the untagged among them',
          { on, not: { eq: { tags: 'red' } } },
          (row) => !tags(row).includes('red'),
        ],
        [
          'no size of 10',
          { on, not: { eq: { sizes: 10 } } },
          (row) => !sizes(row).includes(10),
        ],
        [
          'no size above 15',
          { on, not: { range: { sizes: { gt: 15 } } } },
          (row) => !sizes(row).some((n) => n > 15),
        ],
        [
          'two tests of one list are met by different elements',
          { on, every: [{ eq: { sizes: 5 } }, { eq: { sizes: 20 } }] },
          (row) => sizes(row).includes(5) && sizes(row).includes(20),
        ],
        [
          'a branch on another field reaches a card whose list is empty',
          { on, any: [{ eq: { sizes: 5 } }, { eq: { brand: 'Zed' } }] },
          (row) => sizes(row).includes(5) || row.doc.brand === 'Zed',
        ],
      ];
      for (let [label, filter, keep] of cases) {
        let expected = urlsWhere(keep);
        assert.notStrictEqual(expected.length, 0, `${label}: some rows match`);
        assert.notStrictEqual(
          expected.length,
          products.length,
          `${label}: some rows don't`,
        );
        let { urls } = await search({ filter, page: everything });
        assert.deepEqual([...urls].sort(), expected, label);
      }
    });

    test('pages laid end to end are the whole result, each row once', async function (assert) {
      let sorts: (Record<string, any>[] | undefined)[] = [
        undefined,
        [{ by: 'lastModified', direction: 'desc' }],
        [{ on: Product.ref, by: 'price', direction: 'asc' }],
        [{ on: Product.ref, by: 'brand', direction: 'desc' }],
        [
          { on: Product.ref, by: 'rating', direction: 'desc' },
          { on: Product.ref, by: 'name' },
        ],
      ];
      let filters = [
        { type: Product.ref },
        ...generateNodes(Product, 6, 4242).map((n) => asFilter(Product, n)),
      ];
      for (let sort of sorts) {
        for (let filter of filters) {
          let base = { filter, ...(sort ? { sort } : {}) };
          let whole = await search({ ...base, page: everything });
          let laid: string[] = [];
          for (let number = 0; ; number++) {
            let page = await search({ ...base, page: { number, size: 7 } });
            laid.push(...page.urls);
            if (page.urls.length < 7) break;
            if (number > 20) throw new Error('paging did not end');
          }
          let label = JSON.stringify(base);
          assert.deepEqual(laid, whole.urls, `pages of ${label}`);
          assert.strictEqual(
            new Set(laid).size,
            laid.length,
            `no row twice in ${label}`,
          );
          let again = await search({ ...base, page: everything });
          assert.deepEqual(
            again.urls,
            whole.urls,
            `same order again: ${label}`,
          );
        }
      }
    });

    test('a sorted result is in order by its key', async function (assert) {
      for (let [field, direction] of [
        ['price', 'asc'],
        ['price', 'desc'],
        ['brand', 'asc'],
        ['brand', 'desc'],
      ] as const) {
        let { urls } = await search({
          filter: { type: Product.ref },
          sort: [{ on: Product.ref, by: field, direction }],
          page: everything,
        });
        assert.strictEqual(urls.length, ROWS_PER_TYPE, 'a sort drops no row');
        let keys = urls
          .map((url) => ROWS.find((r) => r.url === url)!.doc[field])
          .filter((v) => v != null) as (string | number)[];
        let ordered = keys.every((key, i) => {
          if (i === 0) return true;
          let prev = keys[i - 1];
          let cmp =
            typeof key === 'number'
              ? (prev as number) - key
              : String(prev).toLowerCase() < String(key).toLowerCase()
                ? -1
                : String(prev).toLowerCase() > String(key).toLowerCase()
                  ? 1
                  : 0;
          return direction === 'asc' ? cmp <= 0 : cmp >= 0;
        });
        assert.true(ordered, `${field} ${direction}: ${keys.join(',')}`);
      }
    });

    test('how the total is counted never changes the rows', async function (assert) {
      for (let node of generateNodes(Talk, 12, 99)) {
        let filter = asFilter(Talk, node);
        let sort = [{ on: Talk.ref, by: 'hnScore', direction: 'desc' }];
        let expected = expectedUrls(Talk, node).length;
        let pages = [];
        for (let total of ['none', 'capped', 'exact'] as const) {
          pages.push(await search({ filter, sort, page: { size: 5, total } }));
        }
        let [none, capped, exact] = pages;
        let label = JSON.stringify(filter);
        assert.deepEqual(capped.urls, exact.urls, `capped rows: ${label}`);
        assert.deepEqual(none.urls, exact.urls, `uncounted rows: ${label}`);
        assert.strictEqual(exact.meta.page.total, expected, `exact: ${label}`);
        assert.strictEqual(
          capped.meta.page.total,
          expected,
          `capped: ${label}`,
        );
        assert.true(
          (none.meta.page.total ?? 0) <= expected,
          `an uncounted total is never more than the matches: ${label}`,
        );
      }
    });

    test('facets count the filtered rows, and asking for them leaves the rows alone', async function (assert) {
      let filters = [
        { node: undefined, filter: { type: Talk.ref } as Record<string, any> },
        ...generateNodes(Talk, 15, 31337).map((node) => ({
          node,
          filter: {
            every: [{ type: Talk.ref }, asFilter(Talk, node)],
          } as Record<string, any>,
        })),
      ];
      for (let { node, filter } of filters) {
        let rows = ROWS.filter(
          (row) => row.spec === Talk && (!node || holds(row, node)),
        );
        let count = (field: string) => {
          let counts = new Map<string, number>();
          for (let row of rows) {
            for (let v of valuesOf(row, field)) {
              counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
            }
          }
          return Object.fromEntries([...counts].sort());
        };
        let sort = [{ on: Talk.ref, by: 'year', direction: 'desc' }];
        let plain = await search({ filter, sort, page: { size: 6 } });
        let faceted = await search({
          filter,
          sort,
          page: { size: 6 },
          facets: [{ by: 'channel' }, { by: 'speakers' }],
        });
        let label = JSON.stringify(filter);
        assert.deepEqual(faceted.urls, plain.urls, `same page: ${label}`);
        assert.strictEqual(
          faceted.meta.page.total,
          rows.length,
          `total: ${label}`,
        );
        for (let field of ['channel', 'speakers']) {
          let got = Object.fromEntries(
            ((faceted.meta as any).facets?.[field] ?? [])
              .map((v: any) => [String(v.value), v.count])
              .sort(),
          );
          assert.deepEqual(got, count(field), `${field} counts: ${label}`);
        }
      }
    });

    test('members the grammar never read change nothing', async function (assert) {
      let filter = { on: Product.ref, range: { price: { gte: 10 } } };
      let sort = [{ on: Product.ref, by: 'price', direction: 'desc' }];
      let plain = await search({ filter, sort, page: { size: 9 } });
      let stray = await search({
        filter: { ...filter, note: 'mine' },
        sort: [{ ...sort[0], note: 'mine' }],
        page: { size: 9, cursor: 'abc', realmVersion: 3 },
      });
      assert.true(plain.urls.length > 0);
      assert.deepEqual(stray.urls, plain.urls);
      assert.strictEqual(stray.meta.page.total, plain.meta.page.total);
    });

    test('a query in the newer spelling returns what its older spelling returns', async function (assert) {
      for (let node of generateNodes(Post, 25, 777)) {
        let old = asFilter(Post, node);
        let strip = (f: Record<string, any>): Record<string, any> => {
          let { on: _on, ...rest } = f;
          for (let key of ['any', 'every']) {
            if (rest[key]) rest[key] = rest[key].map(strip);
          }
          if (rest.not) rest.not = strip(rest.not);
          return rest;
        };
        let sort = [{ by: 'likes', direction: 'desc' }, { by: 'cardURL' }];
        let lowered = lowerQuery({
          type: Post.ref,
          filter: strip(old),
          sort,
          page: everything,
        }).query;
        let newer = await search(lowered);
        let older = await search({
          filter: old,
          sort: [
            { on: Post.ref, by: 'likes', direction: 'desc' },
            { by: 'cardURL' },
          ],
          page: everything,
        });
        assert.deepEqual(newer.urls, older.urls, JSON.stringify(old));
      }
    });
  });
});
