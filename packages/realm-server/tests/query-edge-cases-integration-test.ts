import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  assertQuery,
  backfillFacetValues,
  facetFieldSpecsOf,
  IndexQueryEngine,
  internalKeyFor,
  param,
  query,
  VirtualNetwork,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { lowerQuery } from '@cardstack/runtime-common/query-syntax';

import { setupDB } from './helpers/index.ts';

// The edges of filters, sorts, pages and facets: the cases other search
// engines' suites found worth a test (missing against null against empty,
// negation, boundaries, characters that mean something to SQL, ties, pages
// past the end, values on a bucket boundary), asked of this engine.
//
// Rows are seeded straight into boxel_index. Every expectation is either
// written out by hand beside the rule it follows, or computed here in plain
// JavaScript from the same rows; none is read back from the engine.
//
// Two rules run through the filter cases:
//
// 1. A scalar field follows SQL's three-valued logic. A card with no value
//    for a field is returned by neither `eq: { f: X }` nor its `not`.
//    `eq: { f: null }` is the test for "no value".
// 2. A filter on a list field holds when some element satisfies it, so its
//    `not` returns the cards with no such element, a card with an empty list
//    among them.
//
// A test whose comment says "pins current behavior; rule not yet decided"
// records what the engine does where docs/search.md says nothing.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const realm = 'http://query-edge-cases-test/';
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const booleanRef = ref('@cardstack/base/boolean', 'default');
const cardDefRef = ref('@cardstack/base/card-api', 'CardDef');

type Kind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'strings'
  | 'numbers'
  | { compound: TypeSpec }
  | { link: TypeSpec };
type Doc = Record<string, any>;

interface TypeSpec {
  name: string;
  ref: ResolvedCodeRef;
  kind: 'card-def' | 'field-def';
  fields: Record<string, Kind>;
  rows: Record<string, Doc>;
}

function typeSpec(
  name: string,
  fields: Record<string, Kind>,
  rows: Record<string, Doc> = {},
  kind: TypeSpec['kind'] = 'card-def',
): TypeSpec {
  return {
    name,
    ref: ref(`${realm}${name.toLowerCase()}`, name),
    kind,
    fields,
    rows,
  };
}

// --- fixtures ---------------------------------------------------------------

// The states a field can be in: no key at all, null, an empty string, an
// empty list, a value. `b` and `n` put false and zero beside missing.
const State = typeSpec(
  'State',
  { s: 'string', l: 'strings', n: 'number', b: 'boolean' },
  {
    absent: {},
    nul: { s: null, l: null, n: null, b: null },
    blank: { s: '', l: [''], n: 0, b: false },
    emptyList: { s: 'y', l: [], n: 1, b: true },
    value: { s: 'x', l: ['x'], n: 2, b: true },
  },
);

// A list in every state that holds no value (no key, null, empty, only
// nulls) beside lists that hold one.
const Listed = typeSpec(
  'Listed',
  { l: 'strings' },
  {
    absent: {},
    nul: { l: null },
    emptyList: { l: [] },
    nulls: { l: [null] },
    blank: { l: [''] },
    mixed: { l: ['x', null] },
  },
);

// A compound field and a link, each present, null, absent, or present with
// a null inside.
const Address = typeSpec(
  'Address',
  { city: 'string', zip: 'string' },
  {},
  'field-def',
);
const Owner = typeSpec('Owner', { id: 'string', name: 'string' });
const owner1 = `${realm}Owner/o1`;
const owner2 = `${realm}Owner/o2`;
const Place = typeSpec(
  'Place',
  { address: { compound: Address }, owner: { link: Owner } },
  {
    p1: { address: { city: 'Paris', zip: '75001' }, owner: { id: owner1 } },
    p2: { address: { city: 'Lyon', zip: null }, owner: { id: owner2 } },
    p3: { address: { city: null, zip: '00000' }, owner: null },
    p4: { address: null, owner: { id: owner1 } },
    p5: {},
    p6: { address: { city: 'Paris' }, owner: { id: owner2 } },
  },
);

// The integers 0..20 as a number, as the same digits in a string field, and
// in a list beside a second number; one row with none of them.
const pad = (n: number) => String(n).padStart(2, '0');
const Num = typeSpec(
  'Num',
  { n: 'number', code: 'string', ns: 'numbers' },
  {
    ...Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [
        `n${pad(i)}`,
        { n: i, code: String(i), ns: i % 4 === 0 ? [] : [i, 30 - i] },
      ]),
    ),
    none: {},
  },
);

// Characters that mean something to SQL, LIKE, JSON or a jsonpath, and text
// outside ASCII. `ss` holds the same value in a list.
const LONG = 'L' + 'm'.repeat(4998) + 'Z';
const TEXT_VALUES: Record<string, string> = {
  apostrophe: "it's",
  quote: 'say "hi"',
  bothQuotes: `he said "it's"`,
  backslash: 'back\\slash',
  percent: '100% sure',
  underscore: 'snake_case',
  star: 'a*b',
  question: 'why?',
  newline: 'line one\nline two',
  emoji: 'party 🎉 time',
  accent: 'Crème Brûlée',
  unaccented: 'creme brulee',
  cjk: '東京タワー',
  long: LONG,
  coffee: 'coffee',
  coffeeType: 'coffee type',
  coffeeUpper: 'COFFEE',
  axb: 'axb',
};
const Text = typeSpec(
  'Text',
  { s: 'string', ss: 'strings' },
  {
    ...Object.fromEntries(
      Object.entries(TEXT_VALUES).map(([name, value]) => [
        name,
        { s: value, ss: [value, 'filler'] },
      ]),
    ),
    none: { s: null, ss: [] },
  },
);

// Sort keys with ties and gaps. `a` is missing three times (null twice, no
// key once), `b` and `c` and `name` once each.
const rank = (
  a: number | null | undefined,
  b: string | null,
  c: number | null,
  name: string | null,
): Doc => ({ ...(a === undefined ? {} : { a }), b, c, name });
// prettier-ignore
const Rank = typeSpec(
  'Rank',
  { a: 'number', b: 'string', c: 'number', name: 'string' },
  {
    r01: rank(3,         'x',  5,    'apple'),
    r02: rank(1,         'y',  5,    'Banana'),
    r03: rank(null,      'z',  1,    'cherry'),
    r04: rank(2,         'x',  9,    'banana'),
    r05: rank(3,         'y',  2,    'Éclair'),
    r06: rank(undefined, 'z',  7,    'eclair'),
    r07: rank(1,         'x',  null, 'Zebra'),
    r08: rank(2,         null, 3,    'zebra'),
    r09: rank(3,         'y',  2,    'Ärger'),
    r10: rank(1,         'z',  8,    'apple pie'),
    r11: rank(null,      'x',  4,    'Apple'),
    r12: rank(2,         'y',  3,    null),
  },
);

// What facets count. g01 holds "red" twice, g10 holds 2 twice; g04 and g03
// have an empty list; g07 has a null brand and g08 no keys at all; g11 holds
// empty strings. Prices 10, 20 and 30 sit on the bucket boundaries used below.
const gadget = (
  brand: string | null,
  colors: string[],
  price: number | null,
  sizes: number[],
): Doc => ({ brand, colors, price, sizes });
// prettier-ignore
const Gadget = typeSpec(
  'Gadget',
  { brand: 'string', colors: 'strings', price: 'number', sizes: 'numbers' },
  {
    g01: gadget('acme', ['red', 'red', 'blue'], 10,    [1, 2]),
    g02: gadget('acme', ['red'],                20,    [3]),
    g03: gadget('acme', ['blue', 'green'],      25,    []),
    g04: gadget('bolt', [],                     30,    [10, 2]),
    g05: gadget('bolt', ['green'],              5,     [7]),
    g06: gadget('core', ['red', 'green'],       19.99, [1]),
    g07: gadget(null,   ['blue'],               40,    [4]),
    g08: {},
    g09: gadget('dash', ['red'],                0,     [100]),
    g10: gadget('core', ['Red'],                20,    [2, 2]),
    g11: gadget('',     [''],                   15,    [5]),
  },
);

const CARD_TYPES = [State, Listed, Place, Num, Text, Rank, Gadget];
const ALL_TYPES = [...CARD_TYPES, Address, Owner];

function definitionOf(spec: TypeSpec): Definition {
  let names = Object.keys(spec.fields);
  let fieldDef = (kind: Kind) => {
    if (typeof kind === 'object') {
      return 'compound' in kind
        ? {
            type: 'contains',
            isPrimitive: false,
            isComputed: false,
            fieldOrCard: kind.compound.ref,
            search: { facet: true },
          }
        : {
            type: 'linksTo',
            isPrimitive: false,
            isComputed: false,
            fieldOrCard: kind.link.ref,
            search: { facet: true },
          };
    }
    let list = kind === 'strings' || kind === 'numbers';
    let numeric = kind === 'number' || kind === 'numbers';
    return {
      type: list ? 'containsMany' : 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: numeric
        ? numberRef
        : kind === 'boolean'
          ? booleanRef
          : stringRef,
      ...(numeric
        ? { serializerName: 'number' }
        : kind === 'boolean'
          ? { serializerName: 'boolean' }
          : {}),
      // Every fixture field is a facet: these cases test how a facet
      // counts, not which fields declare one.
      search: { facet: true },
    };
  };
  return {
    type: spec.kind,
    codeRef: spec.ref,
    displayName: spec.name,
    fields: Object.fromEntries(names.map((n, i) => [n, `f${i}`])),
    fieldDefs: Object.fromEntries(
      names.map((n, i) => [`f${i}`, fieldDef(spec.fields[n])]),
    ),
  } as Definition;
}

function makeDefinitionLookup(): DefinitionLookup {
  let definitions = [
    ...ALL_TYPES.map(definitionOf),
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
      let found = definitions.find((d) => {
        let r = d.codeRef as ResolvedCodeRef;
        return r.module === codeRef.module && r.name === codeRef.name;
      });
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

const urlOf = (spec: TypeSpec, name: string) => `${realm}${spec.name}/${name}`;
const nameOf = (spec: TypeSpec, url: string) =>
  url.slice(`${realm}${spec.name}/`.length);
const namesOf = (spec: TypeSpec) => Object.keys(spec.rows).sort();

async function seed(dbAdapter: PgAdapter, vn: VirtualNetwork, spec: TypeSpec) {
  let typeKey = internalKeyFor(spec.ref, undefined, vn);
  for (let [name, doc] of Object.entries(spec.rows)) {
    let url = urlOf(spec, name);
    await query(dbAdapter, [
      `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified) VALUES (`,
      param(url),
      `,`,
      param(url),
      `,`,
      param(realm),
      `,`,
      param(1),
      `,`,
      param('instance'),
      `,`,
      param(JSON.stringify({ id: url, type: 'card' })),
      `::jsonb,`,
      param(JSON.stringify(doc)),
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
      param(1_000),
      `)`,
    ]);
  }
  // The rows went straight into boxel_index, so their facet rows are
  // written from their search docs, as a declaration change does.
  let lookup = makeDefinitionLookup();
  await backfillFacetValues(
    dbAdapter,
    realm,
    typeKey,
    await facetFieldSpecsOf(definitionOf(spec), (r) =>
      lookup.lookupDefinition(r as ResolvedCodeRef),
    ),
  );
}

// --- the plain evaluation ---------------------------------------------------

type Truth = true | false | null;
type FilterNode = Record<string, any>;

// Whether a path runs through a list field of the type.
function isListPath(spec: TypeSpec, path: string): boolean {
  let current = spec;
  for (let segment of path.split('.')) {
    let kind = current.fields[segment];
    if (kind === undefined) {
      throw new Error(`the fixture type ${spec.name} has no "${path}"`);
    }
    if (kind === 'strings' || kind === 'numbers') return true;
    if (typeof kind === 'object') {
      current = 'compound' in kind ? kind.compound : kind.link;
    }
  }
  return false;
}

// The value at a dotted path; undefined when a step on the way is missing.
function read(doc: Doc, path: string): any {
  let value: any = doc;
  for (let segment of path.split('.')) {
    if (value == null || typeof value !== 'object') return undefined;
    value = value[segment];
  }
  return value;
}

const or = (all: Truth[]): Truth =>
  all.includes(true) ? true : all.includes(null) ? null : false;
const and = (all: Truth[]): Truth =>
  all.includes(false) ? false : all.includes(null) ? null : true;

// One operator against one value that may be missing. A comparison with a
// missing value is unknown, as in SQL; `eq null` is the one test that
// answers for it.
function compare(op: string, value: any, operand: any): Truth {
  switch (op) {
    case 'eq':
      if (operand === null) return value == null;
      return value == null ? null : value === operand;
    case 'in':
      return or((operand as any[]).map((o) => compare('eq', value, o)));
    case 'contains':
      return value == null
        ? null
        : String(value).toLowerCase().includes(String(operand).toLowerCase());
    case 'range':
      return value == null
        ? null
        : Object.entries(operand as Record<string, any>).every(([bound, n]) =>
            bound === 'gt'
              ? value > n
              : bound === 'gte'
                ? value >= n
                : bound === 'lt'
                  ? value < n
                  : value <= n,
          );
    default:
      throw new Error(`no plain evaluation for ${op}`);
  }
}

function leaf(
  spec: TypeSpec,
  doc: Doc,
  op: string,
  path: string,
  operand: any,
) {
  let value = read(doc, path);
  if (!isListPath(spec, path)) {
    return compare(op, value, operand);
  }
  if (operand === null) {
    // Whether an empty list is "no value" is not a rule this evaluation
    // knows; the tests of it write their expectation out.
    throw new Error('eq null on a list has no plain evaluation');
  }
  // Rule 2: some element satisfies it. No elements, no match, and never
  // unknown, so `not` returns the card.
  let elements: any[] = Array.isArray(value)
    ? value.filter((v) => v != null)
    : [];
  return elements.some((element) => compare(op, element, operand) === true);
}

function truth(spec: TypeSpec, doc: Doc, node: FilterNode): Truth {
  if ('not' in node) {
    let inner = truth(spec, doc, node.not);
    return inner === null ? null : !inner;
  }
  if ('any' in node) {
    return or(node.any.map((n: FilterNode) => truth(spec, doc, n)));
  }
  if ('every' in node) {
    return and(node.every.map((n: FilterNode) => truth(spec, doc, n)));
  }
  for (let op of ['eq', 'in', 'contains', 'range']) {
    if (op in node) {
      // several paths under one operator all have to hold
      return and(
        Object.entries(node[op]).map(([path, operand]) =>
          leaf(spec, doc, op, path, operand),
        ),
      );
    }
  }
  throw new Error(`no plain evaluation for ${JSON.stringify(node)}`);
}

function holding(spec: TypeSpec, node: FilterNode): string[] {
  return namesOf(spec).filter(
    (name) => truth(spec, spec.rows[name], node) === true,
  );
}

// The same filter as a query saved in a realm writes it: an `on` on every
// node.
function anchored(spec: TypeSpec, node: FilterNode): FilterNode {
  let out: FilterNode = { on: spec.ref };
  for (let [key, value] of Object.entries(node)) {
    out[key] =
      key === 'not'
        ? anchored(spec, value)
        : key === 'any' || key === 'every'
          ? value.map((n: FilterNode) => anchored(spec, n))
          : value;
  }
  return out;
}

interface SortKey {
  by: string;
  direction?: 'asc' | 'desc';
  missing?: 'first' | 'last';
}

// Rows in the order a sort gives: each key in turn, a row with no value for
// a key after the rows that have one whichever way the key runs (before
// them with `missing: 'first'`), and the card's URL last unless the sort
// names it.
function ordered(spec: TypeSpec, names: string[], keys: SortKey[]): string[] {
  let byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...names].sort((x, y) => {
    for (let key of keys) {
      let sign = key.direction === 'desc' ? -1 : 1;
      if (key.by === 'cardURL') {
        let diff = byCodePoint(urlOf(spec, x), urlOf(spec, y));
        if (diff !== 0) return diff * sign;
        continue;
      }
      let a = read(spec.rows[x], key.by);
      let b = read(spec.rows[y], key.by);
      if (a == null && b == null) continue;
      if (a == null || b == null) {
        let missingFirst = key.missing === 'first';
        return (a == null) === missingFirst ? -1 : 1;
      }
      let diff = typeof a === 'number' ? a - b : byCodePoint(a, b);
      if (diff !== 0) return diff * sign;
    }
    return byCodePoint(urlOf(spec, x), urlOf(spec, y));
  });
}

// How many of the rows hold each value at a path: a row counts once for a
// value however often its list repeats it, and a row with no value, null or
// an empty list counts for nothing.
function countValues(
  spec: TypeSpec,
  names: string[],
  path: string,
): Record<string, number> {
  let counts: Record<string, number> = {};
  for (let name of names) {
    let value = read(spec.rows[name], path);
    let values = value == null ? [] : Array.isArray(value) ? value : [value];
    for (let v of new Set(values.filter((x) => x != null).map(String))) {
      counts[v] = (counts[v] ?? 0) + 1;
    }
  }
  return counts;
}

// Most common first; equal counts by value.
function byCountThenValue(counts: Record<string, number>) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([value, count]) => ({ value, count }));
}

// A filter nested `depth` levels deep, a `not`, an `any` and an `every` in
// turn around a range on `n`.
function nested(depth: number): FilterNode {
  let node: FilterNode = { range: { n: { gte: 10 } } };
  for (let i = 0; i < depth; i++) {
    node =
      i % 3 === 0
        ? { not: node }
        : i % 3 === 1
          ? { any: [node, { eq: { n: 3 } }] }
          : { every: [node, { range: { n: { lte: 17 } } }] };
  }
  return node;
}

function depthOf(node: FilterNode): number {
  if ('not' in node) return 1 + depthOf(node.not);
  for (let key of ['any', 'every']) {
    if (key in node) return 1 + Math.max(...node[key].map(depthOf));
  }
  return 0;
}

// A field path as an own key, `__proto__` included (an object literal would
// set the prototype instead).
const keyed = (path: string, value: unknown): Record<string, unknown> =>
  Object.fromEntries([[path, value]]);

type Case = [rule: string, filter: FilterNode, expected: string[]];

module(basename(import.meta.filename), function () {
  module('query edge cases (Postgres integration)', function (hooks) {
    let engine: IndexQueryEngine;

    setupDB(hooks, {
      before: async (dbAdapter) => {
        let vn = new VirtualNetwork();
        engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
        for (let spec of CARD_TYPES) {
          await seed(dbAdapter, vn, spec);
        }
      },
    });

    const everything = { size: 500, total: 'exact' as const };

    async function search(spec: TypeSpec, q: Record<string, any>) {
      let { cards, meta } = await engine.searchCards(
        new URL(realm),
        q as Query,
      );
      return {
        names: cards.map((c) => nameOf(spec, String(c.id))),
        meta: meta as any,
      };
    }

    // The filter in each spelling it has: as saved (an `on` on every node)
    // and in the newer one (a top-level `type`, bare operators). A filter
    // that uses `exists` or `missing` has only the newer.
    function spellings(
      spec: TypeSpec,
      filter: FilterNode,
    ): [string, Record<string, any>][] {
      let newer: [string, Record<string, any>] = [
        'newer spelling',
        lowerQuery({ type: spec.ref, filter, page: everything }).query,
      ];
      let text = JSON.stringify(filter);
      if (text.includes('"exists"') || text.includes('"missing"')) {
        return [newer];
      }
      return [
        ['as saved', { filter: anchored(spec, filter), page: everything }],
        newer,
      ];
    }

    // Each row of a table is one test: the rule, a filter, and the rows it
    // has to return, with the exact total.
    function table(spec: TypeSpec, cases: Case[]) {
      for (let [rule, filter, expected] of cases) {
        test(`${spec.name}: ${rule}`, async function (assert) {
          let want = [...expected].sort();
          for (let [form, q] of spellings(spec, filter)) {
            let { names, meta } = await search(spec, q);
            assert.deepEqual(
              [...names].sort(),
              want,
              `${form}: ${JSON.stringify(filter)}`,
            );
            assert.strictEqual(meta.page.total, want.length, `${form}: total`);
          }
        });
      }
    }

    // A filter against the plain evaluation, in the saved spelling.
    async function agrees(
      assert: Assert,
      spec: TypeSpec,
      filter: FilterNode,
      label = JSON.stringify(filter),
    ) {
      let expected = holding(spec, filter);
      let { names, meta } = await search(spec, {
        filter: anchored(spec, filter),
        page: everything,
      });
      assert.deepEqual([...names].sort(), expected, label);
      assert.strictEqual(meta.page.total, expected.length, `total: ${label}`);
      return expected;
    }

    // What a query was refused with, or that it ran.
    async function outcome(run: () => unknown): Promise<string> {
      try {
        await run();
        return 'ran';
      } catch (e: any) {
        return e?.name === 'InvalidQueryError'
          ? `refused: ${e.code}`
          : `failed: ${e?.name ?? 'Error'}: ${String(e?.message).slice(0, 200)}`;
      }
    }

    // Every card of a type, with a facet-friendly anchor.
    function ofType(spec: TypeSpec, filter?: FilterNode): FilterNode {
      return filter
        ? { every: [{ type: spec.ref }, anchored(spec, filter)] }
        : { type: spec.ref };
    }

    function sortOf(spec: TypeSpec, keys: SortKey[]) {
      return keys.map((key) =>
        key.by === 'cardURL' ? key : { on: spec.ref, ...key },
      );
    }

    // ---- A. filters: missing, null, empty, a value ------------------------

    // prettier-ignore
    table(State, [
      // Rule 1. `eq null` is the test for no value: the key absent, or null.
      ['eq null finds no key and null alike', { eq: { s: null } }, ['absent', 'nul']],
      // An empty string is a value: it is not "no value".
      ['not eq null finds every value, the empty string among them', { not: { eq: { s: null } } }, ['blank', 'emptyList', 'value']],
      ['exists is not eq null', { exists: 's' }, ['blank', 'emptyList', 'value']],
      ['missing is eq null', { missing: 's' }, ['absent', 'nul']],
      ["eq '' finds the empty string only", { eq: { s: '' } }, ['blank']],
      // Rule 1 again: the rows with no value are in neither a test nor its
      // negation.
      ["not eq '' leaves out the cards with no value", { not: { eq: { s: '' } } }, ['emptyList', 'value']],
      ['eq finds the value', { eq: { s: 'x' } }, ['value']],
      ['not eq finds the other values and no card without one', { not: { eq: { s: 'x' } } }, ['blank', 'emptyList']],
      ['in with a null member also finds the cards with no value', { in: { s: ['x', null] } }, ['absent', 'nul', 'value']],
      ['in with only null is eq null', { in: { s: [null] } }, ['absent', 'nul']],
      // NOT (s = 'x' OR s IS NULL): false for 'x', false for no value.
      ['not in with a null member finds the other values only', { not: { in: { s: ['x', null] } } }, ['blank', 'emptyList']],
      ['not in leaves out the cards with no value', { not: { in: { s: ['x'] } } }, ['blank', 'emptyList']],
      // Zero and false are values.
      ['eq 0 finds zero, not a missing number', { eq: { n: 0 } }, ['blank']],
      ['eq null on a number leaves zero out', { eq: { n: null } }, ['absent', 'nul']],
      ['eq false finds false, not a missing boolean', { eq: { b: false } }, ['blank']],
      ['eq true', { eq: { b: true } }, ['emptyList', 'value']],
      ['not eq true finds false only', { not: { eq: { b: true } } }, ['blank']],
      ['eq null on a boolean leaves false out', { eq: { b: null } }, ['absent', 'nul']],
      // A comparison never matches a missing value, so this is not "all".
      [
        'a range that covers every number still skips a missing one',
        { any: [{ range: { n: { gte: 0 } } }, { range: { n: { lte: 0 } } }] },
        ['blank', 'emptyList', 'value'],
      ],
      // A scalar holds one value, so two different ones never both hold.
      ['two values of one scalar under every match nothing', { every: [{ eq: { s: 'x' } }, { eq: { s: 'y' } }] }, []],
      ['two values of one scalar under any match either', { any: [{ eq: { s: 'x' } }, { eq: { s: 'y' } }] }, ['emptyList', 'value']],
      // Double negation gives back the test, not the cards with no value.
      ['not not eq is eq', { not: { not: { eq: { s: 'x' } } } }, ['value']],
    ]);

    // prettier-ignore
    table(State, [
      ['a list: eq finds a card with that element', { eq: { l: 'x' } }, ['value']],
      ["a list: eq '' finds an empty-string element", { eq: { l: '' } }, ['blank']],
      // Rule 2: no element matches in an empty list, a null list, or no list.
      ['a list: not eq finds every card with no such element', { not: { eq: { l: 'x' } } }, ['absent', 'nul', 'blank', 'emptyList']],
      ['a list: in finds a card with one of them', { in: { l: ['x', 'q'] } }, ['value']],
      ['a list: not in finds every card with none of them', { not: { in: { l: ['x', 'q'] } } }, ['absent', 'nul', 'blank', 'emptyList']],
    ]);

    // An empty list is missing: a list has a value when some element holds
    // one, so a list that is empty, null, absent or only nulls is missing,
    // as a facet's `missing: true` counts it, and `exists` (its `not`) is
    // "some element has a value", the empty string among them.
    // prettier-ignore
    table(State, [
      ['a list: eq null finds an empty, a null and an absent list', { eq: { l: null } }, ['absent', 'nul', 'emptyList']],
      ['a list: missing finds an empty, a null and an absent list', { missing: 'l' }, ['absent', 'nul', 'emptyList']],
      ['a list: exists finds the lists with an element', { exists: 'l' }, ['blank', 'value']],
      ['a list: not eq null is exists', { not: { eq: { l: null } } }, ['blank', 'value']],
    ]);

    // prettier-ignore
    table(Listed, [
      ['a list of only nulls is missing', { missing: 'l' }, ['absent', 'nul', 'emptyList', 'nulls']],
      ['a list with one value beside a null exists', { exists: 'l' }, ['blank', 'mixed']],
      ['in with a null member finds the missing lists and the matching ones', { in: { l: ['x', null] } }, ['absent', 'nul', 'emptyList', 'nulls', 'mixed']],
      ['contains null is eq null on a list', { contains: { l: null } }, ['absent', 'nul', 'emptyList', 'nulls']],
      ['every [exists, missing] matches nothing', { every: [{ exists: 'l' }, { missing: 'l' }] }, []],
      ['any [exists, missing] matches every card', { any: [{ exists: 'l' }, { missing: 'l' }] }, ['absent', 'nul', 'emptyList', 'nulls', 'blank', 'mixed']],
    ]);

    // ---- A. negation through a compound field and a link -------------------

    // prettier-ignore
    table(Place, [
      ['a nested path: eq', { eq: { 'address.city': 'Paris' } }, ['p1', 'p6']],
      // p3 has a null city, p4 a null address, p5 no address: no value, so
      // none is in the negation (rule 1).
      ['a nested path: not eq leaves out a null leaf, a null parent and no parent', { not: { eq: { 'address.city': 'Paris' } } }, ['p2']],
      ['a nested path: eq null finds a null leaf, a null parent and no parent', { eq: { 'address.city': null } }, ['p3', 'p4', 'p5']],
      ['a nested path: not eq null', { not: { eq: { 'address.city': null } } }, ['p1', 'p2', 'p6']],
      ['a nested path: a leaf missing from a present parent has no value', { eq: { 'address.zip': null } }, ['p2', 'p4', 'p5', 'p6']],
      ['a nested path: in with a null member', { in: { 'address.city': ['Lyon', null] } }, ['p2', 'p3', 'p4', 'p5']],
      ['a nested path: contains', { contains: { 'address.city': 'AR' } }, ['p1', 'p6']],
      ['a nested path: not contains leaves out the cards with no value', { not: { contains: { 'address.city': 'AR' } } }, ['p2']],
      ['a nested path: exists', { exists: 'address.city' }, ['p1', 'p2', 'p6']],
      ["a link's id: eq", { eq: { 'owner.id': owner1 } }, ['p1', 'p4']],
      // p3 links to nothing and p5 has no link key: no value.
      ["a link's id: not eq leaves out the cards that link to nothing", { not: { eq: { 'owner.id': owner1 } } }, ['p2', 'p6']],
      ["a link's id: eq null finds the cards that link to nothing", { eq: { 'owner.id': null } }, ['p3', 'p5']],
      ["a link's id: not eq null", { not: { eq: { 'owner.id': null } } }, ['p1', 'p2', 'p4', 'p6']],
      ["a link's id: in", { in: { 'owner.id': [owner1, owner2] } }, ['p1', 'p2', 'p4', 'p6']],
      ["a link's id: not in leaves out the cards that link to nothing", { not: { in: { 'owner.id': [owner1] } } }, ['p2', 'p6']],
    ]);

    // ---- A. ranges ---------------------------------------------------------

    test('range: every bound at every integer returns the rows a plain comparison picks', async function (assert) {
      for (let i = 0; i <= 20; i++) {
        for (let bound of ['gt', 'gte', 'lt', 'lte']) {
          await agrees(assert, Num, { range: { n: keyed(bound, i) } });
        }
        await agrees(assert, Num, { eq: { n: i } });
      }
    });

    test('range: two bounds are both applied, inclusive or exclusive as written', async function (assert) {
      for (let low = 0; low <= 20; low += 3) {
        for (let high = low; high <= 20; high += 4) {
          for (let [lower, upper] of [
            ['gte', 'lte'],
            ['gt', 'lt'],
            ['gte', 'lt'],
            ['gt', 'lte'],
          ]) {
            await agrees(assert, Num, {
              range: { n: { ...keyed(lower, low), ...keyed(upper, high) } },
            });
          }
        }
      }
    });

    // prettier-ignore
    table(Num, [
      ['range: bounds that cross match nothing', { range: { n: { gt: 10, lt: 5 } } }, []],
      ['range: equal inclusive bounds match that number', { range: { n: { gte: 7, lte: 7 } } }, ['n07']],
      ['range: equal exclusive bounds match nothing', { range: { n: { gt: 7, lt: 7 } } }, []],
      ['range: an equal bound excluded on one side matches nothing', { range: { n: { gte: 7, lt: 7 } } }, []],
      // The row with no n is not below, above or equal to anything.
      [
        'range: a missing number is on neither side of a bound',
        { any: [{ range: { n: { lt: 10 } } }, { range: { n: { gte: 10 } } }] },
        namesOf(Num).filter((name) => name !== 'none'),
      ],
      [
        'range: not range leaves out a missing number',
        { not: { range: { n: { lt: 10 } } } },
        ['n10', 'n11', 'n12', 'n13', 'n14', 'n15', 'n16', 'n17', 'n18', 'n19', 'n20'],
      ],
      // 9 < 10 as numbers, though "9" > "10" as text.
      ['numbers compare as numbers', { range: { n: { gt: 9, lt: 11 } } }, ['n10']],
      // The same digits in a string field compare as text: "10".."19" and
      // "2" and "20" start with a character below "3"; "0" and "1" do too.
      [
        'a numeric string in a string field compares as text',
        { range: { code: { lt: '3' } } },
        ['n00', 'n01', 'n02', 'n10', 'n11', 'n12', 'n13', 'n14', 'n15', 'n16', 'n17', 'n18', 'n19', 'n20'],
      ],
      ['a numeric string equals its own text', { eq: { code: '10' } }, ['n10']],
    ]);

    test('range on a list of numbers compares each element as a number', async function (assert) {
      for (let i = 0; i <= 30; i += 3) {
        for (let bound of ['gt', 'gte', 'lt', 'lte']) {
          await agrees(assert, Num, { range: { ns: keyed(bound, i) } });
          await agrees(assert, Num, {
            not: { range: { ns: keyed(bound, i) } },
          });
        }
      }
      // n09 holds [9, 21]: 9 is below 10 as a number, and no text comparison
      // of "9" with "10" would say so.
      let below = await agrees(assert, Num, { range: { ns: { lt: 10 } } });
      assert.true(below.includes('n09'), '9 is less than 10 inside a list');
      assert.false(below.includes('n10'), '10 is not');
    });

    test('range on a list: both bounds have to hold for one element', async function (assert) {
      // n05 holds [5, 25]: one element meets each bound, none meets both.
      let between = await agrees(assert, Num, {
        range: { ns: { gte: 10, lte: 20 } },
      });
      assert.false(
        between.includes('n05'),
        'no element of [5, 25] is in 10..20',
      );
      assert.true(between.includes('n11'), '11 of [11, 19] is');
      let each = await agrees(assert, Num, {
        every: [{ range: { ns: { gte: 10 } } }, { range: { ns: { lte: 20 } } }],
      });
      assert.true(
        each.includes('n05'),
        'two tests are met by different elements',
      );
    });

    // ---- A. in -------------------------------------------------------------

    // prettier-ignore
    table(State, [
      ['in with an empty list matches nothing', { in: { s: [] } }, []],
      ['in with an empty list on a list field matches nothing', { in: { l: [] } }, []],
      // NOT false is true for every card, whatever the field holds.
      ['not in with an empty list matches every card', { not: { in: { s: [] } } }, ['absent', 'nul', 'blank', 'emptyList', 'value']],
      ['in with one value is eq', { in: { s: ['x'] } }, ['value']],
      ['in with a value repeated is in with it once', { in: { s: ['x', 'x', 'x'] } }, ['value']],
      ['in with members that match nothing finds the rest', { in: { s: ['nope', 'x', 'never'] } }, ['value']],
      ['in on a number field', { in: { n: [0, 2, 99] } }, ['blank', 'value']],
    ]);

    test('in with 2,000 values finds the rows holding one of them', async function (assert) {
      let strings = Array.from({ length: 1999 }, (_, i) => `filler-${i}`);
      await agrees(assert, State, { in: { s: [...strings, 'x'] } }, 'strings');
      await agrees(assert, State, { in: { l: [...strings, 'x'] } }, 'a list');
      let numbers = Array.from({ length: 1999 }, (_, i) => 100 + i);
      await agrees(assert, Num, { in: { n: [...numbers, 7] } }, 'numbers');
      await agrees(
        assert,
        Num,
        { not: { in: { n: [...numbers, 7] } } },
        'not in numbers',
      );
    });

    test('any with 2,000 branches finds the rows a branch matches', async function (assert) {
      let branches = Array.from({ length: 1999 }, (_, i) => ({
        eq: { s: `filler-${i}` },
      }));
      await agrees(
        assert,
        State,
        { any: [...branches, { eq: { s: 'x' } }] },
        '2,000 eq branches',
      );
    });

    // pins current behavior; rule not yet decided: docs/search.md does not say
    // what a member of another type than the field's does. Read as "a value
    // the field cannot hold matches nothing", a number finds no text.
    // prettier-ignore
    table(State, [
      ['a number against a string field matches nothing (pinned, undecided)', { eq: { s: 5 } }, []],
      ['in on a string field with a number among the strings (pinned, undecided)', { in: { s: ['x', 5] } }, ['value']],
    ]);

    // docs/search.md does not say whether a word where a number belongs
    // matches nothing or is refused (`invalid-value`: "a member has the wrong
    // kind of value"). Either is an answer; an error from the database is not.
    test('a word against a number field is answered or refused, never a database error', async function (assert) {
      for (let filter of [
        { eq: { n: 'red' } },
        { in: { n: [2, 'red'] } },
        { not: { eq: { n: 'red' } } },
        { range: { n: { gt: 'red' } } },
        { eq: { ns: 'red' } },
      ] as FilterNode[]) {
        let spec = 'ns' in Object.values(filter)[0] ? Num : State;
        let result = await outcome(() =>
          search(spec, { filter: anchored(spec, filter), page: everything }),
        );
        assert.true(
          ['ran', 'refused: invalid-value'].includes(result),
          `${JSON.stringify(filter)}: ${result}`,
        );
      }
    });

    // pins current behavior; rule not yet decided: whether a number written
    // as a string equals the number, and the reverse.
    // prettier-ignore
    table(Num, [
      ['a number as a string against a number field (pinned, undecided)', { eq: { n: '10' } }, ['n10']],
      ['a number against a string field of digits (pinned, undecided)', { eq: { code: 10 } }, ['n10']],
    ]);

    // ---- A. empty every and any ---------------------------------------------

    // pins current behavior; rule not yet decided: docs/search.md does not
    // say whether an empty `every` or `any` is refused or what it matches.
    // The identities are: every [] holds for every card, any [] for none.
    // prettier-ignore
    table(State, [
      ['every [] matches every card (pinned, undecided)', { every: [] }, ['absent', 'nul', 'blank', 'emptyList', 'value']],
      ['any [] matches no card (pinned, undecided)', { any: [] }, []],
    ]);

    // ---- A. characters in values -------------------------------------------

    for (let [name, value] of Object.entries(TEXT_VALUES)) {
      test(`a value is data, whatever it holds: ${name}`, async function (assert) {
        // No other row holds this exact text, so each finds one row.
        let label = (op: string) =>
          `${op} ${JSON.stringify(value).slice(0, 40)}`;
        for (let filter of [
          { eq: { s: value } },
          { in: { s: [value] } },
          { in: { s: ['not there', value] } },
          { eq: { ss: value } },
          { in: { ss: [value] } },
        ]) {
          let expected = await agrees(
            assert,
            Text,
            filter,
            label(Object.keys(filter)[0]),
          );
          assert.deepEqual(expected, [name], 'the plain evaluation picks it');
        }
        // Every other row that has a value, and not the row with none.
        let others = await agrees(
          assert,
          Text,
          { not: { eq: { s: value } } },
          label('not eq'),
        );
        assert.strictEqual(others.length, Object.keys(TEXT_VALUES).length - 1);
        // In a list, the row with an empty list has no such element either.
        await agrees(
          assert,
          Text,
          { not: { eq: { ss: value } } },
          label('not eq, list'),
        );
        // The value contains itself.
        let containing = await agrees(
          assert,
          Text,
          { contains: { s: value } },
          label('contains'),
        );
        assert.true(containing.includes(name));
      });
    }

    // `contains` is a substring test. `%`, `_` and `\` mean something to SQL's
    // LIKE, and `*` and `?` to a glob; here they are characters.
    for (let needle of [
      "'",
      '"',
      '\\',
      '%',
      '_',
      '*',
      '?',
      '\n',
      '🎉',
      '東京',
      '% sure',
      'e_c',
      'a_b',
      'a%b',
      'a?b',
      'k\\s',
      'mmmZ',
      'Lmmm',
      ' ',
    ]) {
      test(`contains ${JSON.stringify(needle)} finds the values holding those characters and no others`, async function (assert) {
        await agrees(assert, Text, { contains: { s: needle } });
        await agrees(assert, Text, { not: { contains: { s: needle } } });
      });
    }

    // prettier-ignore
    table(Text, [
      // The whole value, not a word of it.
      ['eq is the whole value', { eq: { s: 'coffee' } }, ['coffee']],
      ['contains is a substring, mid-word too', { contains: { s: 'offe' } }, ['coffee', 'coffeeType', 'coffeeUpper']],
      // docs/search.md does not state the case rule of `contains` on a card
      // field; it says a log's `contains` and a `pattern` ignore case, and
      // query-invariants-integration-test.ts has always evaluated `contains`
      // ignoring case.
      ['contains ignores case', { contains: { s: 'CoFfEe' } }, ['coffee', 'coffeeType', 'coffeeUpper']],
      ['contains with a space', { contains: { s: 'ee t' } }, ['coffeeType']],
    ]);

    // pins current behavior; rule not yet decided: docs/search.md does not
    // say whether `eq` on text ignores case or accents, or whether `contains`
    // folds accents ("accents fold everywhere words are matched" is about
    // word matching).
    // prettier-ignore
    table(Text, [
      ['eq is case-sensitive (pinned, undecided)', { eq: { s: 'Coffee' } }, []],
      ['eq upper case finds only the upper-case value (pinned, undecided)', { eq: { s: 'COFFEE' } }, ['coffeeUpper']],
      ['eq does not fold accents (pinned, undecided)', { eq: { s: 'creme brulee' } }, ['unaccented']],
      ['contains does not fold accents (pinned, undecided)', { contains: { s: 'creme' } }, ['unaccented']],
      ['contains ignores case outside ASCII (pinned, undecided)', { contains: { s: 'CRÈME' } }, ['accent']],
    ]);

    // ---- A. deep nesting ----------------------------------------------------

    test('a filter nested 30 levels deep returns the rows a plain evaluation picks', async function (assert) {
      let filter = nested(30);
      assert.strictEqual(depthOf(filter), 30, 'thirty levels');
      assert.strictEqual(
        await outcome(() => assertQuery({ filter: anchored(Num, filter) })),
        'ran',
        'the grammar accepts it',
      );
      let expected = await agrees(assert, Num, filter, '30 levels');
      assert.notStrictEqual(expected.length, 0, 'some rows match');
      assert.notStrictEqual(
        expected.length,
        namesOf(Num).length,
        'some do not',
      );
      for (let depth of [1, 2, 3, 7, 12, 29]) {
        await agrees(assert, Num, nested(depth), `${depth} levels`);
      }
    });

    // pins current behavior; rule not yet decided: docs/search.md documents
    // no depth limit for a filter (`invalid-nesting` and `limit-exceeded`
    // name other things), so there is no refusal to assert. A filter 200
    // levels deep is answered like any other.
    test('a filter nested 200 levels deep is answered, not refused (pinned, undecided)', async function (assert) {
      let filter = nested(200);
      assert.strictEqual(depthOf(filter), 200);
      assert.strictEqual(
        await outcome(() => assertQuery({ filter: anchored(Num, filter) })),
        'ran',
        'the grammar accepts it',
      );
      let expected = await agrees(assert, Num, filter, '200 levels');
      assert.notStrictEqual(expected.length, 0, 'some rows match');
    });

    // ---- B. sort ------------------------------------------------------------

    async function sorted(spec: TypeSpec, keys: SortKey[]) {
      let saved = await search(spec, {
        filter: { type: spec.ref },
        sort: sortOf(spec, keys),
        page: everything,
      });
      let newer = await search(
        spec,
        lowerQuery({ type: spec.ref, sort: keys, page: everything }).query,
      );
      return { saved: saved.names, newer: newer.names };
    }

    // docs/search.md: on a field sort the cards with no value "go last by
    // default", and `missing: 'first'` puts them first. Neither says "when
    // ascending", so both hold in both directions.
    for (let keys of [
      [{ by: 'a', direction: 'asc' }, { by: 'cardURL' }],
      [{ by: 'a', direction: 'desc' }, { by: 'cardURL' }],
      [{ by: 'a', direction: 'asc', missing: 'first' }, { by: 'cardURL' }],
      [{ by: 'a', direction: 'desc', missing: 'first' }, { by: 'cardURL' }],
      [{ by: 'a', direction: 'desc', missing: 'last' }, { by: 'cardURL' }],
      [{ by: 'a' }, { by: 'cardURL' }],
      [{ by: 'c', direction: 'desc' }, { by: 'cardURL' }],
    ] as SortKey[][]) {
      let { direction = 'asc (by default)', missing = 'last (by default)' } =
        keys[0];
      test(`sort by ${keys[0].by} ${direction}: cards with no value come ${missing}`, async function (assert) {
        let expected = ordered(Rank, namesOf(Rank), keys);
        let without = namesOf(Rank).filter(
          (name) => Rank.rows[name][keys[0].by] == null,
        );
        assert.true(without.length > 0, 'the fixture has rows with no value');
        let edge =
          keys[0].missing === 'first'
            ? expected.slice(0, without.length)
            : expected.slice(-without.length);
        assert.deepEqual(
          [...edge].sort(),
          without,
          'the plain order puts them there',
        );
        let { saved, newer } = await sorted(Rank, keys);
        assert.deepEqual(saved, expected, 'as saved');
        assert.deepEqual(newer, expected, 'newer spelling');
      });
    }

    test('a three-key sort with mixed directions: each key only breaks the ties of the one before', async function (assert) {
      let keys: SortKey[] = [
        { by: 'a', direction: 'desc' },
        { by: 'b', direction: 'asc' },
        { by: 'c', direction: 'desc' },
        { by: 'cardURL' },
      ];
      let expected = ordered(Rank, namesOf(Rank), keys);
      // Written out, to check the comparator: a 3 first (b x, then the two
      // y rows tied on c 2, by URL), a 2 (x, y, then no b), a 1 (x, y, z),
      // then no a (x, then z with c 7 before c 1).
      assert.deepEqual(expected, [
        'r01',
        'r05',
        'r09',
        'r04',
        'r12',
        'r08',
        'r07',
        'r02',
        'r10',
        'r11',
        'r06',
        'r03',
      ]);
      let { saved, newer } = await sorted(Rank, keys);
      assert.deepEqual(saved, expected, 'as saved');
      assert.deepEqual(newer, expected, 'newer spelling');
    });

    test('ties are broken by a final cardURL key, in the direction it names', async function (assert) {
      for (let direction of ['asc', 'desc'] as const) {
        let keys: SortKey[] = [{ by: 'b' }, { by: 'cardURL', direction }];
        let expected = ordered(Rank, namesOf(Rank), keys);
        let { saved, newer } = await sorted(Rank, keys);
        assert.deepEqual(saved, expected, `cardURL ${direction}, as saved`);
        assert.deepEqual(
          newer,
          expected,
          `cardURL ${direction}, newer spelling`,
        );
      }
      // b is x for r01, r04, r07 and r11.
      let { saved } = await sorted(Rank, [
        { by: 'b' },
        { by: 'cardURL', direction: 'desc' },
      ]);
      assert.deepEqual(saved.slice(0, 4), ['r11', 'r07', 'r04', 'r01']);
    });

    // pins current behavior; rule not yet decided: docs/search.md does not
    // say what orders rows a sort leaves tied. Today it is the card's URL,
    // ascending.
    test('rows a sort leaves tied come back in URL order (pinned, undecided)', async function (assert) {
      for (let keys of [
        [{ by: 'b' }],
        [{ by: 'b', direction: 'desc' }],
        [{ by: 'a', direction: 'desc' }, { by: 'b' }],
      ] as SortKey[][]) {
        let expected = ordered(Rank, namesOf(Rank), keys);
        let { saved, newer } = await sorted(Rank, keys);
        assert.deepEqual(saved, expected, `${JSON.stringify(keys)}, as saved`);
        assert.deepEqual(newer, expected, `${JSON.stringify(keys)}, newer`);
      }
      let unsorted = await search(Rank, {
        filter: { type: Rank.ref },
        page: everything,
      });
      assert.deepEqual(unsorted.names, namesOf(Rank), 'no sort at all');
    });

    test('a sort never drops a row, whatever its keys hold', async function (assert) {
      let cases: [TypeSpec, SortKey[]][] = [
        [Rank, [{ by: 'a' }]],
        [Rank, [{ by: 'a', direction: 'desc' }]],
        [Rank, [{ by: 'b', direction: 'desc' }, { by: 'c' }]],
        [Rank, [{ by: 'name' }]],
        [Rank, [{ by: 'name', direction: 'desc', missing: 'first' }]],
        [Place, [{ by: 'address.city' }]],
        [Place, [{ by: 'address.zip', direction: 'desc' }]],
        [State, [{ by: 's' }, { by: 'n', direction: 'desc' }]],
        [State, [{ by: 'b' }]],
        [Num, [{ by: 'n', direction: 'desc' }]],
        [Num, [{ by: 'code' }]],
      ];
      for (let [spec, keys] of cases) {
        let { saved, newer } = await sorted(spec, keys);
        let label = `${spec.name} ${JSON.stringify(keys)}`;
        assert.deepEqual(
          [...saved].sort(),
          namesOf(spec),
          `as saved: ${label}`,
        );
        assert.deepEqual([...newer].sort(), namesOf(spec), `newer: ${label}`);
      }
    });

    test('a number sorts as a number and the same digits in a string field as text', async function (assert) {
      let numeric = await sorted(Num, [{ by: 'n' }, { by: 'cardURL' }]);
      // 0, 1, 2 … 20, then the row with no n.
      assert.deepEqual(numeric.saved, [
        ...Array.from({ length: 21 }, (_, i) => `n${pad(i)}`),
        'none',
      ]);
      let descending = await sorted(Num, [
        { by: 'n', direction: 'desc' },
        { by: 'cardURL' },
      ]);
      assert.deepEqual(
        descending.saved.slice(0, 3),
        ['n20', 'n19', 'n18'],
        '20 is the largest, not 9',
      );
      // "0", "1", "10", "11" … "19", "2", "20", "3" … "9": digits order the
      // same way under every collation.
      let textual = await sorted(Num, [{ by: 'code' }, { by: 'cardURL' }]);
      assert.deepEqual(
        textual.saved,
        ordered(Num, namesOf(Num), [{ by: 'code' }, { by: 'cardURL' }]),
      );
      assert.deepEqual(textual.saved.slice(0, 4), ['n00', 'n01', 'n10', 'n11']);
    });

    test('a sort through a compound field orders by the nested value, cards without one last', async function (assert) {
      let keys: SortKey[] = [{ by: 'address.city' }, { by: 'cardURL' }];
      // Lyon, Paris, Paris, then a null city, a null address and no address.
      let { saved, newer } = await sorted(Place, keys);
      assert.deepEqual(saved, ['p2', 'p1', 'p6', 'p3', 'p4', 'p5'], 'as saved');
      assert.deepEqual(newer, saved, 'newer spelling');
    });

    // pins current behavior; rule not yet decided: docs/search.md does not
    // say how text is collated. This asserts what holds under any collation
    // (plain lower-case words in alphabetical order, the card with no name
    // last, no row dropped), then the order seen today: the database's
    // language collation, which JavaScript's English collator also gives
    // (apple, Apple, apple pie, Ärger, banana, Banana … eclair, Éclair), not
    // code point order (every capital first, accented letters last).
    test('a sort on text with mixed case and accents (pinned, undecided)', async function (assert) {
      let { saved, newer } = await sorted(Rank, [
        { by: 'name' },
        { by: 'cardURL' },
      ]);
      assert.deepEqual(newer, saved, 'both spellings agree');
      assert.strictEqual(saved.length, 12, 'no row dropped');
      assert.strictEqual(saved[11], 'r12', 'the card with no name is last');
      // apple < banana < cherry < eclair < zebra, all lower case, no accents
      let plain = ['r01', 'r04', 'r03', 'r06', 'r08'];
      assert.deepEqual(
        saved.filter((name) => plain.includes(name)),
        plain,
        'lower-case words are in alphabetical order',
      );
      let english = new Intl.Collator('en');
      let named = namesOf(Rank).filter((name) => Rank.rows[name].name != null);
      assert.deepEqual(
        saved.slice(0, 11).map((name) => Rank.rows[name].name),
        named
          .map((name) => Rank.rows[name].name as string)
          .sort(english.compare),
        'the order of an English collation',
      );
    });

    // ---- C. pagination ------------------------------------------------------

    test('pages laid end to end under a tie-heavy sort hold every row once', async function (assert) {
      // b has three values and one gap over twelve rows.
      for (let sort of [
        sortOf(Rank, [{ by: 'b' }]),
        sortOf(Rank, [{ by: 'b', direction: 'desc' }]),
        sortOf(Rank, [{ by: 'a', direction: 'desc', missing: 'first' }]),
        undefined,
      ]) {
        for (let size of [1, 5, 7, 12, 13]) {
          let base = { filter: { type: Rank.ref }, ...(sort ? { sort } : {}) };
          let whole = await search(Rank, { ...base, page: everything });
          let laid: string[] = [];
          for (let number = 0; number < 20; number++) {
            let page = await search(Rank, {
              ...base,
              page: { number, size, total: 'exact' },
            });
            assert.true(
              page.names.length <= size,
              'a page holds at most its size',
            );
            assert.strictEqual(
              page.meta.page.total,
              12,
              'the same total on every page',
            );
            assert.strictEqual(
              page.meta.page.hasMore,
              (number + 1) * size < 12,
              `hasMore on page ${number} of size ${size}`,
            );
            laid.push(...page.names);
            if (page.names.length === 0) break;
          }
          let label = `size ${size}, ${JSON.stringify(sort)}`;
          assert.deepEqual(
            laid,
            whole.names,
            `pages are the whole list: ${label}`,
          );
          assert.deepEqual(
            [...laid].sort(),
            namesOf(Rank),
            `every row once: ${label}`,
          );
        }
      }
    });

    test('a page past the end is empty and keeps the total', async function (assert) {
      let filter = anchored(Rank, { range: { a: { gte: 2 } } });
      // a is 2 or 3 for r01, r04, r05, r08, r09 and r12.
      for (let total of ['exact', 'capped'] as const) {
        for (let number of [2, 3, 99]) {
          let page = await search(Rank, {
            filter,
            page: { number, size: 3, total },
          });
          assert.deepEqual(page.names, [], `page ${number} holds no rows`);
          assert.strictEqual(
            page.meta.page.total,
            6,
            `page ${number}, total ${total}`,
          );
          assert.false(page.meta.page.hasMore, 'nothing follows');
        }
      }
    });

    test('a page of size 0 returns no rows and still counts and facets', async function (assert) {
      let filter = ofType(Gadget, { range: { price: { gte: 10 } } });
      let matching = holding(Gadget, { range: { price: { gte: 10 } } });
      let page = await search(Gadget, {
        filter,
        facets: [{ by: 'brand' }],
        page: { size: 0, total: 'exact' },
      });
      assert.deepEqual(page.names, [], 'no rows');
      assert.strictEqual(page.meta.page.total, matching.length, 'the count');
      assert.deepEqual(
        Object.fromEntries(
          page.meta.facets.brand.map((f: any) => [f.value, f.count]),
        ),
        countValues(Gadget, matching, 'brand'),
        'the facet',
      );
    });

    test('how the total is counted never changes the rows', async function (assert) {
      let filters: [TypeSpec, FilterNode][] = [
        [Rank, { range: { a: { gte: 2 } } }],
        [Rank, { not: { eq: { b: 'x' } } }],
        [Num, { range: { n: { gt: 3, lte: 15 } } }],
        [Num, nested(30)],
        [State, { eq: { s: null } }],
        [Text, { contains: { s: 'coffee' } }],
        [Place, { not: { eq: { 'owner.id': owner1 } } }],
        [State, { in: { s: [] } }],
      ];
      for (let [spec, filter] of filters) {
        let expected = holding(spec, filter);
        for (let size of [1, 4, 100]) {
          let pages = [];
          for (let total of ['none', 'capped', 'exact'] as const) {
            pages.push(
              await search(spec, {
                filter: anchored(spec, filter),
                page: { size, total },
              }),
            );
          }
          let [none, capped, exact] = pages;
          let label = `${spec.name} size ${size} ${JSON.stringify(filter).slice(0, 80)}`;
          assert.deepEqual(
            exact.names,
            expected.slice(0, size),
            `exact rows: ${label}`,
          );
          assert.deepEqual(capped.names, exact.names, `capped rows: ${label}`);
          assert.deepEqual(none.names, exact.names, `uncounted rows: ${label}`);
          assert.strictEqual(
            exact.meta.page.total,
            expected.length,
            `exact: ${label}`,
          );
          assert.strictEqual(
            capped.meta.page.total,
            expected.length,
            `capped: ${label}`,
          );
          assert.true(
            (none.meta.page.total ?? 0) <= expected.length,
            `an uncounted total is never more than the matches: ${label}`,
          );
          for (let page of pages) {
            assert.strictEqual(
              page.meta.page.hasMore,
              expected.length > size,
              `hasMore: ${label}`,
            );
          }
        }
      }
    });

    // ---- D. facets ----------------------------------------------------------

    async function faceted(
      filter: FilterNode | undefined,
      facets: Record<string, any>[],
      page: Record<string, any> = everything,
    ) {
      let { names, meta } = await search(Gadget, {
        filter: ofType(Gadget, filter),
        facets,
        page,
      });
      let counts = (by: string): { value: string; count: number }[] =>
        (meta.facets?.[by] ?? []).map((f: any) => ({
          value: f.value,
          count: f.count,
        }));
      let asMap = (by: string) =>
        Object.fromEntries(counts(by).map((f) => [f.value, f.count]));
      return { names, meta, counts, asMap, stats: meta.facetStats ?? {} };
    }

    test('facets count the rows the filter keeps, not the page', async function (assert) {
      let filters: (FilterNode | undefined)[] = [
        undefined,
        { range: { price: { gte: 20 } } },
        { eq: { brand: 'acme' } },
        { not: { eq: { colors: 'red' } } },
        { eq: { brand: null } },
        { in: { brand: [] } },
      ];
      for (let filter of filters) {
        let rows = filter ? holding(Gadget, filter) : namesOf(Gadget);
        for (let page of [
          everything,
          { size: 1, total: 'exact' },
          { size: 0, total: 'exact' },
        ]) {
          let got = await faceted(
            filter,
            // A number facet counts values when the query says `stats`;
            // alone it is range buckets.
            [{ by: 'brand' }, { by: 'colors' }, { by: 'sizes', stats: true }],
            page,
          );
          let label = `${JSON.stringify(filter)} page ${JSON.stringify(page)}`;
          assert.strictEqual(
            got.meta.page.total,
            rows.length,
            `total: ${label}`,
          );
          for (let by of ['brand', 'colors', 'sizes']) {
            assert.deepEqual(
              got.asMap(by),
              countValues(Gadget, rows, by),
              `${by}: ${label}`,
            );
          }
        }
      }
    });

    test('a card holding a value several times in one list counts once for it', async function (assert) {
      let got = await faceted(undefined, [
        { by: 'colors' },
        { by: 'sizes', stats: true },
      ]);
      // red: g01 (twice in its list), g02, g06, g09. "Red" is another value.
      assert.strictEqual(got.asMap('colors').red, 4, 'red');
      // 2: g01, g04, g10 (twice in its list).
      assert.strictEqual(got.asMap('sizes')['2'], 3, 'size 2');
    });

    test('a card with an empty list, null or no value adds nothing to a facet', async function (assert) {
      let got = await faceted(undefined, [{ by: 'brand' }, { by: 'colors' }]);
      // g07 has a null brand and g08 none: nine brands counted over eleven rows.
      let brandTotal = Object.values(got.asMap('brand')).reduce(
        (a: number, b) => a + (b as number),
        0,
      );
      assert.strictEqual(brandTotal, 9, 'nine cards have a brand');
      for (let by of ['brand', 'colors']) {
        for (let value of got.counts(by).map((f) => f.value)) {
          assert.false(
            ['null', 'undefined', '[]'].includes(value),
            `${by} has no "${value}" value`,
          );
          assert.strictEqual(typeof value, 'string');
        }
      }
    });

    test('missing: true counts the matches with no value', async function (assert) {
      let got = await faceted(undefined, [
        { by: 'brand', missing: true },
        { by: 'colors', missing: true },
        { by: 'price', missing: true },
      ]);
      // brand: g07 (null) and g08 (no key).
      assert.strictEqual(got.stats.brand?.missing, 2, 'brand');
      // colors: g04 (an empty list) and g08 (no key): a card with an empty
      // list holds no value.
      assert.strictEqual(got.stats.colors?.missing, 2, 'colors');
      // price: g08 only; a price of 0 (g09) is a value.
      assert.strictEqual(got.stats.price?.missing, 1, 'price');
      let filtered = await faceted({ eq: { brand: 'bolt' } }, [
        { by: 'colors', missing: true },
      ]);
      // of the bolt cards, g04 has no color
      assert.strictEqual(filtered.stats.colors?.missing, 1, 'under a filter');
    });

    // pins current behavior; rule not yet decided: docs/search.md does not
    // say whether an empty string is a facet value. Today it is one, with a
    // count, and it is not counted as missing.
    test('an empty string is a facet value of its own (pinned, undecided)', async function (assert) {
      let got = await faceted(undefined, [{ by: 'brand', missing: true }]);
      assert.strictEqual(got.asMap('brand')[''], 1);
    });

    test("own: 'ignore' counts a facet without its own selection, and the others with it", async function (assert) {
      let price = { range: { price: { gte: 10 } } };
      let brand = { in: { brand: ['acme'] } };
      let got = await faceted({ every: [price, brand] }, [
        { by: 'brand', own: 'ignore' },
        { by: 'colors' },
        { by: 'brand' },
      ]);
      let selected = holding(Gadget, { every: [price, brand] });
      assert.deepEqual(
        [...got.names].sort(),
        selected,
        'the rows keep the selection',
      );
      assert.deepEqual(
        got.asMap('colors'),
        countValues(Gadget, selected, 'colors'),
        'another facet counts the selection',
      );
      let alone = await faceted({ every: [price, brand] }, [
        { by: 'brand', own: 'ignore' },
      ]);
      assert.deepEqual(
        alone.asMap('brand'),
        countValues(Gadget, holding(Gadget, price), 'brand'),
        'the brand facet counts every brand the other filters keep',
      );
      assert.true(
        Object.keys(alone.asMap('brand')).length > 1,
        'more than the picked brand',
      );
      let plain = await faceted({ every: [price, brand] }, [{ by: 'brand' }]);
      assert.deepEqual(
        plain.asMap('brand'),
        { acme: 3 },
        'without it, only the picked brand',
      );
    });

    test("own: 'ignore' on two facets: each ignores only its own selection", async function (assert) {
      let brand = { in: { brand: ['acme', 'core'] } };
      let color = { eq: { colors: 'red' } };
      let got = await faceted({ every: [brand, color] }, [
        { by: 'brand', own: 'ignore' },
        { by: 'colors', own: 'ignore' },
      ]);
      assert.deepEqual(
        got.asMap('brand'),
        countValues(Gadget, holding(Gadget, color), 'brand'),
        'brands of the red cards',
      );
      assert.deepEqual(
        got.asMap('colors'),
        countValues(Gadget, holding(Gadget, brand), 'colors'),
        'colors of the picked brands',
      );
    });

    test('ranges: a value on a boundary is in the bucket that starts there', async function (assert) {
      let ranges = [
        { key: 'cheap', to: 10 },
        { from: 10, to: 20 },
        { from: 20, to: 30 },
        { from: 50, to: 60 },
        { from: 30 },
      ];
      let got = await faceted(undefined, [{ by: 'price', ranges }]);
      // [from, to): 0 and 5; 10, 15 and 19.99; 20, 20 and 25; none; 30 and 40.
      // The buckets come back in the order asked, an empty one included,
      // labeled by key or from-to with * for an open end.
      assert.deepEqual(got.counts('price'), [
        { value: 'cheap', count: 2 },
        { value: '10-20', count: 3 },
        { value: '20-30', count: 3 },
        { value: '50-60', count: 0 },
        { value: '30-*', count: 2 },
      ]);
      let prices = namesOf(Gadget)
        .map((name) => Gadget.rows[name].price)
        .filter((p) => p != null) as number[];
      let plain = ranges.map(
        ({ from, to }) =>
          prices.filter(
            (p) =>
              (from === undefined || p >= from) && (to === undefined || p < to),
          ).length,
      );
      assert.deepEqual(
        got.counts('price').map((f) => f.count),
        plain,
        'a plain count agrees',
      );
      let open = await faceted({ eq: { brand: 'acme' } }, [
        { by: 'price', ranges: [{ to: 20 }, { from: 20 }] },
      ]);
      // acme: 10 below, 20 and 25 from 20 up.
      assert.deepEqual(open.counts('price'), [
        { value: '*-20', count: 1 },
        { value: '20-*', count: 2 },
      ]);
    });

    test('ranges over a list count a card once per bucket it has an element in', async function (assert) {
      let got = await faceted(undefined, [
        { by: 'sizes', ranges: [{ to: 3 }, { from: 3, to: 10 }, { from: 10 }] },
      ]);
      // below 3: g01 [1, 2] once, g04 (2), g06 (1), g10 [2, 2] once.
      // 3 to 10: g02 (3), g05 (7), g07 (4), g11 (5). From 10: g04 (10), g09.
      assert.deepEqual(got.counts('sizes'), [
        { value: '*-3', count: 4 },
        { value: '3-10', count: 4 },
        { value: '10-*', count: 2 },
      ]);
    });

    test('stats follow the filtered rows', async function (assert) {
      let all = await faceted(undefined, [{ by: 'price', stats: true }]);
      // ten cards have a price: 0 … 40, with 20 twice (nine distinct).
      assert.strictEqual(all.stats.price.count, 10, 'count');
      assert.strictEqual(all.stats.price.distinct, 9, 'distinct');
      assert.strictEqual(all.stats.price.min, 0, 'min');
      assert.strictEqual(all.stats.price.max, 40, 'max');
      assert.true(Math.abs(all.stats.price.sum - 184.99) < 1e-9, 'sum');
      assert.true(Math.abs(all.stats.price.avg - 18.499) < 1e-9, 'average');
      let acme = await faceted({ eq: { brand: 'acme' } }, [
        { by: 'price', stats: true },
        { by: 'brand', stats: true },
      ]);
      // acme: 10, 20, 25.
      assert.strictEqual(acme.stats.price.count, 3, 'count under a filter');
      assert.strictEqual(acme.stats.price.min, 10, 'min under a filter');
      assert.strictEqual(acme.stats.price.max, 25, 'max under a filter');
      assert.strictEqual(acme.stats.price.sum, 55, 'sum under a filter');
      assert.strictEqual(acme.stats.brand.min, 'acme', 'text min');
      assert.strictEqual(acme.stats.brand.max, 'acme', 'text max');
      assert.strictEqual(acme.stats.brand.distinct, 1, 'text distinct');
    });

    test('stats over a list use every element', async function (assert) {
      let got = await faceted(undefined, [{ by: 'sizes', stats: true }]);
      // nine cards hold a size; the values are 1, 2, 3, 4, 5, 7, 10 and 100.
      assert.strictEqual(got.stats.sizes.count, 9, 'cards with a size');
      assert.strictEqual(got.stats.sizes.distinct, 8, 'distinct sizes');
      assert.strictEqual(got.stats.sizes.min, 1, 'min');
      assert.strictEqual(
        got.stats.sizes.max,
        100,
        'the largest element of any list',
      );
    });

    // docs/search.md does not say what stats are over no rows. A minimum of
    // nothing is not 0, so none may be reported as a number.
    test('stats over no matches report no minimum, maximum, sum or average', async function (assert) {
      let got = await faceted({ eq: { brand: 'nobody' } }, [
        { by: 'price', stats: true },
        { by: 'brand', stats: true, missing: true },
      ]);
      assert.deepEqual(got.names, []);
      assert.deepEqual(got.counts('price'), []);
      for (let by of ['price', 'brand']) {
        let stats = got.stats[by];
        assert.strictEqual(stats.count, 0, `${by}: count`);
        assert.strictEqual(stats.distinct, 0, `${by}: distinct`);
        for (let key of ['min', 'max', 'sum', 'avg']) {
          assert.strictEqual(stats[key], undefined, `${by}: no ${key}`);
        }
      }
      assert.strictEqual(
        got.stats.brand?.missing,
        0,
        'nothing matched, nothing missing',
      );
    });

    test('facet values come most common first, and size keeps the first of them', async function (assert) {
      let got = await faceted(undefined, [{ by: 'colors' }]);
      let counts = got.counts('colors').map((f) => f.count);
      assert.deepEqual(
        counts,
        [...counts].sort((a, b) => b - a),
        'counts never rise',
      );
      assert.deepEqual(
        got.counts('colors')[0],
        { value: 'red', count: 4 },
        'the most common',
      );
      let one = await faceted(undefined, [{ by: 'colors', size: 1 }]);
      assert.deepEqual(
        one.counts('colors'),
        [{ value: 'red', count: 4 }],
        'size 1',
      );
      let three = await faceted(undefined, [{ by: 'colors', size: 3 }]);
      // red 4, then blue and green with 3 each.
      assert.deepEqual(
        three.counts('colors').map((f) => f.count),
        [4, 3, 3],
        'size 3',
      );
      assert.deepEqual(
        three
          .counts('colors')
          .map((f) => f.value)
          .sort(),
        ['blue', 'green', 'red'],
      );
      let wide = await faceted(undefined, [{ by: 'colors', size: 1000 }]);
      assert.deepEqual(
        wide.asMap('colors'),
        countValues(Gadget, namesOf(Gadget), 'colors'),
        'the largest size',
      );
    });

    // pins current behavior; rule not yet decided: docs/search.md says "most
    // common first" and not what orders values with the same count. Today it
    // is the value, ascending.
    test('facet values with equal counts come in value order (pinned, undecided)', async function (assert) {
      let got = await faceted(undefined, [{ by: 'brand' }, { by: 'colors' }]);
      for (let by of ['brand', 'colors']) {
        assert.deepEqual(
          got.counts(by),
          byCountThenValue(countValues(Gadget, namesOf(Gadget), by)),
          by,
        );
      }
      // bolt and core both count 2: size 2 keeps acme and bolt.
      let two = await faceted(undefined, [{ by: 'brand', size: 2 }]);
      assert.deepEqual(two.counts('brand'), [
        { value: 'acme', count: 3 },
        { value: 'bolt', count: 2 },
      ]);
    });

    test("order: 'value' lists facet values in value order", async function (assert) {
      let got = await faceted(undefined, [{ by: 'brand', order: 'value' }]);
      assert.deepEqual(got.counts('brand'), [
        { value: '', count: 1 },
        { value: 'acme', count: 3 },
        { value: 'bolt', count: 2 },
        { value: 'core', count: 2 },
        { value: 'dash', count: 1 },
      ]);
    });

    // pins current behavior; rule not yet decided: docs/search.md shows a
    // facet entry as `{ value, count }` and does not say whether a number
    // field's values come back as numbers. Today every value is a string,
    // and values that differ only in case are separate.
    test('a number facet returns its values as strings (pinned, undecided)', async function (assert) {
      // counted by value: a number facet with `stats` (alone it is ranges)
      let got = await faceted(undefined, [
        { by: 'price', stats: true },
        { by: 'colors' },
      ]);
      assert.deepEqual(
        got.asMap('price'),
        countValues(Gadget, namesOf(Gadget), 'price'),
      );
      assert.strictEqual(got.asMap('price')['20'], 2, 'two cards cost 20');
      assert.strictEqual(got.asMap('price')['19.99'], 1);
      for (let { value } of got.counts('price')) {
        assert.strictEqual(typeof value, 'string', `${value} is a string`);
      }
      assert.strictEqual(got.asMap('colors').Red, 1, '"Red" is not "red"');
    });

    test('asking for facets leaves the rows and the total alone', async function (assert) {
      let filter = ofType(Gadget, { range: { price: { gte: 10 } } });
      let sort = sortOf(Gadget, [{ by: 'price', direction: 'desc' }]);
      let plain = await search(Gadget, { filter, sort, page: { size: 4 } });
      let withFacets = await search(Gadget, {
        filter,
        sort,
        page: { size: 4 },
        facets: [
          { by: 'brand', own: 'ignore' },
          { by: 'colors', stats: true, missing: true },
          { by: 'price', ranges: [{ to: 20 }, { from: 20 }] },
        ],
      });
      assert.deepEqual(withFacets.names, plain.names);
      assert.strictEqual(withFacets.meta.page.total, plain.meta.page.total);
      assert.strictEqual(plain.names.length, 4);
    });

    // ---- H. names that are not fields ----------------------------------------

    // docs/search.md: "a field the type does not have" is refused with
    // `unknown-field`. A name every JavaScript object answers to is such a
    // field too.
    const NOT_FIELDS = [
      'nope',
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
      'valueOf',
      'address.nope',
      'address.constructor',
      'address.city.nope',
    ];
    const PLACES: [string, (path: string) => Record<string, any>][] = [
      ['eq', (path) => ({ filter: anchored(Place, { eq: keyed(path, 'x') }) })],
      [
        'eq null',
        (path) => ({ filter: anchored(Place, { eq: keyed(path, null) }) }),
      ],
      [
        'in',
        (path) => ({ filter: anchored(Place, { in: keyed(path, ['x']) }) }),
      ],
      [
        'contains',
        (path) => ({ filter: anchored(Place, { contains: keyed(path, 'x') }) }),
      ],
      [
        'range',
        (path) => ({
          filter: anchored(Place, { range: keyed(path, { gt: 1 }) }),
        }),
      ],
      [
        'not',
        (path) => ({
          filter: anchored(Place, { not: { eq: keyed(path, 'x') } }),
        }),
      ],
      [
        'any',
        (path) => ({
          filter: anchored(Place, {
            any: [
              { eq: { 'address.city': 'Paris' } },
              { eq: keyed(path, 'x') },
            ],
          }),
        }),
      ],
      [
        'every under not under any',
        (path) => ({
          filter: anchored(Place, {
            any: [
              { eq: { 'address.city': 'Paris' } },
              {
                not: {
                  every: [
                    { eq: { 'address.city': 'Lyon' } },
                    { eq: keyed(path, 'x') },
                  ],
                },
              },
            ],
          }),
        }),
      ],
      [
        'a sort',
        (path) => ({
          filter: { type: Place.ref },
          sort: [{ on: Place.ref, by: path }],
        }),
      ],
      [
        'the newer spelling',
        (path) =>
          lowerQuery({
            type: Place.ref,
            filter: { not: { eq: keyed(path, 'x') } },
            sort: [{ by: path, direction: 'desc' }],
          }).query,
      ],
    ];
    for (let [place, build] of PLACES) {
      test(`a name that is not a field is refused as unknown-field in ${place}`, async function (assert) {
        for (let path of NOT_FIELDS) {
          let q = { ...build(path), page: everything };
          assert.strictEqual(
            await outcome(() => search(Place, q)),
            'refused: unknown-field',
            path,
          );
        }
      });
    }

    test('a facet by a name that is not a field is refused as unknown-field', async function (assert) {
      for (let path of ['nope', 'constructor', 'toString', 'address.nope']) {
        assert.strictEqual(
          await outcome(() =>
            search(Place, {
              filter: { type: Place.ref },
              facets: [{ by: path }],
              page: everything,
            }),
          ),
          'refused: unknown-field',
          path,
        );
      }
    });

    test('a real field beside a refused one changes nothing: the fixture still answers', async function (assert) {
      // the control for the refusals above: the same shapes with real paths
      for (let [place, build] of PLACES) {
        assert.strictEqual(
          await outcome(() =>
            search(Place, { ...build('address.city'), page: everything }),
          ),
          'ran',
          place,
        );
      }
    });

    // ---- H. what the grammar refuses -----------------------------------------

    // Each code is the one docs/search.md's Refusals table gives for that
    // kind of mistake.
    const on = Rank.ref;
    // prettier-ignore
    const REFUSALS: [string, Record<string, any>, string][] = [
      ['a negative page number', { filter: { type: on }, page: { number: -1, size: 5 } }, 'invalid-page'],
      ['a fractional page number', { filter: { type: on }, page: { number: 1.5, size: 5 } }, 'invalid-page'],
      ['a fractional page size', { filter: { type: on }, page: { size: 2.5 } }, 'invalid-page'],
      ['a page total that is no mode', { filter: { type: on }, page: { size: 5, total: 'roughly' } }, 'invalid-page'],
      ['a negative page size in the newer spelling', { type: on, page: { size: -1 } }, 'invalid-page'],
      ['an unknown page member in the newer spelling', { type: on, page: { size: 5, offset: 10 } }, 'unknown-key'],
      [
        'a sort direction that is neither',
        {
          filter: { type: on },
          sort: [{ on, by: 'a', direction: 'sideways' }],
        },
        'invalid-value',
      ],
      ['a sort missing that is neither', { filter: { type: on }, sort: [{ on, by: 'a', missing: 'middle' }] }, 'invalid-value'],
      ['a field sort with no type anywhere', { sort: [{ by: 'a' }], filter: { exists: 'a' } }, 'sort-needs-type'],
      [
        'more than 8 facets',
        {
          filter: { type: on },
          // nine different fields: facets on one field combine into one
          facets: Array.from({ length: 9 }, (_, i) => ({ by: `b${i}` })),
        },
        'limit-exceeded',
      ],
      ['a facet size above 1000', { filter: { type: on }, facets: [{ by: 'b', size: 1001 }] }, 'invalid-value'],
      ['a facet size of 0', { filter: { type: on }, facets: [{ by: 'b', size: 0 }] }, 'invalid-value'],
      ['a facet own that is not ignore', { filter: { type: on }, facets: [{ by: 'b', own: 'keep' }] }, 'invalid-value'],
      ['a facet member the grammar lacks', { filter: { type: on }, facets: [{ by: 'b', top: 3 }] }, 'unknown-key'],
      ['a facet order that is no order', { filter: { type: on }, facets: [{ by: 'b', order: 'random' }] }, 'invalid-value'],
      [
        'a facet range with a member it lacks',
        {
          filter: { type: on },
          facets: [{ by: 'a', ranges: [{ from: 1, upTo: 2 }] }],
        },
        'unknown-key',
      ],
      ['two operators on one filter node', { filter: { on, eq: { b: 'x' }, range: { a: { gt: 1 } } } }, 'conflicting-members'],
      ['any given an object', { filter: { on, any: { eq: { b: 'x' } } } }, 'invalid-value'],
      ['every given a string', { filter: { on, every: 'all' } }, 'invalid-value'],
      ['in given one value, not a list', { filter: { on, in: { b: 'x' } } }, 'invalid-value'],
      ['eq given a string, not an object', { filter: { on, eq: 'x' } }, 'invalid-value'],
      ['a range bound the grammar lacks', { filter: { on, range: { a: { above: 1 } } } }, 'unknown-key'],
      ['a range given a number, not bounds', { filter: { on, range: { a: 3 } } }, 'invalid-value'],
      ['a null range bound', { filter: { on, range: { a: { gt: null } } } }, 'invalid-value'],
      ['an operator the grammar lacks, in the newer spelling', { type: on, filter: { equals: { b: 'x' } } }, 'unknown-key'],
      ['exists given a list', { type: on, filter: { exists: ['a'] } }, 'invalid-filter'],
    ];
    for (let [mistake, q, code] of REFUSALS) {
      test(`the grammar refuses ${mistake} (${code})`, async function (assert) {
        assert.strictEqual(
          await outcome(() => assertQuery(JSON.parse(JSON.stringify(q)))),
          `refused: ${code}`,
        );
      });
    }

    // pins current behavior; rule not yet decided: the Refusals table gives
    // `invalid-value` for "the wrong kind of value" and `invalid-json` for a
    // malformed body. A range bound that is a list gets the second today.
    test('the grammar refuses a range bound that is a list (pinned, undecided)', async function (assert) {
      assert.strictEqual(
        await outcome(() =>
          assertQuery({ filter: { on, range: { a: { gt: [1] } } } }),
        ),
        'refused: invalid-json',
      );
    });

    test('the grammar accepts the edge shapes this file runs', async function (assert) {
      for (let [name, q] of [
        ['size 0', { filter: { type: on }, page: { size: 0 } }],
        ['page 0', { filter: { type: on }, page: { number: 0, size: 1 } }],
        ['in []', { filter: { on, in: { b: [] } } }],
        ['a null in a list', { filter: { on, in: { b: ['x', null] } } }],
        ['eq null', { filter: { on, eq: { b: null } } }],
        ['two bounds', { filter: { on, range: { a: { gt: 10, lt: 5 } } } }],
        [
          '8 facets',
          {
            filter: { type: on },
            facets: Array.from({ length: 8 }, () => ({ by: 'b' })),
          },
        ],
        [
          'facet size 1000',
          { filter: { type: on }, facets: [{ by: 'b', size: 1000 }] },
        ],
        [
          'missing first',
          { filter: { type: on }, sort: [{ on, by: 'a', missing: 'first' }] },
        ],
      ] as [string, Record<string, any>][]) {
        assert.strictEqual(await outcome(() => assertQuery(q)), 'ran', name);
      }
    });
  });
});
