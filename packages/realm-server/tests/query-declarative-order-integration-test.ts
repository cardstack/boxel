import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { format } from 'date-fns';

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
  type Filter,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { normalizeQueryForSignature } from '@cardstack/runtime-common/query';
import { canonicalizeFilterRefs } from '@cardstack/runtime-common/query-canonicalization';
import { canonicalQuerySignature } from '@cardstack/runtime-common/query-signature';
import { lowerQuery } from '@cardstack/runtime-common/query-syntax';
import {
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common/search-entry';

import { setupDB } from './helpers/index.ts';
import { sized } from './helpers/query-extended.ts';

// A query is declarative (docs/search.md, "The shape of a query"): it says
// what it wants, and "no member means something different because of where it
// sits in the object or in a list". This file writes one query many ways and
// checks that the answer never moves.
//
// Every place a query has an order, and which kind it is:
//
// | Where                                               | Kind     | Why (docs/search.md unless noted)                                   |
// | --------------------------------------------------- | -------- | ------------------------------------------------------------------- |
// | members of the query object                         | set      | "The shape of a query": no member means something by where it sits  |
// | keys of one operator object (eq, in, range, ...)    | set      | an object; one object with two keys is an AND of both               |
// | bounds of one range ({ gte, lt })                   | set      | an object                                                           |
// | children of `every`                                 | set      | "an AND union of other filters"                                     |
// | children of `any`                                   | set      | "an OR union of other filters"                                      |
// | values of an `in` list                              | set      | "a field value that is one of a list"                               |
// | bindings of `let`                                   | set      | an object; "a binding's query cannot use another binding"           |
// | entries of `facets`                                 | set      | each comes back under `meta.facets[by]`, keyed by its field         |
// | members of a facet, sort entry, signal, boost,      | set      | objects                                                             |
// |   collapse, a window's compare, page, type ref      |          |                                                                     |
// | signals of a `blend`                                | set      | "each card scores sum(weight / (k + rank))": a sum                  |
// | weights of a `relevance` sort                       | set      | an object keyed by signal name                                      |
// | `fields` of a `matches`                             | set      | "searches only those fields' values"; NOT SETTLED by the docs       |
// | words of a type-ahead `matches` (title scope)       | set      | "in any order" (for which cards match; their rank reads the order)  |
// | unquoted words of a `matches`                       | set      | websearch syntax: each word must be there                           |
// | `realms` of a merged federated search               | set      | one list ordered by the query's sort (not tested here)              |
// | the `sort` list                                     | sequence | "The array is the order in which the sort is applied"               |
// | `select` columns                                    | sequence | the table's columns, `id` first, then as written                    |
// | a facet's `ranges`                                  | sequence | buckets come back as written; NOT SETTLED by the docs               |
// | words inside a quoted phrase of `matches`           | sequence | websearch syntax: "exact phrase"                                    |
// | the last word of a `matches` with `prefix: true`    | sequence | "treats the query's last word as unfinished"                        |
// | components of a `near` vector                       | sequence | a vector                                                            |
// | `realms` of a byRealm federated search              | sequence | sections come back "in the order asked" when no score orders them   |
// | signals inside `meta._explain`                      | (output) | listed in the blend's written order; NOT SETTLED by the docs        |
//
// Sets are shuffled by the permutation engine below and must answer alike.
// Each sequence has one test showing that reordering it does change the
// answer in the documented way, so the table is itself tested.
//
// The rows go in through the index writer, so vectors, full text, the typo
// word list and pattern text are the writer's own. Nothing is rendered.
// These need pgvector in the test Postgres, and fail without it.
//
// Not reached from here (each needs a running realm server): federated
// `realms`, log searches (`from: { log }`), `linkedFrom`, and `within`.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

type Q = Record<string, any>;

const realm = 'http://declarative-order-test/';
const realmURL = new URL(realm);
const refs = {
  string: ref('@cardstack/base/string', 'default'),
  number: ref('@cardstack/base/number', 'default'),
  datetime: ref('@cardstack/base/datetime', 'default'),
  vector: ref('@cardstack/base/vector', 'default'),
};
const G = ref(`${realm}gadget`, 'Gadget');
// A Widget is a Gadget: its rows carry both types.
const W = ref(`${realm}gadget`, 'Widget');
const N = ref(`${realm}note`, 'Note');

type Kind = 'string' | 'number' | 'strings' | 'numbers' | 'datetime' | 'vector';

const GADGET_FIELDS: Record<string, Kind> = {
  title: 'string',
  blurb: 'string',
  maker: 'string',
  sku: 'string',
  kind: 'string',
  color: 'string',
  tags: 'strings',
  sizes: 'numbers',
  price: 'number',
  rating: 'number',
  stock: 'number',
  grams: 'number',
  listedAt: 'datetime',
  embedding: 'vector',
};
const GADGET_SEARCH: Record<string, Record<string, unknown>> = {
  title: { role: 'title' },
  blurb: { role: 'body' },
  maker: { role: 'name', typos: true },
  sku: { role: 'identifier', patterns: true },
  rating: { rank: 'quality' },
  stock: { rank: 'popularity' },
  embedding: { neighbors: true },
};

function definitionOf(
  codeRef: ResolvedCodeRef,
  fields: Record<string, Kind>,
  search: Record<string, Record<string, unknown>> = {},
): Definition {
  let fieldDef = (name: string, kind: Kind) => ({
    type:
      kind === 'strings' || kind === 'numbers' ? 'containsMany' : 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard:
      kind === 'number' || kind === 'numbers'
        ? refs.number
        : kind === 'datetime'
          ? refs.datetime
          : kind === 'vector'
            ? refs.vector
            : refs.string,
    ...(kind === 'number' || kind === 'numbers'
      ? { serializerName: 'number' }
      : kind === 'datetime' || kind === 'vector'
        ? { serializerName: kind }
        : {}),
    // Every field but a vector is a facet: these cases test that order
    // never matters, not which fields declare one.
    ...(kind === 'vector'
      ? search[name]
        ? { search: search[name] }
        : {}
      : { search: { ...(search[name] ?? {}), facet: true } }),
  });
  return {
    type: 'card-def',
    codeRef,
    displayName: codeRef.name,
    fields: Object.fromEntries(Object.keys(fields).map((n) => [n, n])),
    fieldDefs: Object.fromEntries(
      Object.entries(fields).map(([n, kind]) => [n, fieldDef(n, kind)]),
    ),
  } as unknown as Definition;
}

const DEFINITIONS = [
  definitionOf(G, GADGET_FIELDS, GADGET_SEARCH),
  definitionOf(W, { ...GADGET_FIELDS, torque: 'number' }, GADGET_SEARCH),
  definitionOf(
    N,
    { title: 'string', kind: 'string', price: 'number', tags: 'strings' },
    { title: { role: 'title' } },
  ),
  definitionOf(baseCardRef, {}),
];

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      let found = DEFINITIONS.find((d) => {
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
  } as unknown as DefinitionLookup;
  return lookup;
}

function fixture(message: string): never {
  throw new Error(`fixture: ${message}`);
}

// --- order, written many ways -----------------------------------------------

// A fixed pseudo-random sequence: every run shuffles the same way, so a
// failure names a spelling that fails again.
const SEED = 20261110;
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

function shuffled<T>(list: T[], next: () => number): T[] {
  let out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    let j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Every order of a small list, the order as written first.
function allPermutations<T>(list: T[]): T[][] {
  if (list.length > 4) {
    throw new Error('allPermutations is for up to 4 members');
  }
  if (list.length <= 1) {
    return [[...list]];
  }
  return list.flatMap((item, i) =>
    allPermutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

// Orders to try for a list: all of them up to 4 members; past that, every
// rotation (each member in each position), the reverse, and six shuffles.
// The order as written is first.
function someOrders<T>(list: T[], next: () => number): T[][] {
  if (list.length <= 4) {
    return allPermutations(list);
  }
  let indexes = list.map((_, i) => i);
  let orders = [
    ...indexes.map((i) => [...indexes.slice(i), ...indexes.slice(0, i)]),
    [...indexes].reverse(),
    ...Array.from({ length: 6 }, () => shuffled(indexes, next)),
  ];
  let seen = new Set<string>();
  return orders
    .filter((order) => {
      let key = order.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((order) => order.map((i) => list[i]));
}

const isObject = (v: unknown): v is Record<string, any> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

// The lists the language defines as sets, by the key that holds them. `of`
// is a blend's signals once lowered. The values of an `in` are handled where
// the operator is read, since they sit under a field path. `sort`, `select`,
// `ranges` and vectors are sequences and are left as written.
const SET_LISTS = new Set(['every', 'any', 'facets', 'blend', 'of', 'fields']);

interface PermuteOptions {
  // re-insert every object's keys in a shuffled order
  keys?: boolean;
  // shuffle every set-like list
  lists?: boolean;
}

// The same query, written in another order: every object's keys re-inserted
// in a shuffled order, and every set-like list shuffled, all the way down.
function permuted(
  node: any,
  next: () => number,
  opts: PermuteOptions = {},
  key?: string,
): any {
  let { keys = true, lists = true } = opts;
  if (Array.isArray(node)) {
    let items = node.map((item) => permuted(item, next, opts));
    return lists && key !== undefined && SET_LISTS.has(key)
      ? shuffled(items, next)
      : items;
  }
  if (!isObject(node)) {
    return node;
  }
  let entries = Object.entries(node).map(([k, v]): [string, any] => {
    if (k === 'in' && isObject(v)) {
      let paths = Object.entries(v).map(([path, values]): [string, any] => [
        path,
        Array.isArray(values) && lists
          ? shuffled(values, next)
          : permuted(values, next, opts),
      ]);
      return [k, Object.fromEntries(keys ? shuffled(paths, next) : paths)];
    }
    return [k, permuted(v, next, opts, k)];
  });
  return Object.fromEntries(keys ? shuffled(entries, next) : entries);
}

// One spelling for every order a query can be written in: keys sorted, and
// each set-like list sorted by its members' own canonical text. Two queries
// that differ only in order have the same canonical form.
function canon(node: any, key?: string): any {
  let sorted = (items: any[]) =>
    [...items].sort((a, b) =>
      JSON.stringify(a) < JSON.stringify(b)
        ? -1
        : JSON.stringify(a) > JSON.stringify(b)
          ? 1
          : 0,
    );
  if (Array.isArray(node)) {
    let items = node.map((item) => canon(item));
    return key !== undefined && SET_LISTS.has(key) ? sorted(items) : items;
  }
  if (!isObject(node)) {
    return node;
  }
  return Object.fromEntries(
    Object.keys(node)
      .sort()
      .map((k) => {
        let v = node[k];
        if (k === 'in' && isObject(v)) {
          return [
            k,
            Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((path) => [
                  path,
                  Array.isArray(v[path])
                    ? sorted(v[path].map((x: any) => canon(x)))
                    : canon(v[path]),
                ]),
            ),
          ];
        }
        return [k, canon(v, k)];
      }),
  );
}
const canonText = (node: unknown) => JSON.stringify(canon(node));

// Where each `every`, `any`, `blend` and `facets` list sits in a query.
function setListPaths(
  node: any,
  path: (string | number)[] = [],
): (string | number)[][] {
  let found: (string | number)[][] = [];
  if (Array.isArray(node)) {
    node.forEach((item, i) => found.push(...setListPaths(item, [...path, i])));
  } else if (isObject(node)) {
    for (let [k, v] of Object.entries(node)) {
      if (
        Array.isArray(v) &&
        ['every', 'any', 'blend', 'facets'].includes(k) &&
        v.length > 1
      ) {
        found.push([...path, k]);
      }
      found.push(...setListPaths(v, [...path, k]));
    }
  }
  return found;
}

// The ways one query is rewritten: every order of its members (see
// `someOrders`), every order of each `every`, `any`, `blend` and `facets`
// list on its own, and five shuffles of everything at once.
function variants(q: Q, next: () => number): [string, Q][] {
  let out: [string, Q][] = [];
  for (let order of someOrders(Object.keys(q), next).slice(1)) {
    out.push([
      `members as ${order.join(', ')}`,
      Object.fromEntries(order.map((k) => [k, q[k]])),
    ]);
  }
  for (let path of setListPaths(q)) {
    let list = path.reduce((at: any, step) => at[step], q) as unknown[];
    let indexes = list.map((_, i) => i);
    for (let order of someOrders(indexes, next).slice(1)) {
      let clone = structuredClone(q);
      let parent = path.slice(0, -1).reduce((at: any, step) => at[step], clone);
      parent[path[path.length - 1]] = order.map((i) =>
        structuredClone(list[i]),
      );
      out.push([`${path.join('.')} as ${order.join('')}`, clone]);
    }
  }
  for (let i = 0; i < 5; i++) {
    out.push([`shuffle ${i}`, permuted(q, next)]);
  }
  return out;
}

// --- the fixture --------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);
const asDatetime = (d: Date) => format(d, `yyyy-MM-dd'T'HH:mm`);

const MATERIALS = ['Brass', 'Oak', 'Steel', 'Linen', 'Glass'];
const THINGS = [
  'desk lamp',
  'floor lamp',
  'wall clock',
  'coat hook',
  'step stool',
  'desk shelf',
];
// Two blurbs hold the same two words in opposite orders, for the phrase test.
const READING_LIGHT = 'A reading light for late hours';
const LIGHT_READING = 'Light reading for slow mornings';
const BLURBS = [
  READING_LIGHT,
  LIGHT_READING,
  'Quiet hands and a soft chime',
  'Holds coats, keys and a hat',
  'Folds flat when not in use',
  'Floats above a cluttered table',
];
const MAKERS = ['Halvorsen', 'Okonkwo', 'Lindqvist', 'Marchetti', 'Tanaka'];
const KINDS = ['home', 'office', 'garden', 'studio'];
const COLORS = ['red', 'green', 'blue', 'amber'];
const TAGS = ['red', 'green', 'blue', 'amber'];
const SIZES = [0, 5, 10, 15, 20, 25];

type Value = string | number | string[] | number[] | null;
type Doc = Record<string, Value>;
type TypeName = 'Gadget' | 'Widget' | 'Note';
interface Row {
  name: string;
  url: string;
  types: TypeName[];
  doc: Doc;
  // Four int8 components, the largest of them 127, so the stored vector is
  // these numbers.
  vector: number[] | null;
}

const GADGET_COUNT = 40;
const WIDGET_COUNT = 8;

// What the type-anchor tests need to tell one conjunct from another: a widget
// that passes all of them, and one that fails each.
const OVERRIDES: Record<string, Doc> = {
  g00: { title: 'Brass desk lamp', kind: 'home' },
  // the card the one-card bindings and the table test read
  g05: { kind: 'studio', rating: 3 },
  w00: { title: 'Brass desk lamp', kind: 'home', color: 'red', torque: 5 },
  w01: { title: 'Brass floor lamp', kind: 'home', color: 'blue', torque: 1 },
  w02: { title: 'Brass wall clock', kind: 'office', color: 'red', torque: 6 },
  w03: { title: 'Oak desk lamp', kind: 'home', color: null, torque: 7 },
  w04: { title: 'Brass coat hook', kind: 'home', color: 'green', torque: 4 },
  w05: { title: 'Steel step stool', kind: null, color: 'red', torque: 2 },
  w06: { title: 'Glass desk shelf', kind: 'garden', color: 'amber', torque: 8 },
  w07: { title: 'Linen wall clock', kind: 'studio', color: null, torque: 3 },
};

// Few distinct values, so there are ties to order and groups to count; about
// one value in eight is missing, and about one list in four is empty. Price,
// stock and grams are all different, so a ranking by one has no ties.
function makeRows(): Row[] {
  let next = sequence(SEED);
  let pick = <T>(list: T[]): T => list[Math.floor(next() * list.length)];
  let count = GADGET_COUNT + WIDGET_COUNT;
  let spread = (start: number, step: number) =>
    shuffled(
      Array.from({ length: count }, (_, i) => start + i * step),
      next,
    );
  let prices = spread(12, 5);
  let stocks = spread(1, 3);
  let grams = spread(100, 40);
  let rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    let widget = i >= GADGET_COUNT;
    let name = widget
      ? `w${String(i - GADGET_COUNT).padStart(2, '0')}`
      : `g${String(i).padStart(2, '0')}`;
    let doc: Doc = {
      title: `${pick(MATERIALS)} ${pick(THINGS)}`,
      blurb: pick(BLURBS),
      maker: pick(MAKERS),
      kind: next() < 0.125 ? null : pick(KINDS),
      color: next() < 0.125 ? null : pick(COLORS),
      tags: [
        ...new Set(
          Array.from({ length: Math.floor(next() * 4) }, () => pick(TAGS)),
        ),
      ],
      sizes: [
        ...new Set(
          Array.from({ length: Math.floor(next() * 4) }, () => pick(SIZES)),
        ),
      ],
      price: prices[i],
      rating: next() < 0.125 ? null : 1 + Math.floor(next() * 5),
      stock: stocks[i],
      grams: i % 6 === 4 ? null : grams[i],
      // far from every boundary a test draws
      listedAt: asDatetime(ago((2 + i * 9) * DAY + 5 * HOUR)),
      ...(OVERRIDES[name] ?? {}),
    };
    doc.sku = `${String(doc.title).slice(0, 3).toUpperCase()}-${String(i).padStart(4, '0')}`;
    let vector: number[] | null = null;
    if (i % 7 !== 3) {
      vector = Array.from({ length: 4 }, () => Math.floor(next() * 255) - 127);
      vector[Math.floor(next() * 4)] = 127;
    }
    rows.push({
      name,
      url: `${realm}${widget ? 'Widget' : 'Gadget'}/${name}.json`,
      types: widget ? ['Widget', 'Gadget'] : ['Gadget'],
      doc,
      vector,
    });
  }
  for (let i = 0; i < 10; i++) {
    let name = `n${String(i).padStart(2, '0')}`;
    rows.push({
      name,
      url: `${realm}Note/${name}.json`,
      types: ['Note'],
      doc: {
        title:
          i === 0 ? 'Brass desk lamp' : `${pick(MATERIALS)} ${pick(THINGS)}`,
        kind: i === 0 ? 'home' : pick(KINDS),
        price: 10 + i * 11,
        tags: [pick(TAGS)],
      },
      vector: null,
    });
  }
  return rows;
}

const ROWS = makeRows();
// Every row a Gadget-typed query can return: the gadgets and the widgets.
const GADGETS = ROWS.filter((row) => row.types.includes('Gadget'));
const rowNamed = (name: string) =>
  ROWS.find((row) => row.name === name) ?? fixture(`no row ${name}`);
const nameOf = (url: string) =>
  url.slice(url.lastIndexOf('/') + 1).replace(/\.json$/, '');
const namesWhere = (keep: (row: Row) => boolean, rows = ROWS) =>
  rows
    .filter(keep)
    .map((row) => row.name)
    .sort();
const textOf = (row: Row, field: string) => String(row.doc[field] ?? '');

const vec = (components: number[]) =>
  VectorSerializer.queryableValue(VectorSerializer.encodeVector(components));
const TARGET = [127, 20, -30, 5];

// --- a plain evaluation of filters --------------------------------------------

type Scalar = string | number;
type Leaf =
  | { op: 'eq'; field: string; value: Scalar | null }
  | { op: 'in'; field: string; value: Scalar[] }
  | { op: 'contains'; field: string; value: string }
  | { op: 'range'; field: string; bounds: Record<string, number> }
  | { op: 'isa'; type: TypeName };
type Node =
  | Leaf
  | { op: 'not'; of: Node }
  | { op: 'any' | 'every'; of: Node[] };

// A comparison with a missing value is neither true nor false, as in SQL, and
// `not`, `any` and `every` carry that through. `eq: null` asks for the
// missing value itself. A list field holds when some element does.
type Truth = true | false | null;

function leafHolds(row: Row, node: Leaf): Truth {
  if (node.op === 'isa') {
    return row.types.includes(node.type);
  }
  let raw = row.doc[node.field];
  if (node.op === 'eq' && node.value === null) {
    return raw == null;
  }
  if (raw == null) return null;
  let values: Scalar[] = Array.isArray(raw) ? raw : [raw];
  switch (node.op) {
    case 'eq':
      return values.includes(node.value as Scalar);
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

const holds = (row: Row, node: Node) => truth(row, node) === true;

const TYPE_REFS: Record<TypeName, ResolvedCodeRef> = {
  Gadget: G,
  Widget: W,
  Note: N,
};

// The node as a filter: with `on`, the way a query saved in a realm writes it
// (an anchor on every operator); without, the newer spelling's bare clauses.
function asFilter(node: Node, on?: ResolvedCodeRef): Q {
  let anchor = on ? { on } : {};
  switch (node.op) {
    case 'isa':
      return { type: TYPE_REFS[node.type] };
    case 'eq':
      return { ...anchor, eq: { [node.field]: node.value } };
    case 'in':
      return { ...anchor, in: { [node.field]: node.value } };
    case 'contains':
      return { ...anchor, contains: { [node.field]: node.value } };
    case 'range':
      return { ...anchor, range: { [node.field]: node.bounds } };
    case 'not':
      return { ...anchor, not: asFilter(node.of, on) };
    case 'any':
      return { ...anchor, any: node.of.map((n) => asFilter(n, on)) };
    case 'every':
      return { ...anchor, every: node.of.map((n) => asFilter(n, on)) };
  }
}

const FILTER_FIELDS: Record<string, Kind> = {
  kind: 'string',
  color: 'string',
  maker: 'string',
  tags: 'strings',
  sizes: 'numbers',
  price: 'number',
  rating: 'number',
  stock: 'number',
};
const DOMAIN: Record<string, Scalar[]> = {
  kind: KINDS,
  color: COLORS,
  maker: MAKERS,
  tags: TAGS,
  sizes: SIZES,
  price: [30, 60, 90, 120, 150, 200],
  rating: [1, 2, 3, 4, 5],
  stock: [10, 40, 70, 100, 130],
};
const SORT_FIELDS = ['price', 'rating', 'stock', 'grams'];
const FACET_FIELDS = ['kind', 'color', 'maker', 'tags', 'sizes'];

interface Generated {
  node: Node;
  sortBy: string;
  direction: 'asc' | 'desc';
  page: Q;
  facets: [string, string];
}

// Random filter trees over scalar and list fields, three operators deep, each
// with a sort, a page and two facets.
function generate(count: number, seedValue: number): Generated[] {
  let next = sequence(seedValue);
  let pick = <T>(list: T[]): T => list[Math.floor(next() * list.length)];
  let fieldsOf = (...kinds: Kind[]) =>
    Object.keys(FILTER_FIELDS).filter((f) => kinds.includes(FILTER_FIELDS[f]));
  let leaf = (): Leaf => {
    let r = next();
    if (r < 0.3) {
      let field = pick(fieldsOf('string', 'number', 'strings', 'numbers'));
      return { op: 'eq', field, value: pick(DOMAIN[field]) };
    }
    if (r < 0.5) {
      let field = pick(fieldsOf('string', 'strings', 'numbers'));
      return {
        op: 'in',
        field,
        value: Array.from({ length: 2 + Math.floor(next() * 2) }, () =>
          pick(DOMAIN[field]),
        ),
      };
    }
    if (r < 0.7) {
      return {
        op: 'contains',
        field: pick(fieldsOf('string')),
        value: pick(['ome', 'OFF', 'e', 'red', 'son', 'nothing']),
      };
    }
    let field = pick(fieldsOf('number', 'numbers'));
    let bounds: Record<string, number> = {};
    bounds[pick(['gt', 'gte'])] = pick(DOMAIN[field]) as number;
    if (next() < 0.5) {
      bounds[pick(['lt', 'lte'])] = pick(DOMAIN[field]) as number;
    }
    return { op: 'range', field, bounds };
  };
  let node = (depth: number): Node => {
    let r = next();
    if (depth === 0 || r < 0.35) return leaf();
    if (r < 0.5) return { op: 'not', of: node(depth - 1) };
    return {
      op: r < 0.75 ? 'any' : 'every',
      of: Array.from({ length: 2 + Math.floor(next() * 3) }, () =>
        node(depth - 1),
      ),
    };
  };
  return Array.from({ length: count }, () => {
    let first = pick(FACET_FIELDS);
    let total = pick(['exact', 'capped', 'none', undefined]);
    return {
      node: node(3),
      sortBy: pick(SORT_FIELDS),
      direction: pick(['asc', 'desc'] as const),
      page: {
        size: pick([5, 8, 20, 100]),
        ...(next() < 0.35 ? { number: 1 } : {}),
        ...(total ? { total } : {}),
      },
      facets: [first, pick(FACET_FIELDS.filter((f) => f !== first))],
    };
  });
}

// A field sort: lowest first (or highest, for `desc`), cards with no value
// last either way ("they go last by default"), and the card's URL to order
// the ties.
function sortedBy(rows: Row[], field: string, direction: 'asc' | 'desc') {
  return [...rows].sort((a, b) => {
    let x = a.doc[field] as number | null;
    let y = b.doc[field] as number | null;
    if (x == null || y == null) {
      if (x == null && y == null) return a.url < b.url ? -1 : 1;
      return x == null ? 1 : -1;
    }
    if (x !== y) return direction === 'asc' ? x - y : y - x;
    return a.url < b.url ? -1 : 1;
  });
}

function countsOf(rows: Row[], field: string): Record<string, number> {
  let counts: Record<string, number> = {};
  for (let row of rows) {
    let raw = row.doc[field];
    for (let v of raw == null ? [] : Array.isArray(raw) ? raw : [raw]) {
      counts[String(v)] = (counts[String(v)] ?? 0) + 1;
    }
  }
  return counts;
}

// --- answers --------------------------------------------------------------------

// Everything a search answers with that a caller can see: the rows in order,
// the page's total and `hasMore`, facet counts in the order returned, what
// each binding resolved to, each row's scores and collapse size, each row's
// explanation, and the table of a `select`.
interface Answer {
  rows: string[];
  page: unknown;
  facets: unknown;
  facetStats: unknown;
  lets: unknown;
  rerank: unknown;
  scores: Record<string, Record<string, number>>;
  explain: Record<string, unknown>;
  table?: { columns: string[]; rows: unknown[][] };
}

const SCORE_KEYS = [
  '_blendScore',
  '_matchRelevance',
  '_nearSimilarity',
  '_collapseSize',
  '_window',
  '_expression',
];

// `explain` lists a blend's signals in the order the blend was written, which
// is presentation: here they are keyed, so two orders of one blend compare.
function explanationOf(explain: any): unknown {
  if (!explain || !Array.isArray(explain.signals)) {
    return explain ?? null;
  }
  let keyed = explain.signals.map((s: any) => [
    `${s.signal} weight ${s.weight} rank ${s.rank}`,
    s,
  ]);
  keyed.sort((a: [string, unknown], b: [string, unknown]) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
  return { ...explain, signals: keyed };
}

function answerOf(
  urls: string[],
  results: Record<string, unknown>[],
  meta: any,
): Answer {
  let scores: Answer['scores'] = {};
  let explain: Answer['explain'] = {};
  results.forEach((r, i) => {
    let name = nameOf(urls[i]);
    for (let key of SCORE_KEYS) {
      if (r[key] != null) {
        (scores[name] ??= {})[key] = Number(r[key]);
      }
    }
    if (r._explain != null) {
      explain[name] = explanationOf(r._explain);
    }
  });
  return JSON.parse(
    JSON.stringify({
      rows: urls.map(nameOf),
      page: meta.page ?? null,
      facets: meta.facets ?? null,
      facetStats: meta.facetStats ?? null,
      lets: meta.lets ?? null,
      rerank: meta.window ?? null,
      scores,
      explain,
    }),
  );
}

// Where two answers differ, in words. Numbers compare to a small tolerance,
// since a sum of rank contributions taken in another order may differ in its
// last digits; everything else compares exactly.
function differences(a: unknown, b: unknown, path = 'answer'): string[] {
  let show = (v: unknown) => {
    let s = JSON.stringify(v);
    return s === undefined
      ? 'undefined'
      : s.length > 300
        ? `${s.slice(0, 300)}…`
        : s;
  };
  let asNumber = (v: unknown) =>
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
        ? Number(v)
        : undefined;
  if (a === b) {
    return [];
  }
  let x = asNumber(a);
  let y = asNumber(b);
  if (
    x !== undefined &&
    y !== undefined &&
    typeof a === typeof b &&
    Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))
  ) {
    return [];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length || a.every((item) => typeof item === 'string')) {
      return JSON.stringify(a) === JSON.stringify(b)
        ? []
        : [`${path}: ${show(a)} became ${show(b)}`];
    }
    return a.flatMap((item, i) => differences(item, b[i], `${path}[${i}]`));
  }
  if (isObject(a) && isObject(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .sort()
      .flatMap((k) => differences(a[k], b[k], `${path}.${k}`));
  }
  return [`${path}: ${show(a)} became ${show(b)}`];
}

// --- spellings --------------------------------------------------------------------

const GENERAL_SORTS = ['cardURL', 'lastModified', 'createdAt'];
const byURL = { by: 'cardURL' };

// A filter with an `on` on every operator, as a query saved in a realm has.
function anchorFilter(node: Q, on: ResolvedCodeRef): Q {
  if (Object.keys(node).length === 1 && 'type' in node) {
    return node;
  }
  for (let key of ['every', 'any']) {
    if (Array.isArray(node[key])) {
      return {
        on,
        ...node,
        [key]: node[key].map((child: Q) => anchorFilter(child, node.on ?? on)),
      };
    }
  }
  if (node.not) {
    return { on, ...node, not: anchorFilter(node.not, node.on ?? on) };
  }
  return { on, ...node };
}

// The saved spelling of a query written in the newer one, where it has one:
// no top-level `type`, an `on` on every filter operator, field sort and
// collapse. Signal sorts (`blend`, `expression`, `boost`, `relevance`,
// `textRelevance`) and `exists`/`missing` have no saved spelling.
function hasSavedSpelling(typed: Q): boolean {
  let newerOnly = (node: unknown): boolean => {
    if (Array.isArray(node)) {
      return node.some(newerOnly);
    }
    if (!isObject(node)) {
      return false;
    }
    if (
      'blend' in node ||
      'boost' in node ||
      'relevance' in node ||
      'exists' in node ||
      node.by === 'textRelevance' ||
      (typeof node.missing === 'string' &&
        !['first', 'last'].includes(node.missing))
    ) {
      return true;
    }
    return Object.values(node).some(newerOnly);
  };
  return (
    !newerOnly(typed.filter) &&
    !newerOnly(typed.let) &&
    !(typed.sort ?? []).some((s: Q) => 'expression' in s || newerOnly(s))
  );
}

function anchored(typed: Q): Q | undefined {
  if (!hasSavedSpelling(typed)) {
    return undefined;
  }
  let { type, ...rest } = typed;
  let on = type as ResolvedCodeRef;
  if (!on || (isObject(rest.filter) && rest.filter.on)) {
    return undefined;
  }
  let out: Q = {};
  for (let [k, v] of Object.entries(rest)) {
    if (k === 'filter') {
      out.filter = anchorFilter(v, on);
    } else if (k === 'sort') {
      out.sort = v.map((s: Q) => {
        let entry = GENERAL_SORTS.includes(s.by) || s.on ? s : { on, ...s };
        // a window's comparison filter is a clause of its own
        return s.compare?.filter
          ? {
              ...entry,
              compare: {
                ...s.compare,
                filter: anchorFilter(s.compare.filter, on),
              },
            }
          : entry;
      });
    } else if (k === 'collapse') {
      out.collapse = typeof v === 'string' ? { by: v, on } : { on, ...v };
    } else if (k === 'let') {
      out.let = Object.fromEntries(
        Object.entries(v as Q).map(([name, binding]) => {
          let { type: from, filter, sort, ...more } = binding.from;
          return [
            name,
            {
              ...binding,
              from: {
                filter: filter ? anchorFilter(filter, from) : { type: from },
                ...(sort
                  ? {
                      sort: sort.map((s: Q) =>
                        GENERAL_SORTS.includes(s.by) ? s : { on: from, ...s },
                      ),
                    }
                  : {}),
                ...more,
              },
            },
          ];
        }),
      );
    } else {
      out[k] = v;
    }
  }
  if (!out.filter) {
    out = { filter: { type: on }, ...out };
  }
  return out;
}

const withoutSelect = ({ select: _select, ...rest }: Q): Q => rest;
const roundTrip = (payload: unknown) => JSON.parse(JSON.stringify(payload));

// A saved query as a client sends it: field paths through `item.`, anchors as
// `item.on`. `select` is the request's own member and rides along.
function wireOf(saved: Q): Q {
  return {
    ...searchEntryWireQueryFromQuery(withoutSelect(saved) as Query),
    ...(saved.select ? { select: saved.select } : {}),
  };
}

const parse = (payload: Q) =>
  parseSearchEntryQueryFromPayload(roundTrip(payload));

module(basename(import.meta.filename), function (hooks) {
  let engine: IndexQueryEngine;
  let virtualNetwork: VirtualNetwork;

  setupDB(hooks, {
    before: async (dbAdapter) => {
      if (!(await hasVectorIndex(dbAdapter))) {
        throw new Error(
          'query-declarative-order-integration-test needs the pgvector extension in the test Postgres, and this database does not have it. These tests do not skip.',
        );
      }
      virtualNetwork = new VirtualNetwork();
      engine = new IndexQueryEngine(
        dbAdapter,
        makeDefinitionLookup(),
        virtualNetwork,
      );
      let key = (type: ResolvedCodeRef) =>
        internalKeyFor(type, undefined, virtualNetwork);
      let batch = await new IndexWriter(dbAdapter).createBatch(
        realmURL,
        virtualNetwork,
        undefined,
        { splitPrerenderHtml: false },
      );
      let lookup = makeDefinitionLookup();
      let facetsOf = async (type: ResolvedCodeRef) =>
        await facetFieldSpecsOf(await lookup.lookupDefinition(type), (r) =>
          lookup.lookupDefinition(r as ResolvedCodeRef),
        );
      for (let row of ROWS) {
        let own = TYPE_REFS[row.types[0]];
        let facets = await facetsOf(own);
        let cardURL = new URL(row.url);
        let { title, blurb, maker, sku } = row.doc as Record<string, string>;
        await batch.updateEntry(cardURL, {
          type: 'instance',
          resource: {
            id: rri(cardURL.href),
            type: 'card',
            attributes: {},
            meta: { adoptsFrom: { module: rri(own.module), name: own.name } },
          },
          lastModified: Date.now(),
          resourceCreatedAt: Date.now(),
          searchData: {
            ...row.doc,
            ...(row.vector ? { embedding: vec(row.vector) } : {}),
            // What a render stamps for the declarations above: the words by
            // role, the words a typo may be corrected to, the text a pattern
            // reads, and the type-ahead text.
            [SEARCH_TEXT_KEY]: {
              A: maker ? `${title}\n${maker}` : title,
              ...(blurb ? { D: blurb } : {}),
              ...(maker ? { typos: maker } : {}),
              ...(sku ? { patterns: sku } : {}),
              facets,
            },
            _typeahead: title,
          },
          markdown: [`# ${title}`, maker, blurb].filter(Boolean).join('\n\n'),
          deps: new Set(),
          displayNames: [own.name],
          types: row.types.map((t) => key(TYPE_REFS[t])),
          isolatedHtml: `<div>${row.name}</div>`,
        });
      }
      await batch.done();
    },
  });

  async function ask(
    q: Q,
    opts: Record<string, unknown> = {},
  ): Promise<Answer> {
    let { results, meta } = await engine.search(realmURL, q as Query, opts, {
      kind: 'renderSet',
    });
    return answerOf(
      results.map((r) => r.url!),
      results as Record<string, unknown>[],
      meta,
    );
  }

  // A request as the realm answers it: parsed, then either searched or, with
  // a `select`, read as a table. A table reads its paths from the query's one
  // type anchor, as `RealmIndexQueryEngine.searchColumns` does.
  async function overWire(payload: Q): Promise<Answer> {
    let parsed = parse(payload);
    let opts = {};
    if (!parsed.columns) {
      return ask(parsed.itemQuery, opts);
    }
    let type =
      parsed.typeAnchors?.length === 1 ? parsed.typeAnchors[0] : undefined;
    if (!type) {
      throw new Error(
        'needs-type: select needs one type to read its paths from',
      );
    }
    let plans = await engine.planColumns(type, parsed.columns);
    let { rows, meta } = await engine.searchColumns(
      realmURL,
      parsed.itemQuery,
      opts,
      plans,
    );
    let answer = answerOf(
      rows.map((r) => String(r[0])),
      rows.map(() => ({})),
      meta,
    );
    answer.table = roundTrip({
      columns: ['id', ...parsed.columns.map((c) => c.name)],
      rows,
    });
    return answer;
  }

  // Each form a query is written and carried in. `spell` writes the newer
  // spelling in the form's own (or says it has none), `run` answers it, and
  // `reads` is the query the engine is handed once the form is lowered or
  // parsed.
  interface Form {
    name: string;
    spell(typed: Q): Q | undefined;
    run(spelled: Q): Promise<Answer>;
    reads(spelled: Q): unknown;
  }
  const FORMS: Form[] = [
    {
      name: 'newer spelling, lowered',
      spell: (typed) => typed,
      run: (q) => ask(lowerQuery(withoutSelect(q)).query),
      reads: (q) => lowerQuery(withoutSelect(q)).query,
    },
    {
      name: 'newer spelling over the wire',
      spell: (typed) => typed,
      run: (q) => overWire(q),
      reads: (q) => {
        let parsed = parse(q);
        return { query: parsed.itemQuery, columns: parsed.columns ?? null };
      },
    },
    {
      name: 'saved spelling',
      spell: anchored,
      run: (q) => ask(withoutSelect(q)),
      reads: () => null,
    },
    {
      name: 'saved spelling over the wire',
      spell: anchored,
      run: (q) => overWire(wireOf(q)),
      reads: (q) => {
        let parsed = parse(wireOf(q));
        return { query: parsed.itemQuery, columns: parsed.columns ?? null };
      },
    },
  ];

  // The invariant: however a query is written, in every form, it reads as the
  // same query and answers the same.
  async function everyOrderAnswersAlike(
    assert: Assert,
    typed: Q,
    opts: { narrows?: boolean; forms?: string[] } = {},
  ) {
    assert.timeout(300_000);
    let failures: string[] = [];
    let compared = 0;
    let formsRun = 0;
    for (let form of FORMS) {
      if (opts.forms && !opts.forms.includes(form.name)) {
        continue;
      }
      let base = form.spell(typed);
      if (!base) {
        continue;
      }
      formsRun++;
      let next = sequence(SEED);
      let baseAnswer = await form.run(base);
      let baseReads = canonText(form.reads(base));
      assert.notStrictEqual(
        baseAnswer.rows.length,
        0,
        `${form.name}: the query returns rows`,
      );
      if (opts.narrows !== false) {
        assert.true(
          Number((baseAnswer.page as any)?.total) < GADGETS.length,
          `${form.name}: and leaves some out`,
        );
      }
      for (let [label, variant] of variants(base, next)) {
        compared++;
        let written = JSON.stringify(variant);
        let reads: string;
        let answer: Answer;
        try {
          reads = canonText(form.reads(variant));
          answer = await form.run(variant);
        } catch (e: any) {
          failures.push(
            `${form.name}, ${label}: refused (${e.message}) | written: ${written}`,
          );
          continue;
        }
        if (reads !== baseReads) {
          failures.push(
            `${form.name}, ${label}: reads as another query: ${reads} | was: ${baseReads}`,
          );
        }
        let differs = differences(baseAnswer, answer);
        if (differs.length) {
          failures.push(
            `${form.name}, ${label}: ${differs.slice(0, 4).join('; ')} | written: ${written}`,
          );
        }
      }
    }
    assert.true(formsRun >= 2, 'at least two forms ran');
    assert.deepEqual(
      failures.slice(0, 6),
      [],
      `${failures.length} of ${compared} rewritings answered differently`,
    );
  }

  // ===== sets: generated filters ================================================

  module(
    'generated queries answer alike however they are written',
    function () {
      // QUERY_TESTS_EXTENDED=1 runs all six batches; a pull request runs the
      // first (each batch has its own fixed seed).
      const BATCHES = sized(1, 6);
      const PER_BATCH = 25;
      for (let batch = 0; batch < BATCHES; batch++) {
        test(`${PER_BATCH} generated filters with a sort, a page and two facets, five rewritings each, in three forms (batch ${batch + 1})`, async function (assert) {
          assert.timeout(300_000);
          let failures: string[] = [];
          let compared = 0;
          let nonEmpty = 0;
          for (let g of generate(PER_BATCH, 7919 * (batch + 1))) {
            let matched = sortedBy(
              GADGETS.filter((row) => holds(row, g.node)),
              g.sortBy,
              g.direction,
            );
            let offset = (g.page.number ?? 0) * g.page.size;
            let expectedRows = matched
              .slice(offset, offset + g.page.size)
              .map((row) => row.name);
            // A number facet counts its values when it asks for `stats`;
            // alone it would be range buckets.
            let facets = g.facets.map((by) =>
              by === 'sizes' ? { by, stats: true } : { by },
            );
            let saved: Q = {
              filter: asFilter(g.node, G),
              sort: [{ on: G, by: g.sortBy, direction: g.direction }, byURL],
              page: g.page,
              facets,
            };
            let typed: Q = {
              type: G,
              filter: asFilter(g.node),
              sort: [{ by: g.sortBy, direction: g.direction }, byURL],
              page: g.page,
              facets,
            };
            let forms: [
              string,
              Q,
              (q: Q) => Promise<Answer>,
              (q: Q) => unknown,
            ][] = [
              ['saved spelling', saved, (q) => ask(q), () => null],
              [
                'newer spelling, lowered',
                typed,
                (q) => ask(lowerQuery(q).query),
                (q) => lowerQuery(q).query,
              ],
              [
                'saved spelling over the wire',
                saved,
                (q) => overWire(wireOf(q)),
                (q) => parse(wireOf(q)).itemQuery,
              ],
            ];
            if (matched.length) nonEmpty++;
            let next = sequence(SEED + compared);
            for (let [form, base, run, reads] of forms) {
              let label = `${form}: ${JSON.stringify(base)}`;
              let answer = await run(base);
              let page = answer.page as any;
              // the plain evaluation first: the query means what it says
              if (
                JSON.stringify(answer.rows) !== JSON.stringify(expectedRows)
              ) {
                failures.push(
                  `rows ${JSON.stringify(answer.rows)}, expected ${JSON.stringify(expectedRows)} | ${label}`,
                );
              }
              let hasMore = offset + g.page.size < matched.length;
              if (page.hasMore !== undefined && page.hasMore !== hasMore) {
                failures.push(
                  `hasMore ${page.hasMore}, expected ${hasMore} | ${label}`,
                );
              }
              if (
                (g.page.total !== 'none' || !hasMore) &&
                page.total !== matched.length
              ) {
                failures.push(
                  `total ${page.total}, expected ${matched.length} | ${label}`,
                );
              }
              for (let by of g.facets) {
                let counted = Object.fromEntries(
                  (((answer.facets as any)?.[by] ?? []) as any[]).map((f) => [
                    String(f.value),
                    f.count,
                  ]),
                );
                if (canonText(counted) !== canonText(countsOf(matched, by))) {
                  failures.push(
                    `${by} counts ${JSON.stringify(counted)}, expected ${JSON.stringify(countsOf(matched, by))} | ${label}`,
                  );
                }
              }
              // then five rewritings of it
              let baseReads = canonText(reads(base));
              for (let i = 0; i < 5; i++) {
                compared++;
                let variant = permuted(base, next);
                let differs = differences(answer, await run(variant));
                if (differs.length) {
                  failures.push(
                    `${form}: ${differs.slice(0, 3).join('; ')} | written: ${JSON.stringify(variant)} | was: ${JSON.stringify(base)}`,
                  );
                }
                if (canonText(reads(variant)) !== baseReads) {
                  failures.push(
                    `${form}: reads as another query | written: ${JSON.stringify(variant)}`,
                  );
                }
              }
            }
          }
          assert.true(
            nonEmpty >= PER_BATCH / 2,
            `${nonEmpty} of ${PER_BATCH} generated queries match some row`,
          );
          assert.strictEqual(
            compared,
            PER_BATCH * 3 * 5,
            'every rewriting ran',
          );
          assert.deepEqual(
            failures.slice(0, 6),
            [],
            `${failures.length} checks failed over ${compared} rewritings`,
          );
        });
      }

      test('a query with no sort returns its rows in the same order however it is written', async function (assert) {
        // pins current behavior; rule not yet decided: the docs give a query
        // with no sort no order at all, so they do not say it may not move.
        assert.timeout(300_000);
        let failures: string[] = [];
        let next = sequence(SEED);
        for (let g of generate(20, 104729)) {
          let base: Q = {
            type: G,
            filter: asFilter(g.node),
            page: { size: 100 },
          };
          let answer = await ask(lowerQuery(base).query);
          for (let i = 0; i < 5; i++) {
            let variant = permuted(base, next);
            let differs = differences(
              answer,
              await ask(lowerQuery(variant).query),
            );
            if (differs.length) {
              failures.push(
                `${differs.slice(0, 2).join('; ')} | written: ${JSON.stringify(variant)} | was: ${JSON.stringify(base)}`,
              );
            }
          }
        }
        assert.deepEqual(failures.slice(0, 4), [], `${failures.length} moved`);
      });
    },
  );

  // ===== sets: one query per member of the language ==============================

  const skuOf = (name: string) => rowNamed(name).doc.sku as string;
  const strong = {
    from: { type: G, filter: { range: { rating: { gte: 4 } } } },
    select: 'sku',
  };
  const cheap = {
    from: {
      type: G,
      filter: { range: { price: { lt: 120 } } },
      sort: [{ by: 'price' }],
      page: { size: 15 },
    },
    select: 'sku',
  };
  const pivot = {
    from: { type: G, filter: { eq: { sku: skuOf('g05') } } },
    one: true,
  };
  const greenSizes = {
    from: { type: G, filter: { eq: { color: 'green' } } },
    select: 'sizes',
  };

  interface Case {
    name: string;
    typed: Q;
    // false when the query is meant to return every gadget
    narrows?: boolean;
  }
  const CASES: Case[] = [
    {
      name: 'one equality, one sort, one page',
      typed: {
        type: G,
        filter: { eq: { kind: 'home' } },
        sort: [{ by: 'price' }, byURL],
        page: { size: 10 },
      },
    },
    {
      name: 'a conjunction of four operators, three sort keys, two facets, a second page',
      typed: {
        type: G,
        filter: {
          every: [
            { range: { price: { gte: 30, lt: 240 } } },
            { in: { kind: ['home', 'office', 'garden'] } },
            { contains: { maker: 'o' } },
            { not: { eq: { color: 'red' } } },
          ],
        },
        sort: [{ by: 'rating', direction: 'desc' }, { by: 'price' }, byURL],
        facets: [{ by: 'kind' }, { by: 'tags' }],
        page: { number: 1, size: 4, total: 'exact' },
      },
    },
    {
      name: 'a disjunction three operators deep',
      typed: {
        type: G,
        filter: {
          any: [
            { eq: { color: 'red' } },
            {
              every: [
                { eq: { kind: 'office' } },
                { range: { rating: { gte: 3 } } },
                { not: { in: { tags: ['amber', 'blue'] } } },
              ],
            },
            {
              not: {
                any: [
                  { contains: { maker: 'a' } },
                  { range: { stock: { lt: 60 } } },
                ],
              },
            },
          ],
        },
        sort: [{ by: 'stock', direction: 'desc' }, byURL],
        page: { size: 50, total: 'exact' },
      },
    },
    {
      name: 'operators with two keys, a range with two bounds on each of two fields, an `in` on two fields',
      typed: {
        type: G,
        filter: {
          any: [
            { eq: { kind: 'home', color: 'blue' } },
            {
              range: {
                price: { gte: 40, lte: 120 },
                stock: { gt: 20, lt: 110 },
              },
            },
            { in: { kind: ['studio', 'garden'], color: ['amber', 'green'] } },
          ],
        },
        sort: [{ by: 'price' }, byURL],
        page: { size: 50 },
      },
    },
    {
      name: '`exists` and `missing`',
      typed: {
        type: G,
        filter: {
          any: [
            { every: [{ exists: 'color' }, { missing: 'kind' }] },
            { missing: 'rating' },
          ],
        },
        sort: [{ by: 'price' }, byURL],
        page: { size: 50 },
      },
    },
    {
      name: 'list fields under `every`, `not` and `any`',
      typed: {
        type: G,
        filter: {
          every: [
            { not: { eq: { tags: 'red' } } },
            { not: { range: { sizes: { gt: 20 } } } },
            { any: [{ in: { sizes: [5, 10] } }, { eq: { tags: 'green' } }] },
          ],
        },
        sort: [{ by: 'grams', direction: 'desc' }, byURL],
        page: { size: 50 },
      },
    },
    {
      name: '`matches` sorted by text relevance',
      typed: {
        type: G,
        filter: { matches: 'brass lamp' },
        sort: [{ by: 'textRelevance' }, byURL],
        page: { size: 10 },
      },
    },
    {
      name: '`matches` with `prefix`, beside a range',
      typed: {
        type: G,
        filter: {
          every: [
            { matches: 'desk lam', prefix: true },
            { range: { price: { gte: 20 } } },
          ],
        },
        sort: [{ by: 'price' }, byURL],
        page: { size: 20 },
      },
    },
    {
      name: '`matches` with `scope`, and `matches` with `fields`',
      typed: {
        type: G,
        filter: {
          any: [
            { matches: 'clock', scope: 'title' },
            { matches: 'halvorsen', fields: ['maker', 'title'] },
          ],
        },
        sort: [{ by: 'stock' }, byURL],
        page: { size: 50 },
      },
    },
    {
      name: '`matches` with `typos`',
      typed: {
        type: G,
        filter: { matches: 'halvorsn', typos: true },
        sort: [{ by: 'price', direction: 'desc' }, byURL],
        page: { size: 50 },
      },
    },
    {
      name: 'type-ahead (`matches`, `prefix`, `scope: title`)',
      typed: {
        type: G,
        filter: { prefix: true, scope: 'title', matches: 'bras des' },
        sort: [byURL],
        page: { size: 8 },
      },
    },
    {
      name: 'type-ahead with `typos`, beside an equality',
      typed: {
        type: G,
        filter: {
          every: [
            { prefix: true, scope: 'title', matches: 'bras', typos: true },
            { in: { kind: ['home', 'office'] } },
          ],
        },
        sort: [byURL],
        page: { size: 20 },
      },
    },
    {
      name: '`pattern` or `regex`',
      typed: {
        type: G,
        filter: {
          any: [
            { pattern: { sku: 'bra-*' } },
            { regex: { sku: '^OAK-00[0-2]' } },
          ],
        },
        sort: [{ by: 'price' }, byURL],
        page: { size: 50 },
      },
    },
    {
      name: 'a `near` filter and a `near` sort',
      typed: {
        type: G,
        filter: { near: { embedding: { to: TARGET, minSimilarity: 0.2 } } },
        sort: [{ by: 'embedding', near: TARGET }, byURL],
        page: { size: 12 },
      },
    },
    {
      name: 'a `near` filter with no threshold beside an equality, least similar first',
      typed: {
        type: G,
        filter: {
          every: [
            { in: { kind: ['home', 'garden'] } },
            { near: { embedding: { to: TARGET } } },
          ],
        },
        sort: [{ by: 'embedding', near: TARGET, direction: 'asc' }, byURL],
        page: { size: 20, total: 'exact' },
      },
    },
    {
      name: 'a `blend` of text, similarity, a field and a `boost`, with `k`',
      typed: {
        type: G,
        filter: {
          any: [
            { matches: 'lamp' },
            { near: { embedding: { to: TARGET, minSimilarity: 0.3 } } },
          ],
        },
        sort: [
          {
            blend: [
              { by: 'textRelevance' },
              { by: 'embedding', near: TARGET, weight: 2 },
              { by: 'stock', weight: 0.5 },
              { boost: { eq: { color: 'red' } }, weight: 1.5 },
            ],
            k: 40,
          },
          byURL,
        ],
        page: { size: 15 },
      },
    },
    {
      name: 'a `blend` of an expression, an ascending field, a negative weight and two boosts, explained',
      typed: {
        type: G,
        filter: { range: { price: { gte: 30 } } },
        sort: [
          {
            blend: [
              { expression: 'rating * 10 - price / 20', weight: 1.2 },
              { by: 'grams', direction: 'asc', weight: 0.8 },
              { by: 'stock', weight: -0.6 },
              { boost: { range: { rating: { gte: 4 } } }, weight: 0.9 },
              { boost: { in: { tags: ['red', 'blue'] } }, weight: -0.3 },
            ],
            method: 'rrf',
            k: 60,
            direction: 'desc',
          },
          byURL,
        ],
        explain: true,
        page: { size: 50, total: 'exact' },
      },
    },
    {
      name: 'an `expression` sort',
      typed: {
        type: G,
        filter: { range: { price: { lt: 200 } } },
        sort: [{ expression: 'rating / LN(price + 1)' }, byURL],
        page: { size: 12 },
      },
    },
    {
      name: 'a `relevance` sort with weights',
      typed: {
        type: G,
        filter: { matches: 'lamp' },
        sort: [
          { relevance: { text: 1, popularity: 0.3, quality: 0.2 } },
          byURL,
        ],
        page: { size: 10 },
      },
    },
    {
      name: 'a sort with `missing: first`',
      typed: {
        type: G,
        filter: { not: { eq: { tags: 'red' } } },
        sort: [{ by: 'rating', direction: 'desc', missing: 'first' }, byURL],
        page: { size: 15 },
      },
    },
    {
      name: 'a `collapse` keeping two of each group, with a facet',
      typed: {
        type: G,
        filter: { in: { color: ['red', 'green', 'blue'] } },
        sort: [{ by: 'price', direction: 'desc' }, byURL],
        collapse: { by: 'kind', keep: 2 },
        facets: [{ by: 'color' }],
        page: { size: 20 },
      },
    },
    {
      name: 'a `collapse` written as a path, paged',
      typed: {
        type: G,
        filter: { range: { stock: { gte: 10 } } },
        sort: [{ by: 'rating', direction: 'desc' }, { by: 'price' }, byURL],
        collapse: 'maker',
        page: { size: 3 },
      },
    },
    {
      name: 'a window smaller than the page',
      typed: {
        type: G,
        filter: { range: { price: { gte: 40 } } },
        sort: [
          {
            expression: 'rating * 2 - price / 50',
            top: 15,
            direction: 'asc',
          },
          { by: 'stock', direction: 'desc' },
          byURL,
        ],
        page: { size: 20 },
      },
    },
    {
      name: 'a window against the group the row is in',
      typed: {
        type: G,
        filter: { not: { eq: { color: 'amber' } } },
        sort: [
          {
            expression: 'price / stats.price.median',
            compare: { by: 'kind' },
            top: 30,
          },
          { by: 'price' },
          byURL,
        ],
        page: { size: 30 },
      },
    },
    {
      name: 'a window against a comparison set of its own',
      typed: {
        type: G,
        filter: { range: { stock: { lt: 120 } } },
        sort: [
          {
            expression: 'price - stats.price.avg',
            compare: {
              // a comparison filter names its own type: it is not among the
              // clauses the docs say inherit the query's
              filter: {
                on: G,
                any: [{ eq: { color: 'red' } }, { eq: { kind: 'home' } }],
              },
            },
            top: 25,
            direction: 'desc',
          },
          { by: 'stock' },
          byURL,
        ],
        page: { size: 25 },
      },
    },
    {
      name: 'a window against the look-alikes of each row',
      typed: {
        type: G,
        filter: { range: { price: { gte: 30 } } },
        sort: [
          {
            expression: '1 - price / stats.price.median',
            compare: { near: 'embedding', k: 5, minSimilarity: 0.1 },
            top: 20,
          },
          { by: 'price', direction: 'desc' },
          byURL,
        ],
        page: { size: 20 },
      },
    },
    {
      name: 'a `let` list read by an `in`',
      typed: {
        type: G,
        let: { $strong: strong },
        filter: {
          every: [
            { in: { sku: '$strong' } },
            { in: { kind: ['home', 'office', 'studio'] } },
          ],
        },
        sort: [{ by: 'price' }, byURL],
        page: { size: 50 },
      },
    },
    {
      name: 'three `let` bindings: two lists and one card, read by a filter and a `near` sort',
      typed: {
        type: G,
        let: { $strong: strong, $pivot: pivot, $cheap: cheap },
        filter: {
          every: [
            {
              any: [{ in: { sku: '$strong' } }, { in: { sku: '$cheap' } }],
            },
            { range: { price: { gt: '$pivot.price' } } },
            { not: { eq: { sku: '$pivot.sku' } } },
          ],
        },
        sort: [{ by: 'embedding', near: '$pivot.embedding' }, byURL],
        page: { size: 50 },
      },
    },
    {
      name: 'four `let` bindings, one read inside a `boost`',
      typed: {
        type: G,
        let: {
          $greenSizes: greenSizes,
          $cheap: cheap,
          $strong: strong,
          $pivot: pivot,
        },
        filter: {
          any: [
            { in: { sizes: '$greenSizes' } },
            { in: { sku: '$cheap' } },
            { eq: { maker: '$pivot.maker' } },
          ],
        },
        sort: [
          {
            blend: [
              { by: 'stock' },
              { boost: { in: { sku: '$strong' } }, weight: 2 },
            ],
          },
          byURL,
        ],
        page: { size: 50 },
      },
    },
    {
      name: 'eight facets using every option',
      typed: {
        type: G,
        filter: {
          every: [
            { in: { tags: ['red', 'blue'] } },
            { range: { price: { gte: 20 } } },
          ],
        },
        sort: [{ by: 'price' }, byURL],
        facets: [
          { by: 'kind', size: 2, order: 'value' },
          { by: 'tags', own: 'ignore' },
          { by: 'color', prefix: 'a', missing: true },
          {
            by: 'price',
            stats: true,
            ranges: [
              { to: 60 },
              { from: 60, to: 140 },
              { key: 'dear', from: 140 },
            ],
          },
          { by: 'listedAt', interval: 'month' },
          {
            by: 'maker',
            measure: { avg: 'price' },
            order: 'measure',
            missing: true,
            stats: true,
          },
          { by: 'sizes', stats: true },
          { by: 'rating', order: 'count', size: 3 },
        ],
        page: { size: 5 },
      },
    },
    {
      name: 'a page with `number`, `size` and `total: none`',
      typed: {
        type: G,
        filter: { range: { price: { gte: 30 } } },
        sort: [{ by: 'price' }, byURL],
        page: { total: 'none', size: 5, number: 2 },
      },
    },
    {
      name: 'a page with `total: capped`',
      typed: {
        type: G,
        filter: { range: { price: { gte: 30 } } },
        sort: [{ by: 'price' }, byURL],
        page: { number: 0, total: 'capped', size: 4 },
      },
    },
    {
      name: 'a page with `exactTotal`',
      typed: {
        type: G,
        filter: { matches: 'lamp' },
        sort: [{ by: 'price' }, byURL],
        page: { exactTotal: true, size: 7 },
      },
    },
    {
      name: 'relative dates on both sides of a range',
      typed: {
        type: G,
        filter: {
          any: [
            { range: { listedAt: { gte: 'now-200d', lt: 'now-20d' } } },
            {
              every: [
                { range: { listedAt: { lt: 'now-1y/d' } } },
                { range: { listedAt: { lte: 'now' } } },
              ],
            },
          ],
        },
        sort: [{ by: 'listedAt', direction: 'desc' }, byURL],
        page: { size: 50 },
      },
    },
    {
      name: 'a `select` table',
      typed: {
        type: G,
        filter: { range: { price: { lt: 150 } } },
        sort: [{ by: 'price', direction: 'desc' }, byURL],
        select: ['sku', 'price', { label: 'kind' }, 'tags', 'maker'],
        page: { size: 9 },
      },
    },
    {
      name: 'a `select` table of scores over a blended, collapsed query',
      typed: {
        type: G,
        filter: { range: { price: { gte: 20 } } },
        sort: [
          {
            blend: [
              { by: 'stock' },
              { by: 'grams', weight: 0.5 },
              { boost: { eq: { color: 'blue' } }, weight: 2 },
            ],
          },
          byURL,
        ],
        collapse: 'kind',
        select: ['sku', '_blendScore', '_collapseSize'],
        page: { size: 10 },
      },
      narrows: false,
    },
    {
      name: 'a filter anchored on another type than the one the query names',
      typed: {
        type: G,
        filter: { on: W, range: { torque: { gte: 3 } } },
        sort: [{ on: W, by: 'torque' }, byURL],
        page: { size: 10 },
      },
    },
    {
      name: 'every member at once',
      typed: {
        type: G,
        let: { $strong: strong, $pivot: pivot },
        filter: {
          every: [
            {
              any: [
                { in: { sku: '$strong' } },
                { matches: 'lamp' },
                { range: { price: { lt: '$pivot.price' } } },
              ],
            },
            { not: { eq: { color: 'amber' } } },
          ],
        },
        sort: [
          { expression: 'rating * 3 - price / 40', top: 10 },
          {
            blend: [
              { by: 'stock', weight: 1.5 },
              { by: 'embedding', near: TARGET },
              { boost: { eq: { kind: 'home' } }, weight: 0.7 },
            ],
          },
          byURL,
        ],
        collapse: { by: 'maker', keep: 3 },
        facets: [{ by: 'kind' }, { by: 'color', missing: true }],
        explain: true,
        page: { number: 0, size: 12, total: 'exact' },
      },
    },
  ];

  module(
    'one query per member of the language, in every written order',
    function () {
      for (let c of CASES) {
        test(`${c.name}: every rewriting, in every form, answers alike`, async function (assert) {
          await everyOrderAnswersAlike(assert, c.typed, { narrows: c.narrows });
        });
      }
    },
  );

  // ===== sequences: reordering these does change the answer ======================

  module('sequences: order is the meaning', function () {
    test('the sort list: the first key orders, the second only breaks its ties', async function (assert) {
      let byRating = { by: 'rating', direction: 'desc' };
      let byPrice = { by: 'price' };
      let run = async (sort: Q[]) =>
        (await ask(lowerQuery({ type: G, sort, page: { size: 100 } }).query))
          .rows;
      // rating has ties and price has none, so the two orders differ
      let ratingFirst = [...GADGETS]
        .sort((a, b) => {
          let x = a.doc.rating as number | null;
          let y = b.doc.rating as number | null;
          if (x !== y) {
            if (x == null) return 1;
            if (y == null) return -1;
            return y - x;
          }
          return (a.doc.price as number) - (b.doc.price as number);
        })
        .map((row) => row.name);
      let priceFirst = sortedBy(GADGETS, 'price', 'asc').map((row) => row.name);
      assert.notDeepEqual(
        ratingFirst,
        priceFirst,
        'the fixture tells them apart',
      );
      assert.deepEqual(await run([byRating, byPrice]), ratingFirst);
      assert.deepEqual(await run([byPrice, byRating]), priceFirst);
    });

    test('`select`: the columns of the table come in the order written, after `id`', async function (assert) {
      let row = rowNamed('g05');
      let table = async (select: unknown[]) =>
        (
          await overWire({
            type: G,
            filter: { eq: { sku: row.doc.sku } },
            select,
          })
        ).table!;
      let one = await table(['kind', 'price']);
      assert.deepEqual(one.columns, ['id', 'kind', 'price']);
      assert.deepEqual(
        one.rows.map((r) => r.slice(1)),
        [[row.doc.kind, row.doc.price]],
      );
      let other = await table(['price', 'kind']);
      assert.deepEqual(other.columns, ['id', 'price', 'kind']);
      assert.deepEqual(
        other.rows.map((r) => r.slice(1)),
        [[row.doc.price, row.doc.kind]],
      );
    });

    test('the `ranges` of a facet: the buckets come back in the order written', async function (assert) {
      // pins current behavior; rule not yet decided: the docs say what each
      // bucket counts and how it is labeled, not the order buckets return in.
      let under = GADGETS.filter(
        (row) => (row.doc.price as number) < 100,
      ).length;
      let over = GADGETS.length - under;
      let buckets = async (ranges: Q[]) =>
        (
          (
            await ask(
              lowerQuery({
                type: G,
                facets: [{ by: 'price', ranges }],
                page: { size: 1 },
              }).query,
            )
          ).facets as any
        ).price;
      assert.deepEqual(await buckets([{ to: 100 }, { from: 100 }]), [
        { value: '*-100', count: under },
        { value: '100-*', count: over },
      ]);
      assert.deepEqual(await buckets([{ from: 100 }, { to: 100 }]), [
        { value: '100-*', count: over },
        { value: '*-100', count: under },
      ]);
    });

    test('a quoted phrase in `matches`: the words must come in that order', async function (assert) {
      let run = async (matches: string) =>
        (
          await ask(
            lowerQuery({
              type: G,
              filter: { matches },
              page: { size: 100 },
            }).query,
          )
        ).rows.sort();
      let readingLight = namesWhere(
        (row) => row.doc.blurb === READING_LIGHT,
        GADGETS,
      );
      let lightReading = namesWhere(
        (row) => row.doc.blurb === LIGHT_READING,
        GADGETS,
      );
      if (!readingLight.length || !lightReading.length) {
        fixture('both blurbs must be in use');
      }
      assert.deepEqual(await run('"reading light"'), readingLight);
      assert.deepEqual(await run('"light reading"'), lightReading);
    });

    test('`matches` with `prefix`: only the last word is unfinished', async function (assert) {
      let run = async (matches: string) =>
        (
          await ask(
            lowerQuery({
              type: G,
              filter: { matches, prefix: true },
              page: { size: 100 },
            }).query,
          )
        ).rows.sort();
      // "lam" finishes as "lamp" when it is last; first, it is a whole word
      // no card holds.
      let deskLamps = namesWhere(
        (row) => textOf(row, 'title').endsWith('desk lamp'),
        GADGETS,
      );
      if (!deskLamps.length) {
        fixture('some gadget must be a desk lamp');
      }
      assert.deepEqual(await run('desk lam'), deskLamps);
      assert.deepEqual(await run('lam desk'), []);
    });
  });

  // ===== sets inside text ===========================================================

  module('words that are a set', function () {
    test('unquoted words in `matches`: either order finds the cards holding both', async function (assert) {
      let run = async (matches: string) =>
        (
          await ask(
            lowerQuery({
              type: G,
              filter: { matches },
              page: { size: 100 },
            }).query,
          )
        ).rows.sort();
      let brassLamps = namesWhere(
        (row) =>
          textOf(row, 'title').startsWith('Brass') &&
          textOf(row, 'title').endsWith('lamp'),
        GADGETS,
      );
      if (!brassLamps.length) {
        fixture('some gadget must be a brass lamp');
      }
      assert.deepEqual(await run('brass lamp'), brassLamps);
      assert.deepEqual(await run('lamp brass'), brassLamps);
    });

    test('type-ahead words: any order finds the same cards', async function (assert) {
      let run = async (typeahead: string) =>
        (
          await ask(
            lowerQuery({
              type: G,
              filter: { prefix: true, scope: 'title', matches: typeahead },
              page: { size: 100 },
            }).query,
          )
        ).rows.sort();
      // every typed word starts some word of the title
      let brassDesk = namesWhere(
        (row) =>
          textOf(row, 'title').startsWith('Brass') &&
          textOf(row, 'title').includes(' desk '),
        GADGETS,
      );
      if (!brassDesk.length) {
        fixture('some gadget must be a brass desk thing');
      }
      assert.deepEqual(await run('bras des'), brassDesk);
      assert.deepEqual(await run('des bras'), brassDesk);
    });
  });

  // ===== canonical form and signature ==================================================

  module('one query, one identity', function () {
    const SAVED: Q = {
      filter: {
        on: G,
        every: [
          { eq: { kind: 'home', color: 'red' } },
          {
            any: [{ eq: { color: 'red' } }, { in: { tags: ['red', 'blue'] } }],
          },
          { range: { price: { gte: 10, lt: 90 } } },
        ],
      },
      sort: [{ on: G, by: 'price', direction: 'desc' }],
      facets: [{ by: 'kind' }, { by: 'tags' }],
      page: { size: 10, number: 0 },
    };
    const signature = (q: Q) =>
      canonicalQuerySignature(q as Query, new VirtualNetwork());
    const cacheKey = (q: Q) =>
      JSON.stringify(normalizeQueryForSignature(q as Query));

    // Two spellings of one query should share a cache entry and be seen as
    // the same saved query.
    function sameIdentity(assert: Assert, a: Q, b: Q) {
      assert.strictEqual(
        signature(b),
        signature(a),
        `canonicalQuerySignature of ${JSON.stringify(b)} and of ${JSON.stringify(a)}`,
      );
      assert.strictEqual(
        cacheKey(b),
        cacheKey(a),
        `normalizeQueryForSignature of ${JSON.stringify(b)} and of ${JSON.stringify(a)}`,
      );
    }

    test('members and operator keys written in another order: the same signature', function (assert) {
      let next = sequence(SEED);
      for (let i = 0; i < 20; i++) {
        sameIdentity(assert, SAVED, permuted(SAVED, next, { lists: false }));
      }
    });

    test('the children of an `every` in another order: the same signature', function (assert) {
      let a = { on: G, eq: { kind: 'home' } };
      let b = { on: G, eq: { color: 'red' } };
      sameIdentity(
        assert,
        { filter: { every: [a, b] } },
        { filter: { every: [b, a] } },
      );
    });

    test('the children of an `any` in another order: the same signature', function (assert) {
      let a = { on: G, eq: { kind: 'home' } };
      let b = { on: G, eq: { color: 'red' } };
      sameIdentity(
        assert,
        { filter: { any: [a, b] } },
        { filter: { any: [b, a] } },
      );
    });

    test('the values of an `in` in another order: the same signature', function (assert) {
      sameIdentity(
        assert,
        { filter: { on: G, in: { kind: ['home', 'office'] } } },
        { filter: { on: G, in: { kind: ['office', 'home'] } } },
      );
    });

    test('the entries of `facets` in another order: the same signature', function (assert) {
      sameIdentity(
        assert,
        { filter: { type: G }, facets: [{ by: 'kind' }, { by: 'tags' }] },
        { filter: { type: G }, facets: [{ by: 'tags' }, { by: 'kind' }] },
      );
    });

    test('a sort list in another order is another query: another signature', function (assert) {
      let a = { on: G, by: 'rating' };
      let b = { on: G, by: 'price' };
      assert.notStrictEqual(
        signature({ filter: { type: G }, sort: [a, b] }),
        signature({ filter: { type: G }, sort: [b, a] }),
      );
    });

    test('type references made canonical: the same filter however it was written', async function (assert) {
      // a re-export spelling of Gadget, and a type nothing resolves
      let alias = ref(`${realm}re-export`, 'Gadget');
      let unknown = ref(`${realm}nowhere`, 'Nothing');
      let resolve = async (r: ResolvedCodeRef) =>
        r.module === unknown.module
          ? undefined
          : r.module === alias.module
            ? G
            : r;
      let filter: Q = {
        on: alias,
        every: [
          { type: alias },
          { on: G, eq: { kind: 'home', color: 'red' } },
          {
            any: [
              { on: alias, in: { tags: ['red', 'blue'] } },
              { not: { on: W, range: { torque: { gte: 3, lt: 9 } } } },
            ],
          },
        ],
      };
      let base = await canonicalizeFilterRefs(filter as Filter, resolve);
      assert.false(base.incomplete);
      assert.false(
        JSON.stringify(base.filter).includes('re-export'),
        'every alias is rewritten',
      );
      let next = sequence(SEED);
      for (let i = 0; i < 20; i++) {
        let variant = permuted(filter, next);
        let out = await canonicalizeFilterRefs(variant as Filter, resolve);
        assert.strictEqual(
          canonText(out.filter),
          canonText(base.filter),
          JSON.stringify(variant),
        );
        assert.false(out.incomplete);
      }
      let withUnknown = { every: [filter, { type: unknown }] };
      for (let order of allPermutations(withUnknown.every)) {
        let out = await canonicalizeFilterRefs(
          { every: order } as Filter,
          resolve,
        );
        assert.true(
          out.incomplete,
          'an unresolved type is reported in any order',
        );
      }
    });

    test('a type reference written name first lowers to the same query as module first', function (assert) {
      let nameFirst = { name: G.name, module: G.module };
      let lowered = (on: Q) =>
        lowerQuery({ type: G, filter: { on, eq: { kind: 'home' } } }).query;
      assert.strictEqual(canonText(lowered(nameFirst)), canonText(lowered(G)));
    });

    test('a type reference written name first returns the same rows as module first', async function (assert) {
      let nameFirst = { name: G.name, module: G.module };
      let rows = async (on: Q) =>
        (
          await ask(
            lowerQuery({
              type: G,
              filter: {
                every: [
                  { on, eq: { kind: 'home' } },
                  { on: G, range: { price: { gte: 30 } } },
                ],
              },
              page: { size: 100 },
            }).query,
          )
        ).rows.sort();
      let expected = namesWhere(
        (row) => row.doc.kind === 'home' && (row.doc.price as number) >= 30,
        GADGETS,
      );
      assert.notStrictEqual(expected.length, 0);
      assert.deepEqual(await rows(G), expected);
      assert.deepEqual(await rows(nameFirst), expected);
    });
  });

  // ===== traps ===========================================================================

  module('places where order could leak in', function () {
    const all = { size: 100, total: 'exact' };
    async function rowsOf(filter: Q): Promise<string[]> {
      return (await ask({ filter, page: all })).rows.sort();
    }
    // The rows a node selects, by the plain evaluation, over every row.
    const expected = (node: Node) => namesWhere((row) => holds(row, node));

    // Every order of a list of children, under `key`, must select `want`.
    async function everyOrderSelects(
      assert: Assert,
      key: 'every' | 'any',
      children: Q[],
      want: string[],
      wrap: (filter: Q) => Q = (filter) => filter,
    ) {
      assert.notStrictEqual(want.length, 0, 'the fixture has matches');
      assert.true(want.length < ROWS.length, 'and rows that do not match');
      for (let order of allPermutations(children.map((_, i) => i))) {
        let filter = wrap({ [key]: order.map((i) => children[i]) });
        assert.deepEqual(
          await rowsOf(filter),
          want,
          `children as ${order.join('')}: ${JSON.stringify(filter)}`,
        );
      }
    }

    test('a bare type, a filter on that type, a filter on another type and an unanchored filter: every order of the four selects the same rows', async function (assert) {
      assert.timeout(300_000);
      // the widgets that are home gadgets, turn hard enough, and say "brass"
      let want = namesWhere(
        (row) =>
          row.types.includes('Widget') &&
          row.doc.kind === 'home' &&
          (row.doc.torque as number) >= 3 &&
          textOf(row, 'title').startsWith('Brass'),
      );
      assert.deepEqual(want, ['w00', 'w04'], 'as the fixture was written');
      await everyOrderSelects(
        assert,
        'every',
        [
          { type: G },
          { on: G, eq: { kind: 'home' } },
          { on: W, range: { torque: { gte: 3 } } },
          { matches: 'brass' },
        ],
        want,
      );
    });

    test('two filters on one type, a bare type and a filter on its subtype: every order selects the same rows', async function (assert) {
      assert.timeout(300_000);
      let want = expected({
        op: 'every',
        of: [
          { op: 'isa', type: 'Gadget' },
          { op: 'not', of: { op: 'eq', field: 'kind', value: 'office' } },
          { op: 'isa', type: 'Widget' },
          { op: 'eq', field: 'kind', value: 'home' },
          {
            op: 'any',
            of: [
              { op: 'eq', field: 'color', value: 'red' },
              { op: 'range', field: 'torque', bounds: { gte: 7 } },
            ],
          },
        ],
      });
      assert.deepEqual(want, ['w00', 'w03'], 'as the fixture was written');
      await everyOrderSelects(
        assert,
        'every',
        [
          { type: G },
          { on: G, not: { eq: { kind: 'office' } } },
          { on: W, eq: { kind: 'home' } },
          {
            on: W,
            any: [{ eq: { color: 'red' } }, { range: { torque: { gte: 7 } } }],
          },
        ],
        want,
      );
    });

    test('a conjunction with repeated type anchors under `not`: every order selects the same rows', async function (assert) {
      // not (a widget, and home, and red): the gadgets that are not widgets
      // pass whatever they hold; a widget passes when it is known not to be
      // home or known not to be red.
      let inner: Node = {
        op: 'every',
        of: [
          { op: 'isa', type: 'Widget' },
          { op: 'eq', field: 'kind', value: 'home' },
          { op: 'eq', field: 'color', value: 'red' },
        ],
      };
      await everyOrderSelects(
        assert,
        'every',
        [
          { type: W },
          { on: W, eq: { kind: 'home' } },
          { on: G, eq: { color: 'red' } },
        ],
        expected({
          op: 'every',
          of: [
            { op: 'isa', type: 'Gadget' },
            { op: 'not', of: inner },
          ],
        }),
        (filter) => ({ on: G, not: filter }),
      );
    });

    test('an `any` of equalities on one field, as it folds into an `in` and in spellings that do not fold: the same rows', async function (assert) {
      let want = namesWhere(
        (row) => row.doc.kind === 'home' || row.doc.kind === 'office',
        GADGETS,
      );
      assert.notStrictEqual(want.length, 0);
      let home = { on: G, eq: { kind: 'home' } };
      let office = { on: G, eq: { kind: 'office' } };
      let spellings: Q[] = [
        // folds
        { any: [home, office] },
        { any: [office, home] },
        // the same branches, one written as an `in`: does not fold
        { any: [home, { on: G, in: { kind: ['office'] } }] },
        { any: [{ on: G, in: { kind: ['office'] } }, home] },
        // one anchor on the `any` instead of one on each branch: folds
        { on: G, any: [{ eq: { kind: 'home' } }, { eq: { kind: 'office' } }] },
        // mixed anchors: does not fold
        { on: G, any: [home, { eq: { kind: 'office' } }] },
        { on: G, any: [{ eq: { kind: 'office' } }, home] },
        // the `in` itself
        { on: G, in: { kind: ['office', 'home'] } },
      ];
      for (let filter of spellings) {
        assert.deepEqual(await rowsOf(filter), want, JSON.stringify(filter));
      }
    });

    test('an `any` of equalities on one field with a branch on another field between them: every order selects the same rows', async function (assert) {
      await everyOrderSelects(
        assert,
        'any',
        [
          { on: G, eq: { kind: 'home' } },
          { on: G, eq: { color: 'red' } },
          { on: G, eq: { kind: 'office' } },
        ],
        expected({
          op: 'every',
          of: [
            { op: 'isa', type: 'Gadget' },
            {
              op: 'any',
              of: [
                { op: 'in', field: 'kind', value: ['home', 'office'] },
                { op: 'eq', field: 'color', value: 'red' },
              ],
            },
          ],
        }),
      );
    });

    test('an `any` of "has no kind" and "is home": the same rows whether or not it folds', async function (assert) {
      // `eq: null` asks for the missing value, so this is the gadgets with
      // no kind and the home ones.
      let want = namesWhere(
        (row) => row.doc.kind == null || row.doc.kind === 'home',
        GADGETS,
      );
      assert.true(
        GADGETS.some((row) => row.doc.kind == null),
        'some gadget has no kind',
      );
      let none = { on: G, eq: { kind: null } };
      let home = { on: G, eq: { kind: 'home' } };
      let spellings: Q[] = [
        // two equalities on one field: folds into an `in`
        { any: [none, home] },
        { any: [home, none] },
        // does not fold
        { any: [none, { on: G, in: { kind: ['home'] } }] },
        { any: [{ on: G, in: { kind: ['home'] } }, none] },
      ];
      for (let filter of spellings) {
        assert.deepEqual(await rowsOf(filter), want, JSON.stringify(filter));
      }
    });

    test('the same child twice in an `every`, or in an `any`, is the same as once', async function (assert) {
      let home = { on: G, eq: { kind: 'home' } };
      let red = { on: G, eq: { color: 'red' } };
      let homeRows = namesWhere((row) => row.doc.kind === 'home', GADGETS);
      let homeAndRed = namesWhere(
        (row) => row.doc.kind === 'home' && row.doc.color === 'red',
        GADGETS,
      );
      let homeOrRed = namesWhere(
        (row) => row.doc.kind === 'home' || row.doc.color === 'red',
        GADGETS,
      );
      assert.notStrictEqual(homeAndRed.length, 0);
      assert.deepEqual(await rowsOf({ every: [home, home] }), homeRows);
      assert.deepEqual(await rowsOf({ any: [home, home] }), homeRows);
      for (let order of [
        [home, red, home],
        [home, home, red],
        [red, home, home],
      ]) {
        assert.deepEqual(await rowsOf({ every: order }), homeAndRed);
        assert.deepEqual(await rowsOf({ any: order }), homeOrRed);
      }
    });

    test('the same value twice in an `in` is the same as once', async function (assert) {
      let want = namesWhere(
        (row) => row.doc.kind === 'home' || row.doc.kind === 'studio',
        GADGETS,
      );
      for (let values of [
        ['home', 'studio'],
        ['home', 'home', 'studio'],
        ['studio', 'home', 'studio', 'home'],
      ]) {
        assert.deepEqual(await rowsOf({ on: G, in: { kind: values } }), want);
      }
      let tagged = namesWhere(
        (row) => (row.doc.tags as string[]).includes('red'),
        GADGETS,
      );
      assert.deepEqual(
        await rowsOf({ on: G, in: { tags: ['red', 'red'] } }),
        tagged,
        'on a list field',
      );
    });

    test('the same facet twice counts as it does once', async function (assert) {
      // pins current behavior; rule not yet decided: a facet comes back under
      // `meta.facets[by]`, so two with one `by` cannot both come back, and
      // the docs do not say whether the second is refused or dropped.
      let query = (facets: Q[]) =>
        lowerQuery({ type: G, facets, page: { size: 1 } }).query;
      let once = await ask(query([{ by: 'kind' }]));
      let twice = await ask(query([{ by: 'kind' }, { by: 'kind' }]));
      assert.deepEqual(
        Object.fromEntries(
          ((once.facets as any).kind as any[]).map((f) => [f.value, f.count]),
        ),
        countsOf(GADGETS, 'kind'),
        'once: the counts of the fixture',
      );
      assert.deepEqual(twice.facets, once.facets);
    });

    test('two facets on one field with different options: the answer does not depend on which is written first', async function (assert) {
      // One `by` holds one answer, so the two cannot both be honored. Which
      // of them wins must not be read off the order they were written in:
      // "no member means something different because of where it sits".
      let small = { by: 'kind', size: 1 };
      let whole = { by: 'kind', size: 50 };
      let outcome = async (facets: Q[]) => {
        try {
          let answer = await ask(
            lowerQuery({ type: G, facets, page: { size: 1 } }).query,
          );
          return { facets: answer.facets };
        } catch (e: any) {
          return { refused: e.code ?? e.message };
        }
      };
      assert.deepEqual(
        await outcome([whole, small]),
        await outcome([small, whole]),
      );
    });

    test('two `let` bindings that compute the same list read as one does', async function (assert) {
      let want = namesWhere(
        (row) => row.doc.rating != null && (row.doc.rating as number) >= 4,
        GADGETS,
      );
      assert.notStrictEqual(want.length, 0);
      let rows = async (q: Q) =>
        (await ask(lowerQuery({ ...q, page: all }).query)).rows.sort();
      assert.deepEqual(
        await rows({
          type: G,
          let: { $strong: strong },
          filter: { in: { sku: '$strong' } },
        }),
        want,
      );
      for (let names of [
        ['first', 'second'],
        ['second', 'first'],
      ]) {
        assert.deepEqual(
          await rows({
            type: G,
            let: Object.fromEntries(names.map((name) => [`$${name}`, strong])),
            filter: {
              any: [{ in: { sku: '$first' } }, { in: { sku: '$second' } }],
            },
          }),
          want,
          `declared as ${names.join(', ')}`,
        );
      }
    });

    test('a `let` binding cannot read another, whichever is declared first', async function (assert) {
      // "A binding's query cannot use another binding", so no order of
      // declaration can matter.
      let reader = {
        from: { type: G, filter: { in: { sku: '$source' } } },
        select: 'sku',
      };
      let source = strong;
      for (let bindings of [
        { $source: source, $reader: reader },
        { $reader: reader, $source: source },
      ]) {
        assert.throws(
          () =>
            parse({
              type: G,
              let: bindings,
              filter: { in: { sku: '$reader' } },
            }),
          /cannot use another binding/,
          `declared as ${Object.keys(bindings).join(', ')}`,
        );
      }
    });

    test('one `eq` with two keys, and an `every` of the two in either order: the same rows', async function (assert) {
      let want = namesWhere(
        (row) => row.doc.kind === 'home' && row.doc.color === 'red',
        GADGETS,
      );
      assert.notStrictEqual(want.length, 0);
      let kind = { on: G, eq: { kind: 'home' } };
      let color = { on: G, eq: { color: 'red' } };
      for (let filter of [
        { on: G, eq: { kind: 'home', color: 'red' } },
        { on: G, eq: { color: 'red', kind: 'home' } },
        { every: [kind, color] },
        { every: [color, kind] },
      ]) {
        assert.deepEqual(await rowsOf(filter), want, JSON.stringify(filter));
      }
    });

    test('`not` of one `eq` with two keys, and `not` of an `every` of the two in either order: the same rows', async function (assert) {
      // not (home and red) holds for a gadget known not to be home or known
      // not to be red, so one with no kind passes only if its color is known
      // and is not red.
      let want = expected({
        op: 'every',
        of: [
          { op: 'isa', type: 'Gadget' },
          {
            op: 'not',
            of: {
              op: 'every',
              of: [
                { op: 'eq', field: 'kind', value: 'home' },
                { op: 'eq', field: 'color', value: 'red' },
              ],
            },
          },
        ],
      });
      assert.notStrictEqual(want.length, 0);
      for (let inner of [
        { eq: { kind: 'home', color: 'red' } },
        { eq: { color: 'red', kind: 'home' } },
        { every: [{ eq: { kind: 'home' } }, { eq: { color: 'red' } }] },
        { every: [{ eq: { color: 'red' } }, { eq: { kind: 'home' } }] },
      ]) {
        let filter = { on: G, not: inner };
        assert.deepEqual(await rowsOf(filter), want, JSON.stringify(filter));
      }
    });

    test('`not` around a conjunction, and around a disjunction: every order of the children selects the same rows', async function (assert) {
      let children: Node[] = [
        { op: 'eq', field: 'kind', value: 'home' },
        { op: 'range', field: 'price', bounds: { gte: 60, lt: 200 } },
        { op: 'in', field: 'tags', value: ['red', 'green'] },
        { op: 'contains', field: 'maker', value: 'o' },
      ];
      for (let op of ['every', 'any'] as const) {
        await everyOrderSelects(
          assert,
          op,
          children.map((child) => asFilter(child)),
          expected({
            op: 'every',
            of: [
              { op: 'isa', type: 'Gadget' },
              { op: 'not', of: { op, of: children } },
            ],
          }),
          (filter) => ({ on: G, not: filter }),
        );
      }
    });

    // --- a blend's signals ---------------------------------------------------

    const K = 60;
    interface Signal {
      name: string;
      entry: Q;
      weight: number;
      // each card's place in this signal, best first, for the cards that
      // have a value; a boost puts every match in first place
      rank: Map<string, number>;
    }
    function ranked(field: string, direction: 'asc' | 'desc') {
      let valued = GADGETS.filter((row) => row.doc[field] != null);
      let values = valued.map((row) => row.doc[field]);
      if (new Set(values).size !== values.length) {
        fixture(`${field} must have no ties, so every rank is certain`);
      }
      valued.sort((a, b) =>
        direction === 'asc'
          ? (a.doc[field] as number) - (b.doc[field] as number)
          : (b.doc[field] as number) - (a.doc[field] as number),
      );
      return new Map(valued.map((row, i) => [row.name, i + 1]));
    }
    // Highest value first unless the entry says `asc`; a card with no value
    // gets nothing from the signal; every match of a boost ties for first.
    const SIGNALS: Signal[] = [
      {
        name: 'price',
        entry: { by: 'price' },
        weight: 1,
        rank: ranked('price', 'desc'),
      },
      {
        name: 'stock',
        entry: { by: 'stock', direction: 'asc', weight: 0.7 },
        weight: 0.7,
        rank: ranked('stock', 'asc'),
      },
      {
        name: 'grams',
        entry: { by: 'grams', weight: 1.6 },
        weight: 1.6,
        rank: ranked('grams', 'desc'),
      },
      {
        name: 'when',
        entry: { boost: { eq: { color: 'red' } }, weight: 1.3 },
        weight: 1.3,
        rank: new Map(
          GADGETS.filter((row) => row.doc.color === 'red').map((row) => [
            row.name,
            1,
          ]),
        ),
      },
    ];
    // sum(weight / (k + rank)) over the signals the card has a value for
    function fused() {
      let scored = GADGETS.map((row) => ({
        name: row.name,
        score: SIGNALS.reduce(
          (sum, s) =>
            s.rank.has(row.name)
              ? sum + s.weight / (K + s.rank.get(row.name)!)
              : sum,
          0,
        ),
      })).sort((a, b) => b.score - a.score);
      scored.forEach((row, i) => {
        if (i > 0 && scored[i - 1].score - row.score < 1e-7) {
          fixture(
            `${scored[i - 1].name} and ${row.name} fuse to the same score`,
          );
        }
      });
      return scored;
    }

    test('the four signals of a blend in every order: the same rows in the same order with the same scores', async function (assert) {
      assert.timeout(300_000);
      let want = fused();
      assert.true(
        SIGNALS[2].rank.size < GADGETS.length,
        'some gadget has no value for one signal',
      );
      for (let order of allPermutations(SIGNALS)) {
        let answer = await ask(
          lowerQuery({
            type: G,
            sort: [{ blend: order.map((s) => s.entry) }],
            page: all,
          }).query,
        );
        let label = `signals as ${order.map((s) => s.name).join(', ')}`;
        assert.deepEqual(
          answer.rows,
          want.map((row) => row.name),
          `${label}: rows in fused order`,
        );
        let off = want.filter(
          (row) =>
            Math.abs(
              (answer.scores[row.name]?._blendScore ?? NaN) - row.score,
            ) > 1e-9,
        );
        assert.deepEqual(off, [], `${label}: each row's score`);
      }
    });

    test('`explain` gives each signal the same rank and share in every order of the blend', async function (assert) {
      assert.timeout(300_000);
      let want = fused();
      for (let order of allPermutations(SIGNALS)) {
        let { results } = await engine.search(
          realmURL,
          lowerQuery({
            type: G,
            sort: [{ blend: order.map((s) => s.entry) }],
            explain: true,
            page: all,
          }).query as Query,
          {},
          { kind: 'renderSet' },
        );
        let label = `signals as ${order.map((s) => s.name).join(', ')}`;
        let off: string[] = [];
        for (let r of results as any[]) {
          let name = nameOf(r.url);
          let explained = r._explain;
          let score = want.find((row) => row.name === name)!.score;
          if (Math.abs(Number(explained.score) - score) > 1e-9) {
            off.push(`${name}: score ${explained.score}, expected ${score}`);
          }
          for (let s of SIGNALS) {
            let got = explained.signals.find((x: any) => x.signal === s.name);
            let rank = s.rank.get(name) ?? null;
            let share = rank == null ? 0 : s.weight / (K + rank);
            if (
              !got ||
              got.rank !== rank ||
              Math.abs(Number(got.contribution) - share) > 1e-9
            ) {
              off.push(
                `${name}, ${s.name}: ${JSON.stringify(got)}, expected rank ${rank} and contribution ${share}`,
              );
            }
          }
        }
        assert.deepEqual(off.slice(0, 5), [], label);
      }
    });

    // --- members where JSON allows them --------------------------------------

    test('a request written with its page first, its filter after and its type last answers as the usual order does', async function (assert) {
      let usual =
        '{"type":TYPE,"filter":{"every":[{"eq":{"kind":"home"}},{"range":{"price":{"gte":30}}}]},"sort":[{"by":"price","direction":"desc"}],"facets":[{"by":"color"}],"page":{"size":5,"number":1}}';
      let unusual =
        '{"page":{"number":1,"size":5},"facets":[{"by":"color"}],"sort":[{"direction":"desc","by":"price"}],"filter":{"every":[{"range":{"price":{"gte":30}}},{"eq":{"kind":"home"}}]},"type":TYPE}';
      let read = (text: string) =>
        JSON.parse(text.replace('TYPE', JSON.stringify(G)));
      let matched = sortedBy(
        GADGETS.filter(
          (row) => row.doc.kind === 'home' && (row.doc.price as number) >= 30,
        ),
        'price',
        'desc',
      );
      let want = matched.slice(5, 10).map((row) => row.name);
      assert.notStrictEqual(want.length, 0, 'the second page has rows');
      for (let text of [usual, unusual]) {
        for (let [form, answer] of [
          ['lowered', await ask(lowerQuery(read(text)).query)],
          ['over the wire', await overWire(read(text))],
        ] as const) {
          assert.deepEqual(answer.rows, want, `${form}: ${text}`);
          assert.strictEqual((answer.page as any).total, matched.length);
          assert.deepEqual(
            Object.fromEntries(
              ((answer.facets as any).color as any[]).map((f) => [
                f.value,
                f.count,
              ]),
            ),
            countsOf(matched, 'color'),
            `${form}: color counts`,
          );
        }
      }
    });

    // --- what reads "the query's type" off a conjunction ---------------------

    test('a `select` over a conjunction anchored on two types reads its columns the same whichever branch is written first', async function (assert) {
      // A table reads its paths from the query's type. With no top-level
      // `type`, that is the filter's anchor, and an `every` is a set: which
      // branch is written first must not decide whether `torque` is a column.
      let onWidget = { 'item.on': W, range: { 'item.torque': { gte: 3 } } };
      let onGadget = { 'item.on': G, eq: { 'item.kind': 'home' } };
      let outcome = async (every: Q[]) => {
        try {
          let answer = await overWire({
            filter: { every },
            sort: [{ by: 'item.torque', 'item.on': W }],
            select: ['torque', 'kind'],
          });
          return { table: answer.table!.rows.map((r) => r.slice(1)) };
        } catch (e: any) {
          return { refused: e.code ?? e.message };
        }
      };
      let widgetFirst = await outcome([onWidget, onGadget]);
      let gadgetFirst = await outcome([onGadget, onWidget]);
      assert.deepEqual(gadgetFirst, widgetFirst);
    });

    test('facets and a collapse over a conjunction anchored on two types answer the same whichever branch is written first', async function (assert) {
      let onWidget = { on: W, range: { torque: { gte: 3 } } };
      let onGadget = { on: G, in: { kind: ['home', 'office', 'garden'] } };
      let outcome = async (every: Q[]) => {
        try {
          let answer = await ask({
            filter: { every },
            sort: [{ on: W, by: 'torque' }],
            facets: [{ by: 'torque' }, { by: 'kind' }],
            collapse: 'kind',
            page: all,
          });
          return {
            rows: answer.rows,
            facets: answer.facets,
            page: answer.page,
            scores: answer.scores,
          };
        } catch (e: any) {
          return { refused: e.code ?? e.message };
        }
      };
      let widgetFirst = await outcome([onWidget, onGadget]);
      let gadgetFirst = await outcome([onGadget, onWidget]);
      assert.deepEqual(gadgetFirst, widgetFirst);
    });
  });
});
