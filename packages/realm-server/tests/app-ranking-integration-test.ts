import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  SEARCH_TEXT_KEY,
  VectorSerializer,
  VirtualNetwork,
  hasVectorIndex,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { DEFAULT_RRF_K } from '@cardstack/runtime-common/query';
import { lowerQuery } from '@cardstack/runtime-common/query-syntax';
import {
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common/search-entry';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';
import { withFacetFields } from './helpers/facet-fields.ts';

// Ranking as apps ask for it, in the combinations they send together: a
// vector sort or a fused ranking beside filters, facets, a collapse, paging,
// bindings and a table of values. A video library is the model for the
// semantic searches (the Post and Video cards here), a shop for the faceted
// ones (the Product cards).
//
// Every expectation is worked out in this file from the fixture: cosine
// similarity over the stored vectors, reciprocal rank fusion as
// docs/search.md states it, a plain filter, a comparator. None is read back
// from the engine. Where the docs leave an order open (ties inside a signal,
// the order of text relevance, cards with no vector among themselves) the
// fixture keeps the case from arising or the test asserts only the part the
// docs give; `fixture(...)` throws when a change to the fixture lets such a
// case in.
//
// An intent is written the way a query saved in a realm writes it (an `on`
// anchor on every clause) where that spelling exists, and in the newer one (a
// top-level `type`, bare clauses). Each runs in every form it has: as saved,
// lowered from the newer spelling, and over the search wire in both spellings
// and with `item.` paths, as a client sends it and a server reads it back.
//
// These need pgvector in the test Postgres, and fail without it.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const refs = {
  string: ref('@cardstack/base/string', 'default'),
  number: ref('@cardstack/base/number', 'default'),
  boolean: ref('@cardstack/base/boolean', 'default'),
  vector: ref('@cardstack/base/vector', 'default'),
};
const productRef = ref(`${testRealm}product`, 'Product');
const postRef = ref(`${testRealm}post`, 'Post');
// A Video is a Post: its rows carry both types.
const videoRef = ref(`${testRealm}post`, 'Video');

type Kind = 'string' | 'number' | 'boolean' | 'strings' | 'vector';
type Value = string | number | boolean | string[] | null;
type Doc = Record<string, Value>;
type Q = Record<string, any>;

interface Row {
  name: string;
  type: 'Product' | 'Post' | 'Video';
  doc: Doc;
  // Four int8 components, the largest of them 127 or -127, so the stored
  // vector is these numbers and a cosine computed here is the one stored.
  vector: number[] | null;
  // The words `matches` can find on the card.
  text: string;
}

function fixture(message: string): never {
  throw new Error(`fixture: ${message}`);
}

function definitionOf(
  codeRef: ResolvedCodeRef,
  fields: Record<string, Kind>,
  search: Record<string, Record<string, unknown>> = {},
): Definition {
  let names = Object.keys(fields);
  return {
    type: 'card-def',
    codeRef,
    displayName: codeRef.name,
    fields: Object.fromEntries(names.map((n, i) => [n, `f${i}`])),
    fieldDefs: Object.fromEntries(
      names.map((n, i) => {
        let kind = fields[n];
        return [
          `f${i}`,
          {
            type: kind === 'strings' ? 'containsMany' : 'contains',
            isPrimitive: true,
            isComputed: false,
            fieldOrCard:
              kind === 'strings'
                ? refs.string
                : refs[kind as keyof typeof refs],
            ...(kind === 'number' || kind === 'boolean' || kind === 'vector'
              ? { serializerName: kind }
              : {}),
            ...(search[n] ? { search: search[n] } : {}),
          },
        ];
      }),
    ),
  } as Definition;
}

// --- the shop ---------------------------------------------------------------

const productFields: Record<string, Kind> = {
  id: 'string',
  title: 'string',
  blurb: 'string',
  department: 'string',
  kind: 'string',
  brand: 'string',
  price: 'number',
  rating: 'number',
  views: 'number',
  inStock: 'boolean',
  colors: 'strings',
  embedding: 'vector',
};

// What the shop declares: the words of the title outrank the blurb's, a
// misspelled brand still finds it, and views and rating are its popularity
// and quality signals.
// The shop's sidebar counts brand, price, rating, stock and colors, so
// those are declared facets.
const productSearch = {
  title: { role: 'title' },
  blurb: { role: 'body' },
  brand: { typos: true, facet: true },
  views: { rank: 'popularity' },
  rating: { rank: 'quality', facet: true },
  price: { facet: true },
  inStock: { facet: true },
  colors: { facet: true },
};
// The feed counts its posts by topic and tag.
const postSearch = {
  topic: { facet: true },
  tags: { facet: true },
};

const product = (
  title: string,
  blurb: string,
  department: string,
  kind: string,
  brand: string | null,
  price: number,
  rating: number | null,
  views: number,
  inStock: boolean,
  colors: string[],
  vector: number[] | null,
) => ({
  doc: {
    title,
    blurb,
    department,
    kind,
    brand,
    price,
    rating,
    views,
    inStock,
    colors,
  } as Doc,
  vector,
  text: `${title} ${blurb}`,
});

// Prices and views are all different, and so are the ratings that are set,
// so no ranking signal ties. Three products have no vector and two no
// rating. `ottoman` is built to sit at cosine 0.5 from the first axis:
// 127·127 / (254·127).
// prettier-ignore
const PRODUCTS: Record<string, ReturnType<typeof product>> = {
  sofa:       product('Harbor sofa',       'three seat sofa in linen',          'Living', 'Sofa',  'Arlo',   899, 4.6,  5200, true,  ['grey', 'blue'],   [127, 12, 5, 30]),
  loveseat:   product('Harbor loveseat',   'two seat sofa in linen',            'Living', 'Sofa',  'Arlo',   649, 4.1,  1800, true,  ['grey'],           [127, 30, -8, 44]),
  armchair:   product('Walnut armchair',   'reading chair with a walnut frame', 'Living', 'Chair', 'Birch',  349, 4.8,  3100, true,  ['green', 'grey'],  [90, 127, 10, 5]),
  sideTable:  product('Walnut side table', 'small table for a lamp',            'Living', 'Table', 'Birch',   89, 3.9,   900, false, ['oak'],            [20, 127, 60, -15]),
  floorLamp:  product('Brass floor lamp',  'tall lamp with a linen shade',      'Living', 'Lamp',  'Cinder', 145, 4.3,  2400, true,  ['black', 'brass'], [10, 40, 127, 20]),
  rug:        product('Wool rug',          'flat weave rug',                    'Living', 'Rug',   null,     120, null,  300, true,  ['blue', 'white'],  null),
  ottoman:    product('Linen ottoman',     'footstool with walnut legs',        'Living', 'Stool', 'Dune',    75, 3.5,   450, true,  ['grey'],           [127, 127, 127, 127]),
  mirror:     product('Brass mirror',      'round wall mirror',                 'Living', 'Decor', 'Cinder', 110, 3.6,   700, true,  ['brass'],          null),
  desk:       product('Walnut desk',       'writing desk with a brass rail',    'Office', 'Table', 'Birch',  279, 4.4,  2700, true,  ['oak', 'white'],   [75, 127, -30, 10]),
  taskChair:  product('Task chair',        'adjustable office chair',           'Office', 'Chair', 'Cinder', 199, 4.7,  4100, true,  ['black'],          [127, -20, 40, 10]),
  monitorArm: product('Monitor arm',       'clamps to a desk',                  'Office', 'Mount', 'Dune',    49, 3.2,   650, true,  ['black'],          null),
  bookcase:   product('Oak bookcase',      'five shelves with brass pins',      'Office', 'Shelf', 'Arlo',   159, 4.0,  1200, false, ['white', 'oak'],   [-127, 10, 20, 5]),
  deskLamp:   product('Brass desk lamp',   'small lamp for a desk',             'Office', 'Lamp',  'Cinder',  35, 4.5,  1500, true,  ['white', 'brass'], [15, 30, 127, -10]),
  footrest:   product('Footrest',          'tilting footrest',                  'Office', 'Stool', null,      29, 2.8,   200, false, [],                 [0, -127, 0, 0]),
  planter:    product('Brass planter',     'for a balcony',                     'Garden', 'Decor', 'Dune',    59, 4.2,  1000, true,  ['brass', 'green'], [30, 20, 10, 127]),
  bench:      product('Garden bench',      'walnut slats',                      'Garden', 'Seat',  'Arlo',   229, null,  800, true,  ['oak'],            [100, 100, 20, 127]),
};

// --- the video library ------------------------------------------------------

const postFields: Record<string, Kind> = {
  id: 'string',
  uri: 'string',
  author: 'string',
  topic: 'string',
  kind: 'string',
  month: 'number',
  likes: 'number',
  score: 'number',
  postedAt: 'number',
  flagged: 'boolean',
  tags: 'strings',
  embedding: 'vector',
};

const DAY = 86_400;
const NOW = 1_780_000_000;

const post = (
  author: string | null,
  topic: string,
  kind: 'post' | 'reply' | 'repost' | 'video',
  month: number,
  likes: number,
  score: number | null,
  ageDays: number,
  flagged: boolean,
  tags: string[],
  vector: number[] | null,
  text: string,
) => ({
  doc: {
    author,
    topic,
    kind,
    month,
    likes,
    score,
    postedAt: NOW - Math.round(ageDays * DAY),
    flagged,
    tags,
  } as Doc,
  vector,
  text,
});

// Likes and ages are all different, and so are the scores that are set.
// Three posts have no vector, three no score, two no author. The four whose
// kind is `video` are Videos.
// prettier-ignore
const POSTS: Record<string, ReturnType<typeof post>> = {
  p01: post('ada',   'db',      'post',   202609,   40, 71,   0.2,  false, ['databases', 'postgres'], [127, 20, 10, 0],    'tuning a postgres index'),
  p02: post('ada',   'db',      'post',   202608,  310, 88,   3,    false, ['databases'],             [127, 60, -10, 15],  'why a vector index beats a scan'),
  p03: post('ada',   'ai',      'reply',  202609,   12, null, 0.5,  true,  ['ai'],                    [10, 127, 30, 5],    'thanks for the pasta recipe'),
  p04: post('ada',   'ai',      'video',  202607,    9, 35,   1,    false, ['ai', 'search'],          [100, 127, 0, 20],   'a talk on vector search'),
  p05: post('brook', 'cooking', 'post',   202609,  950, 93,   0.1,  false, ['cooking', 'ai'],         [0, 20, 127, 10],    'weeknight pasta recipe'),
  p06: post('brook', 'cooking', 'post',   202605,   80, 52,   9,    true,  ['cooking', 'baking'],     [5, 10, 127, 60],    'sourdough notes'),
  p07: post('brook', 'db',      'reply',  202608,   25, 44,   2,    false, ['databases'],             null,                'postgres or sqlite'),
  p08: post('cy',    'ai',      'post',   202609, 1000, 97,   0.3,  false, ['ai', 'databases'],       [127, 127, 20, 0],   'embedding text with a vector model'),
  p09: post('cy',    'ai',      'video',  202606,  140, 60,   6,    false, ['ai', 'search'],          [60, 127, 40, -20],  'recipe for a tiny model'),
  p10: post('cy',    'cooking', 'post',   202605,   64, null, 0.8,  false, ['cooking', 'ai'],         [20, 90, 127, 0],    'a pasta shape classifier'),
  p11: post('dee',   'db',      'video',  202604,  520, 81,   12,   false, ['databases', 'postgres'], [127, 40, 5, 30],    'postgres vector index internals'),
  p12: post('dee',   'travel',  'post',   202609,    7, 18,   0.05, false, ['travel'],                [-20, 10, 30, 127],  'trains across the alps'),
  p13: post('eli',   'travel',  'video',  202607,   33, 27,   4,    false, ['travel'],                null,                'a harbor at dawn'),
  p14: post('fay',   'db',      'repost', 202606,    3, 9,    7,    false, ['postgres'],              [127, 5, 0, -40],    'postgres release notes'),
  p15: post(null,    'ai',      'post',   202608,   56, 66,   1.5,  false, ['ai', 'search'],          [80, 127, -40, 10],  'a vector index of model papers'),
  p16: post(null,    'travel',  'post',   202603,   18, null, 20,   false, [],                        null,                'packing list'),
};

const idOf = (row: Pick<Row, 'name' | 'type'>) =>
  `${testRealm}${row.type === 'Product' ? 'Product' : 'Post'}/${row.name}`;

const ROWS: Row[] = [
  ...Object.entries(PRODUCTS).map(
    ([name, p]): Row => ({ name, type: 'Product', ...p }),
  ),
  ...Object.entries(POSTS).map(
    ([name, p]): Row => ({
      name,
      type: p.doc.kind === 'video' ? 'Video' : 'Post',
      ...p,
      doc: { uri: `at://feed/${name}`, ...p.doc },
    }),
  ),
];
const products = () => ROWS.filter((r) => r.type === 'Product');
// Every Post, the Videos among them.
const posts = () => ROWS.filter((r) => r.type !== 'Product');
const row = (name: string) =>
  ROWS.find((r) => r.name === name) ?? fixture(`no row named ${name}`);

// Targets a query compares with. Like the stored vectors they are int8
// already, so they are the same vector however a reader encodes them.
const AXIS = [127, 0, 0, 0];
const TASTE = [127, 64, -20, 40];
const AWAY = [-30, 127, 50, 10];
const MEANING = [127, 90, 10, 20];

// --- reading the fixture ----------------------------------------------------

const num = (v: Value) => v as number;
const list = (v: Value) => v as string[];

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

const wordsOf = (r: Row) => r.text.toLowerCase().split(/[^a-z]+/);
// Every query word here is its own stem and appears on the cards as written.
const has = (r: Row, word: string) => wordsOf(r).includes(word);
const hasPhrase = (r: Row, phrase: string) =>
  ` ${wordsOf(r).join(' ')} `.includes(` ${phrase} `);

// The rows every clause keeps. Each clause has to turn away a row the others
// keep, so a clause the engine dropped would show.
function admit(rows: Row[], clauses: ((r: Row) => boolean)[]): Row[] {
  let kept = rows.filter((r) => clauses.every((c) => c(r)));
  clauses.forEach((_, i) => {
    let without = rows.filter((r) => clauses.every((c, j) => j === i || c(r)));
    if (without.length === kept.length) {
      fixture(`clause ${i} turns away no row the other clauses keep`);
    }
  });
  if (kept.length === 0) {
    fixture('no row matches');
  }
  return kept;
}

// Most similar first, the rows that have a vector only.
function nearest(rows: Row[], target: number[]) {
  let ranked = rows
    .filter((r) => r.vector)
    .map((r) => ({ name: r.name, similarity: cosine(r.vector!, target) }))
    .sort((a, b) => b.similarity - a.similarity);
  ranked.forEach((r, i) => {
    if (i > 0 && ranked[i - 1].similarity - r.similarity < 1e-6) {
      fixture(`${ranked[i - 1].name} and ${r.name} are equally near`);
    }
  });
  return ranked;
}
const withoutVector = (rows: Row[]) =>
  rows
    .filter((r) => !r.vector)
    .map((r) => r.name)
    .sort();

// One signal of a fused ranking, as the oracle reads it.
type Signal =
  | { near: number[]; weight?: number }
  | { by: string; direction?: 'asc' | 'desc'; weight?: number }
  | { boost: (r: Row) => boolean; weight?: number };

// Reciprocal rank fusion as docs/search.md gives it: a card scores
// sum(weight / (k + rank)) over the signals it has a value for, each signal
// ranked best first over every row the filter admits. A row with no value
// gets nothing from that signal. A negative weight ranks the signal the other
// way around with the weight's size. A boost puts every match first, so each
// gains weight / (k + 1); with a negative weight the rows that do not match
// gain it.
function contributions(admitted: Row[], signals: Signal[], k = DEFAULT_RRF_K) {
  let scores = new Map(admitted.map((r) => [r.name, 0]));
  let add = (r: Row, amount: number) =>
    scores.set(r.name, scores.get(r.name)! + amount);
  for (let signal of signals) {
    let weight = signal.weight ?? 1;
    let size = Math.abs(weight);
    if ('boost' in signal) {
      for (let r of admitted) {
        if (signal.boost(r) === weight > 0) {
          add(r, size / (k + 1));
        }
      }
      continue;
    }
    let valued: { r: Row; value: number }[] = [];
    for (let r of admitted) {
      let value =
        'near' in signal
          ? r.vector
            ? cosine(r.vector, signal.near)
            : null
          : r.doc[signal.by];
      if (value != null) {
        valued.push({ r, value: num(value) });
      }
    }
    let highestFirst =
      ('near' in signal || (signal.direction ?? 'desc') === 'desc') ===
      weight > 0;
    valued.sort((a, b) =>
      highestFirst ? b.value - a.value : a.value - b.value,
    );
    valued.forEach((v, i) => {
      if (i > 0 && Math.abs(valued[i - 1].value - v.value) < 1e-6) {
        fixture(`${valued[i - 1].r.name} and ${v.r.name} tie in a signal`);
      }
      add(v.r, size / (k + i + 1));
    });
  }
  return admitted.map((r) => ({ name: r.name, score: scores.get(r.name)! }));
}

// The fused ranking, best first. No two rows may fuse to one score, since
// the docs give no order between them.
function fuse(admitted: Row[], signals: Signal[], k = DEFAULT_RRF_K) {
  let ranked = contributions(admitted, signals, k).sort(
    (a, b) => b.score - a.score,
  );
  ranked.forEach((r, i) => {
    if (i > 0 && ranked[i - 1].score - r.score < 1e-9) {
      fixture(`${ranked[i - 1].name} and ${r.name} fuse to the same score`);
    }
  });
  return ranked;
}

// Of rows in rank order, the first `keep` of each group; a row with no value
// at `by` is a group of its own.
function collapse(ranked: { name: string }[], by: string, keep: number) {
  let sizes = new Map<Value, number>();
  for (let { name } of ranked) {
    let value = row(name).doc[by];
    sizes.set(value, (sizes.get(value) ?? 0) + 1);
  }
  let seen = new Map<Value, number>();
  let kept: { name: string; size: number }[] = [];
  for (let { name } of ranked) {
    let value = row(name).doc[by];
    if (value == null) {
      kept.push({ name, size: 1 });
      continue;
    }
    let count = seen.get(value) ?? 0;
    seen.set(value, count + 1);
    if (count < keep) {
      kept.push({ name, size: sizes.get(value)! });
    }
  }
  return kept;
}

// A field sort: lowest first unless `desc`, a row with no value last either
// way (docs/search.md, `missing`).
function comparator(keys: { by: string; direction?: 'asc' | 'desc' }[]) {
  return (a: Row, b: Row): number => {
    for (let { by, direction } of keys) {
      let x = a.doc[by];
      let y = b.doc[by];
      if (x == null && y == null) continue;
      if (x == null) return 1;
      if (y == null) return -1;
      let order = x < y ? -1 : x > y ? 1 : 0;
      if (order !== 0) {
        return direction === 'desc' ? -order : order;
      }
    }
    return fixture(`${a.name} and ${b.name} tie on every sort key`);
  };
}

function valueCounts(rows: Row[], field: string): Record<string, number> {
  let counts: Record<string, number> = {};
  for (let r of rows) {
    let v = r.doc[field];
    for (let value of v == null ? [] : Array.isArray(v) ? v : [v]) {
      counts[String(value)] = (counts[String(value)] ?? 0) + 1;
    }
  }
  return counts;
}

interface Bucket {
  key?: string;
  from?: number;
  to?: number;
}
// Each `[from, to)` bucket's count, labeled by its key, or `from-to` with `*`
// for an open end.
function bucketCounts(rows: Row[], field: string, buckets: Bucket[]) {
  return Object.fromEntries(
    buckets.map((b) => [
      b.key ?? `${b.from ?? '*'}-${b.to ?? '*'}`,
      rows.filter((r) => {
        let v = r.doc[field];
        return (
          v != null &&
          (b.from == null || num(v) >= b.from) &&
          (b.to == null || num(v) < b.to)
        );
      }).length,
    ]),
  );
}

function numberStats(rows: Row[], field: string) {
  let values = rows
    .map((r) => r.doc[field])
    .filter((v) => v != null) as number[];
  let sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    distinct: new Set(values).size,
    min: Math.min(...values),
    max: Math.max(...values),
    sum,
    avg: sum / values.length,
  };
}

// --- the index --------------------------------------------------------------

function makeDefinitionLookup(): DefinitionLookup {
  let definitions = [
    definitionOf(productRef, productFields, productSearch),
    definitionOf(postRef, postFields, postSearch),
    definitionOf(videoRef, postFields, postSearch),
    {
      type: 'card-def',
      codeRef: ref('@cardstack/base/card-api', 'CardDef'),
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

const vec = (components: number[]) =>
  VectorSerializer.queryableValue(VectorSerializer.encodeVector(components));

// --- every form a query has -------------------------------------------------

interface Intent {
  // As a query saved in a realm writes it.
  saved?: Q;
  // In the newer spelling: a top-level `type`, bare clauses and paths.
  typed?: Q;
  // With `on` anchors and a sort only a request can spell (`relevance`): the
  // query without its sort, and the sort as it goes over the wire.
  anchored?: { query: Q; sort: Q[] };
}

const overTheWire = (payload: unknown) =>
  parseSearchEntryQueryFromPayload(JSON.parse(JSON.stringify(payload)))
    .itemQuery as Q;

function forms(intent: Intent): [string, Q][] {
  let out: [string, Q][] = [];
  if (intent.saved) {
    out.push(['as saved', intent.saved]);
    out.push([
      'as saved, over the wire',
      overTheWire(searchEntryWireQueryFromQuery(intent.saved as Query)),
    ]);
  }
  if (intent.anchored) {
    out.push([
      'anchored clauses, over the wire',
      overTheWire({
        ...searchEntryWireQueryFromQuery(intent.anchored.query as Query),
        sort: intent.anchored.sort,
      }),
    ]);
  }
  if (intent.typed) {
    let lowered = lowerQuery(intent.typed).query;
    out.push(['newer spelling', lowered]);
    out.push(['newer spelling, over the wire', overTheWire(intent.typed)]);
    out.push([
      'newer spelling, over the wire with item. paths',
      overTheWire(searchEntryWireQueryFromQuery(lowered as Query)),
    ]);
  }
  return out;
}

module(basename(import.meta.filename), function () {
  module('app ranking (Postgres + pgvector)', function (hooks) {
    let adapter: PgAdapter;
    let engine: IndexQueryEngine;

    hooks.before(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
      if (!(await hasVectorIndex(adapter))) {
        throw new Error(
          'app-ranking-integration-test needs the pgvector extension in the test Postgres, and this database does not have it. Install pgvector in the test database image; these tests do not skip.',
        );
      }
      let virtualNetwork = new VirtualNetwork();
      let lookup = makeDefinitionLookup();
      engine = new IndexQueryEngine(adapter, lookup, virtualNetwork);
      let keys = {
        Product: [internalKeyFor(productRef, undefined, virtualNetwork)],
        Post: [internalKeyFor(postRef, undefined, virtualNetwork)],
        Video: [
          internalKeyFor(videoRef, undefined, virtualNetwork),
          internalKeyFor(postRef, undefined, virtualNetwork),
        ],
      };
      // Through the index writer, which also writes each card's vectors and
      // full-text vector.
      let batch = await new IndexWriter(adapter).createBatch(
        new URL(testRealm),
        virtualNetwork,
        undefined,
        { splitPrerenderHtml: false },
      );
      for (let r of ROWS) {
        let cardURL = new URL(`${idOf(r)}.json`);
        let adoptsFrom =
          r.type === 'Product'
            ? productRef
            : r.type === 'Video'
              ? videoRef
              : postRef;
        // What a render stamps for the shop's declarations: its role-weighted
        // words, the words a typo may be corrected to, and its type-ahead
        // text. The posts declare nothing and are found by their page alone.
        let stamped =
          r.type === 'Product'
            ? {
                [SEARCH_TEXT_KEY]: {
                  A: r.doc.title,
                  D: r.doc.blurb,
                  ...(r.doc.brand ? { typos: r.doc.brand } : {}),
                },
                _typeahead: r.doc.title,
              }
            : {};
        await batch.updateEntry(cardURL, {
          type: 'instance',
          resource: {
            id: rri(cardURL.href),
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: {
                module: rri(adoptsFrom.module),
                name: adoptsFrom.name,
              },
            },
          },
          lastModified: Date.now(),
          resourceCreatedAt: Date.now(),
          searchData: await withFacetFields(
            {
              id: idOf(r),
              ...r.doc,
              ...(r.vector ? { embedding: vec(r.vector) } : {}),
              ...stamped,
            },
            await lookup.lookupDefinition(adoptsFrom),
            lookup,
          ),
          markdown:
            r.type === 'Product'
              ? `# ${r.doc.title}\n\n${r.doc.blurb}`
              : r.text,
          deps: new Set(),
          displayNames: [adoptsFrom.name],
          types: keys[r.type],
          isolatedHtml: `<div>${r.name}</div>`,
        });
      }
      await batch.done();
    });

    hooks.after(async function () {
      if (adapter) {
        await closeTestPgAdapter(adapter);
      }
    });

    interface Answer {
      names: string[];
      rows: Record<string, unknown>[];
      meta: any;
    }

    async function ask(q: Q): Promise<Answer> {
      let { results, meta } = await engine.search(
        new URL(testRealm),
        q as Query,
        {},
        { kind: 'renderSet' },
      );
      return {
        names: results.map((r) =>
          r.url!.split('/').pop()!.replace('.json', ''),
        ),
        rows: results as Record<string, unknown>[],
        meta,
      };
    }

    // A `select` search as the realm answers one: the wire query's columns
    // are planned against its type, then read off each row of the page.
    async function table(payload: Q) {
      let parsed = parseSearchEntryQueryFromPayload(
        JSON.parse(JSON.stringify(payload)),
      );
      let plans = await engine.planColumns(
        parsed.typeAnchors![0],
        parsed.columns!,
      );
      let { rows, meta } = await engine.searchColumns(
        new URL(testRealm),
        parsed.itemQuery,
        {},
        plans,
      );
      return {
        columns: ['id', ...parsed.columns!.map((c) => c.name)],
        rows,
        meta: meta as any,
      };
    }

    function near(
      assert: Assert,
      actual: unknown,
      expected: number,
      message: string,
      tolerance = 1e-9,
    ) {
      assert.true(
        actual != null && Math.abs(Number(actual) - expected) <= tolerance,
        `${message}: expected ${expected}, got ${actual}`,
      );
    }

    // The rows are the fused ranking, each with the score the formula gives.
    function fused(
      assert: Assert,
      got: Answer,
      expected: { name: string; score: number }[],
      form: string,
    ) {
      assert.deepEqual(
        got.names,
        expected.map((e) => e.name),
        `${form}: rows in fused order`,
      );
      got.rows.forEach((r, i) => {
        if (expected[i]?.name === got.names[i]) {
          near(
            assert,
            r._blendScore,
            expected[i].score,
            `${form}: ${got.names[i]} score`,
          );
        }
      });
    }

    // The rows are the nearest first, each with its cosine, then the rows
    // with no vector in any order.
    function nearestFirst(
      assert: Assert,
      got: Answer,
      ranked: { name: string; similarity: number }[],
      unranked: string[],
      form: string,
    ) {
      assert.deepEqual(
        got.names.slice(0, ranked.length),
        ranked.map((r) => r.name),
        `${form}: most similar first`,
      );
      assert.deepEqual(
        got.names.slice(ranked.length).sort(),
        unranked,
        `${form}: the rows with no vector come last`,
      );
      ranked.forEach((r, i) => {
        if (got.names[i] === r.name) {
          near(
            assert,
            got.rows[i]._nearSimilarity,
            r.similarity,
            `${form}: ${r.name} similarity`,
            1e-6,
          );
        }
      });
    }

    const facetMap = (got: Answer, by: string): Record<string, number> =>
      Object.fromEntries(
        (got.meta.facets?.[by] ?? []).map(
          (f: { value: unknown; count: number }) => [String(f.value), f.count],
        ),
      );

    function statsMatch(
      assert: Assert,
      got: Answer,
      by: string,
      rows: Row[],
      form: string,
    ) {
      let expected = numberStats(rows, by);
      let actual = got.meta.facetStats?.[by] ?? {};
      for (let key of ['count', 'distinct', 'min', 'max', 'sum'] as const) {
        assert.strictEqual(actual[key], expected[key], `${form}: ${by} ${key}`);
      }
      near(assert, actual.avg, expected.avg, `${form}: ${by} avg`);
    }

    // ---- the video library: semantic search --------------------------------

    test('related posts: one post read by a binding, the posts nearest its vector, itself left out', async function (assert) {
      // The card's own vector is the target, read through `let`; nothing
      // else narrows the search, so the nearest ten are the page.
      let me = row('p08');
      let ranked = nearest(
        posts().filter((r) => r.name !== 'p08'),
        me.vector!,
      ).slice(0, 10);
      let on = postRef;
      let mine = '$me.embedding';
      let page = { size: 10 };
      let all = [
        ...forms({
          // A type anchor and the exclusion under `every`.
          saved: {
            let: {
              $me: {
                from: { filter: { on, eq: { id: idOf(me) } } },
                one: true,
              },
            },
            filter: {
              every: [{ type: on }, { not: { on, eq: { id: idOf(me) } } }],
            },
            sort: [{ on, by: 'embedding', near: mine }],
            page,
          },
          typed: {
            type: on,
            let: {
              $me: {
                from: { type: on, filter: { eq: { id: idOf(me) } } },
                one: true,
              },
            },
            filter: { not: { eq: { id: idOf(me) } } },
            sort: [{ by: 'embedding', near: mine }],
            page,
          },
        }),
        // One filter object holding both the anchor and the exclusion.
        ...forms({
          saved: {
            let: {
              $me: {
                from: { filter: { on, eq: { id: idOf(me) } } },
                one: true,
              },
            },
            filter: { on, not: { on, eq: { id: idOf(me) } } },
            sort: [{ on, by: 'embedding', near: mine }],
            page,
          },
        }).map(([form, q]): [string, Q] => [`${form} (one filter object)`, q]),
      ];
      for (let [form, q] of all) {
        let got = await ask(q);
        nearestFirst(assert, got, ranked, [], form);
        assert.deepEqual(
          got.meta.lets,
          { $me: { strategy: 'card', found: true } },
          `${form}: the binding found its card`,
        );
        assert.strictEqual(
          got.meta.page.total,
          posts().length - 1,
          `${form}: the total counts every post but the source`,
        );
      }
    });

    // What the moment finder narrows by, each clause with the plain test it
    // stands for. `which` picks the subtype or everything but it.
    function finder(which: 'videos' | 'not videos') {
      let on = postRef;
      return {
        clauses: [
          (r: Row) => (r.type === 'Video') === (which === 'videos'),
          (r: Row) => r.doc.flagged !== true,
          (r: Row) => num(r.doc.month) >= 202606,
          (r: Row) =>
            list(r.doc.tags).some((t) => ['ai', 'databases'].includes(t)),
        ],
        saved: [
          { type: on },
          which === 'videos' ? { type: videoRef } : { not: { type: videoRef } },
          { not: { on, eq: { flagged: true } } },
          { on, range: { month: { gte: 202606 } } },
          {
            any: [
              { on, eq: { tags: 'ai' } },
              { on, eq: { tags: 'databases' } },
            ],
          },
        ],
        typed: [
          which === 'videos' ? { type: videoRef } : { not: { type: videoRef } },
          { not: { eq: { flagged: true } } },
          { range: { month: { gte: 202606 } } },
          { any: [{ eq: { tags: 'ai' } }, { eq: { tags: 'databases' } }] },
        ],
      };
    }
    const recentThenLiked = [
      { by: 'month', direction: 'desc' as const },
      { by: 'likes', direction: 'desc' as const },
    ];

    test('find moments by meaning: a subtype left out, an exclusion, a range, any of a list field, and a similarity floor, newest month then most liked', async function (assert) {
      let on = postRef;
      let f = finder('not videos');
      let kept = admit(posts(), [
        ...f.clauses,
        (r) => r.vector != null && cosine(r.vector, MEANING) >= 0.45,
      ]);
      // Two posts share each month, so the second key decides.
      let expected = [...kept]
        .sort(comparator(recentThenLiked))
        .map((r) => r.name);
      let floor = { embedding: { to: MEANING, minSimilarity: 0.45 } };
      let page = { size: 300, total: 'exact' };
      let all = forms({
        saved: {
          filter: { every: [...f.saved, { on, near: floor }] },
          sort: recentThenLiked.map((s) => ({ on, ...s })),
          page,
        },
        typed: {
          type: on,
          filter: { every: [...f.typed, { near: floor }] },
          sort: recentThenLiked,
          page,
        },
      });
      for (let [form, q] of all) {
        let got = await ask(q);
        assert.deepEqual(got.names, expected, `${form}: rows in order`);
        assert.strictEqual(
          got.meta.page.total,
          expected.length,
          `${form}: total`,
        );
      }
    });

    test('find moments by words: the same narrowing with a word in place of the similarity floor, in the subtype and outside it', async function (assert) {
      let on = postRef;
      let page = { size: 300, total: 'exact' };
      let cases = (['not videos', 'videos'] as const).map((which) => {
        let f = finder(which);
        // Each clause was shown to matter under the similarity floor; with
        // a word in its place the fixture is too small for that, so this is
        // a plain reading of the same clauses.
        let clauses = [...f.clauses, (r: Row) => has(r, 'vector')];
        let kept = posts().filter((r) => clauses.every((c) => c(r)));
        return {
          which,
          expected: [...kept]
            .sort(comparator(recentThenLiked))
            .map((r) => r.name),
          all: forms({
            saved: {
              filter: { every: [...f.saved, { on, matches: 'vector' }] },
              sort: recentThenLiked.map((s) => ({ on, ...s })),
              page,
            },
            typed: {
              type: on,
              filter: { every: [...f.typed, { matches: 'vector' }] },
              sort: recentThenLiked,
              page,
            },
          }),
        };
      });
      for (let { which, expected, all } of cases) {
        assert.notStrictEqual(
          expected.length,
          0,
          `${which}: the fixture has matches`,
        );
        for (let [form, q] of all) {
          let got = await ask(q);
          assert.deepEqual(
            got.names,
            expected,
            `${which}, ${form}: rows in order`,
          );
          assert.strictEqual(
            got.meta.page.total,
            expected.length,
            `${which}, ${form}: total`,
          );
        }
      }
    });

    test('find moments, fused: meaning, score, fewest likes and recency with weights and a k, over the narrowed rows', async function (assert) {
      assert.strictEqual(
        DEFAULT_RRF_K,
        60,
        'the k the docs give as the default',
      );
      let on = postRef;
      let f = finder('not videos');
      // The similarity floor is a filter and the same target is a signal.
      let kept = admit(posts(), [
        ...f.clauses,
        (r) => r.vector != null && cosine(r.vector, MEANING) >= 0.45,
      ]);
      let expected = fuse(
        kept,
        [
          { near: MEANING, weight: 1.5 },
          { by: 'score' },
          { by: 'likes', direction: 'asc', weight: 0.7 },
          { by: 'postedAt', weight: 0.4 },
        ],
        20,
      );
      let all = forms({
        typed: {
          type: on,
          filter: {
            every: [
              ...f.typed,
              { near: { embedding: { to: MEANING, minSimilarity: 0.45 } } },
            ],
          },
          sort: [
            {
              blend: [
                { by: 'embedding', near: MEANING, weight: 1.5 },
                { by: 'score' },
                { by: 'likes', direction: 'asc', weight: 0.7 },
                { by: 'postedAt', weight: 0.4 },
              ],
              k: 20,
            },
          ],
          page: { size: 300 },
        },
      });
      for (let [form, q] of all) {
        fused(assert, await ask(q), expected, form);
      }
    });

    test('find moments, fused over every post: a post with no vector or no score gets nothing from that signal', async function (assert) {
      let on = postRef;
      let kept = admit(posts(), [(r) => r.doc.kind !== 'repost']);
      if (
        !kept.some((r) => !r.vector) ||
        !kept.some((r) => r.doc.score == null)
      ) {
        fixture('no kept row lacks a vector, or none lacks a score');
      }
      let signals: Signal[] = [
        { near: MEANING, weight: 2 },
        { by: 'score', weight: 1.1 },
        { by: 'likes', direction: 'asc', weight: 0.7 },
      ];
      let expected = fuse(kept, signals);
      let all = forms({
        typed: {
          type: on,
          filter: { not: { eq: { kind: 'repost' } } },
          sort: [
            {
              blend: [
                { by: 'embedding', near: MEANING, weight: 2 },
                { by: 'score', weight: 1.1 },
                { by: 'likes', direction: 'asc', weight: 0.7 },
              ],
            },
          ],
          page: { size: 300 },
        },
      });
      for (let [form, q] of all) {
        fused(assert, await ask(q), expected, form);
      }
    });

    // The part of a fused score the text signal gave: what is left after the
    // signals this file can rank. The docs give no order for text relevance,
    // only that a match gains weight / (k + rank) for a whole rank and a card
    // with no match gains nothing.
    function textShare(
      assert: Assert,
      got: Answer,
      rest: { name: string; score: number }[],
      matched: Set<string>,
      weight: number,
      k: number,
      form: string,
    ) {
      got.rows.forEach((r, i) => {
        let name = got.names[i];
        let other = rest.find((e) => e.name === name)?.score ?? 0;
        let share = Number(r._blendScore) - other;
        if (!matched.has(name)) {
          near(
            assert,
            share,
            0,
            `${form}: ${name} has no text match and gains nothing from text`,
          );
          return;
        }
        let rank = weight / share - k;
        assert.true(
          Math.abs(rank - Math.round(rank)) < 1e-6 &&
            Math.round(rank) >= 1 &&
            Math.round(rank) <= matched.size,
          `${form}: ${name} gains weight / (k + rank) from text for a rank from 1 to ${matched.size} (got rank ${rank})`,
        );
      });
      let scores = got.rows.map((r) => Number(r._blendScore));
      assert.deepEqual(
        scores,
        [...scores].sort((a, b) => b - a),
        `${form}: rows are in score order`,
      );
    }

    test('a moment gets in by meaning or by any of the words, ranked by words and meaning fused', async function (assert) {
      let on = postRef;
      let f = finder('not videos');
      // The subtype is not narrowed here: videos and other posts both.
      let clauses = f.clauses.slice(1);
      let similar = (r: Row) =>
        r.vector != null && cosine(r.vector, MEANING) >= 0.85;
      let worded = (r: Row) => has(r, 'postgres') || has(r, 'pasta');
      let kept = admit(posts(), [...clauses, (r) => similar(r) || worded(r)]);
      let matched = new Set(kept.filter(worded).map((r) => r.name));
      let byMeaning = fuse(
        kept.filter((r) => r.vector),
        [{ near: MEANING }],
        60,
      );
      let both = kept.filter((r) => r.vector && worded(r)).map((r) => r.name);
      let meaningOnly = byMeaning.filter((e) => !matched.has(e.name));
      // Rows from each arm alone, from both, and one with no vector.
      if (
        both.length === 0 ||
        meaningOnly.length < 2 ||
        !kept.some((r) => !r.vector) ||
        !kept.some((r) => worded(r) && !similar(r)) ||
        !kept.some((r) => similar(r) && !worded(r))
      ) {
        fixture('the hybrid search needs rows from each arm and from both');
      }
      let hybrid = {
        any: [
          { near: { embedding: { to: MEANING, minSimilarity: 0.85 } } },
          { matches: 'postgres or pasta' },
        ],
      };
      let all = forms({
        typed: {
          type: on,
          filter: { every: [...f.typed.slice(1), hybrid] },
          sort: [
            {
              blend: [
                { by: 'textRelevance' },
                { by: 'embedding', near: MEANING },
              ],
              k: 60,
            },
          ],
          page: { size: 80 },
        },
      });
      // The wire spelling the apps send for the text signal.
      assert.strictEqual(
        (searchEntryWireQueryFromQuery(all[0][1] as Query) as Q).sort[0]
          .blend[0].by,
        'item.textRelevance',
        'over the wire the text signal is item.textRelevance',
      );
      for (let [form, q] of all) {
        let got = await ask(q);
        assert.deepEqual(
          [...got.names].sort(),
          kept.map((r) => r.name).sort(),
          `${form}: the rows of either arm, and no other`,
        );
        textShare(assert, got, byMeaning, matched, 1, 60, form);
        // With equal weights and k = 60, a card with both signals scores
        // 1/(60 + r) + 1/(60 + t) for ranks under 62, which is more than the
        // 1/61 the best card with one signal can score.
        assert.deepEqual(
          got.names.slice(0, both.length).sort(),
          [...both].sort(),
          `${form}: the cards matching on both signals outrank the cards matching on one`,
        );
        assert.deepEqual(
          got.names.filter((n) => meaningOnly.some((e) => e.name === n)),
          meaningOnly.map((e) => e.name),
          `${form}: cards with no text match keep their order by meaning`,
        );
      }
    });

    test('a quoted phrase must match as well, beside the meaning-or-words arm, with a five-signal fused ranking', async function (assert) {
      let on = postRef;
      let similar = (r: Row) =>
        r.vector != null && cosine(r.vector, MEANING) >= 0.9;
      let worded = (r: Row) => has(r, 'postgres') || has(r, 'scan');
      let kept = admit(posts(), [
        (r) => hasPhrase(r, 'vector index'),
        (r) => similar(r) || worded(r),
      ]);
      // Every row matches the phrase, so every row has a text rank.
      let matched = new Set(kept.map((r) => r.name));
      let rest = contributions(kept, [
        { near: MEANING },
        { by: 'score', weight: 0.5 },
        { by: 'likes', direction: 'asc', weight: 0.3 },
        { by: 'postedAt', weight: 0.2 },
      ]);
      let all = forms({
        typed: {
          type: on,
          filter: {
            every: [
              { matches: '"vector index"' },
              {
                any: [
                  { near: { embedding: { to: MEANING, minSimilarity: 0.9 } } },
                  { matches: 'postgres or scan' },
                ],
              },
            ],
          },
          sort: [
            {
              blend: [
                { by: 'textRelevance', weight: 0.6 },
                { by: 'embedding', near: MEANING },
                { by: 'score', weight: 0.5 },
                { by: 'likes', direction: 'asc', weight: 0.3 },
                { by: 'postedAt', weight: 0.2 },
              ],
              k: 60,
            },
          ],
          page: { size: 24 },
        },
      });
      for (let [form, q] of all) {
        let got = await ask(q);
        assert.deepEqual(
          [...got.names].sort(),
          kept.map((r) => r.name).sort(),
          `${form}: the rows holding the phrase that either arm admits`,
        );
        textShare(assert, got, rest, matched, 0.6, 60, form);
      }
    });

    test('facet counts with a subtype left out and no rows asked for', async function (assert) {
      let on = postRef;
      let cases = [undefined, 'ai'].map((topic) => {
        let clauses = [
          (r: Row) => r.type !== 'Video',
          (r: Row) => r.doc.flagged !== true,
          ...(topic ? [(r: Row) => r.doc.topic === topic] : []),
        ];
        let kept = admit(posts(), clauses);
        return {
          topic,
          kept,
          all: forms({
            saved: {
              filter: {
                every: [
                  { type: on },
                  { not: { type: videoRef } },
                  { not: { on, eq: { flagged: true } } },
                  ...(topic ? [{ on, eq: { topic } }] : []),
                ],
              },
              facets: [
                { by: 'topic', size: 100 },
                { by: 'tags', size: 400 },
              ],
              page: { size: 0, total: 'exact' },
            },
            typed: {
              type: on,
              filter: {
                every: [
                  { not: { type: videoRef } },
                  { not: { eq: { flagged: true } } },
                  ...(topic ? [{ eq: { topic } }] : []),
                ],
              },
              facets: [
                { by: 'topic', size: 100 },
                { by: 'tags', size: 400 },
              ],
              page: { size: 0, total: 'exact' },
            },
          }),
        };
      });
      for (let { topic, kept, all } of cases) {
        for (let [form, q] of all) {
          let label = `${topic ?? 'every topic'}, ${form}`;
          let got = await ask(q);
          assert.deepEqual(got.names, [], `${label}: no rows`);
          assert.deepEqual(
            facetMap(got, 'topic'),
            valueCounts(kept, 'topic'),
            `${label}: topic counts`,
          );
          assert.deepEqual(
            facetMap(got, 'tags'),
            valueCounts(kept, 'tags'),
            `${label}: each tag of the list field counts`,
          );
          assert.strictEqual(
            got.meta.page.total,
            kept.length,
            `${label}: an exact total counts every match`,
          );
        }
      }
    });

    test('a not over a field some cards leave empty leaves those cards out', async function (assert) {
      let on = postRef;
      // A comparison with a missing value is neither true nor false, as in
      // SQL, and `not` carries that: a post with no author is returned by
      // neither `eq: { author: 'ada' }` nor its `not`. Queries saved in realms
      // have always been answered this way. To include the cards with no
      // value, say so: `any: [{ eq: { author: null } }, { not: ... }]`.
      let kept = admit(posts(), [
        (r) => r.doc.author != null && r.doc.author !== 'ada',
      ]);
      assert.true(
        posts().some((r) => r.doc.author == null),
        'the fixture has posts with no author',
      );
      let all = forms({
        saved: {
          filter: { on, not: { eq: { author: 'ada' } } },
          page: { size: 50 },
        },
        typed: {
          type: on,
          filter: { not: { eq: { author: 'ada' } } },
          page: { size: 50 },
        },
      });
      for (let [form, q] of all) {
        assert.deepEqual(
          (await ask(q)).names.sort(),
          kept.map((r) => r.name).sort(),
          form,
        );
      }
      // Saying so includes them.
      let withMissing = admit(posts(), [(r) => r.doc.author !== 'ada']);
      let said = await ask({
        filter: {
          on,
          any: [
            { on, eq: { author: null } },
            { on, not: { eq: { author: 'ada' } } },
          ],
        },
        page: { size: 50 },
      });
      assert.deepEqual(
        said.names.sort(),
        withMissing.map((r) => r.name).sort(),
        'with the missing value named',
      );
    });

    // ---- a feed: fused ranking, boosts, one per group, pages --------------

    // Reads the whole ranking, then the same ranking a page at a time.
    async function pagesMatch(
      assert: Assert,
      q: Q,
      expected: { name: string; size: number; score: number }[],
      size: number,
      form: string,
    ) {
      let whole = await ask({ ...q, page: { size: 50 } });
      fused(assert, whole, expected, `${form}, one page`);
      assert.deepEqual(
        whole.rows.map((r) => Number(r._collapseSize)),
        expected.map((e) => e.size),
        `${form}: each row says how many matches its group holds`,
      );
      assert.strictEqual(
        whole.meta.page.total,
        expected.length,
        `${form}: the total counts what the collapse left`,
      );
      let laid: string[] = [];
      let pages = Math.ceil(expected.length / size);
      for (let number = 0; number <= pages; number++) {
        let page = await ask({ ...q, page: { size, number } });
        laid.push(...page.names);
        assert.strictEqual(
          page.meta.page.total,
          expected.length,
          `${form}: page ${number} reports the same total`,
        );
        assert.strictEqual(
          page.names.length,
          Math.max(0, Math.min(size, expected.length - number * size)),
          `${form}: page ${number} is as long as it should be`,
        );
      }
      assert.deepEqual(
        laid,
        expected.map((e) => e.name),
        `${form}: the pages end to end are the whole ranking, nothing twice and nothing left out`,
      );
    }

    test('a feed with no filter: eight signals, boosts on long id lists both ways, one post per author, read in pages', async function (assert) {
      let on = postRef;
      let unknown = (prefix: string) =>
        Array.from({ length: 300 }, (_, i) => `${prefix}missing-${i}`);
      let picked = ['p02', 'p05', 'p13', 'p16'];
      let followed = ['p01', 'p07', 'p12', 'p13'];
      let ids = [
        ...unknown(`${testRealm}Post/`),
        ...picked.map((n) => idOf(row(n))),
      ];
      let uris = [
        ...followed.map((n) => `at://feed/${n}`),
        ...unknown('at://feed/'),
      ];
      let wordy = (r: Row) => has(r, 'postgres') || has(r, 'pasta');
      let signals: Signal[] = [
        { near: TASTE },
        { near: AWAY, weight: -0.8 },
        {
          boost: (r) => ['db', 'ai'].includes(String(r.doc.topic)),
          weight: 0.5,
        },
        { boost: (r) => r.doc.topic === 'travel', weight: -0.4 },
        { boost: (r) => picked.includes(r.name), weight: 0.7 },
        { boost: (r) => followed.includes(r.name), weight: 0.45 },
        { boost: wordy, weight: 0.3 },
        { by: 'score', weight: 0.25 },
      ];
      let ranked = fuse(posts(), signals);
      let expected = collapse(ranked, 'author', 1).map((e) => ({
        ...e,
        score: ranked.find((r) => r.name === e.name)!.score,
      }));
      let all = forms({
        typed: {
          type: on,
          sort: [
            {
              blend: [
                { by: 'embedding', near: TASTE },
                { by: 'embedding', near: AWAY, weight: -0.8 },
                { boost: { in: { topic: ['db', 'ai'] } }, weight: 0.5 },
                { boost: { in: { topic: ['travel'] } }, weight: -0.4 },
                { boost: { in: { id: ids } }, weight: 0.7 },
                { boost: { in: { uri: uris } }, weight: 0.45 },
                { boost: { matches: 'postgres or pasta' }, weight: 0.3 },
                { by: 'score', weight: 0.25 },
              ],
            },
          ],
          collapse: { by: 'author', keep: 1 },
        },
      });
      for (let [form, q] of all) {
        await pagesMatch(assert, q, expected, 3, form);
      }
    });

    test('a discovery feed: topics left out, a negative similarity signal and a boost, two per topic, read in pages', async function (assert) {
      let on = postRef;
      let kept = admit(posts(), [(r) => r.doc.topic !== 'cooking']);
      let ranked = fuse(kept, [
        { by: 'score', weight: 1.5 },
        { by: 'postedAt', weight: 0.4 },
        { near: TASTE, weight: -0.6 },
        { boost: (r) => ['travel', 'ai'].includes(String(r.doc.topic)) },
      ]);
      let expected = collapse(ranked, 'topic', 2).map((e) => ({
        ...e,
        score: ranked.find((r) => r.name === e.name)!.score,
      }));
      let all = forms({
        typed: {
          type: on,
          filter: { every: [{ not: { in: { topic: ['cooking'] } } }] },
          sort: [
            {
              blend: [
                { by: 'score', weight: 1.5 },
                { by: 'postedAt', weight: 0.4 },
                { by: 'embedding', near: TASTE, weight: -0.6 },
                { boost: { in: { topic: ['travel', 'ai'] } }, weight: 1 },
              ],
            },
          ],
          collapse: { by: 'topic', keep: 2 },
        },
      });
      for (let [form, q] of all) {
        await pagesMatch(assert, q, expected, 2, form);
      }
    });

    test('a table of values: the posts of some topics that have a vector, nearest first, on a large page', async function (assert) {
      let kept = admit(posts(), [
        (r) => ['db', 'ai'].includes(String(r.doc.topic)),
        (r) => r.vector != null,
      ]);
      let ranked = nearest(kept, TASTE);
      let expected = ranked.map(({ name }) => {
        let r = row(name);
        return [idOf(r), r.doc.uri, r.doc.author, r.doc.tags, r.doc.likes];
      });
      let payloads: [string, Q][] = [
        [
          'bare paths',
          {
            type: postRef,
            filter: {
              every: [
                { in: { topic: ['db', 'ai'] } },
                { near: { embedding: { to: TASTE } } },
              ],
            },
            sort: [{ by: 'embedding', near: TASTE }],
            select: [
              'uri',
              { who: 'author' },
              'tags',
              'likes',
              '_nearSimilarity',
            ],
            page: { size: 500 },
          },
        ],
        [
          'item. paths',
          {
            type: postRef,
            filter: {
              every: [
                { in: { 'item.topic': ['db', 'ai'] } },
                { near: { 'item.embedding': { to: TASTE } } },
              ],
            },
            sort: [{ by: 'item.embedding', near: TASTE }],
            select: [
              'item.uri',
              { who: 'item.author' },
              'item.tags',
              'item.likes',
              '_nearSimilarity',
            ],
            page: { size: 500 },
          },
        ],
      ];
      for (let [form, payload] of payloads) {
        let got = await table(payload);
        assert.deepEqual(
          got.columns,
          ['id', 'uri', 'who', 'tags', 'likes', '_nearSimilarity'],
          `${form}: id first, then each column by its name`,
        );
        assert.deepEqual(
          got.rows.map((r) => r.slice(0, 5)),
          expected,
          `${form}: each row's values, nearest first`,
        );
        ranked.forEach((r, i) => {
          near(
            assert,
            got.rows[i]?.[5],
            r.similarity,
            `${form}: ${r.name} similarity column`,
            1e-6,
          );
        });
        assert.strictEqual(
          got.meta.page.total,
          expected.length,
          `${form}: total`,
        );
      }
    });

    // ---- the shop: look-alikes ---------------------------------------------

    test('a similarity floor with a sort by the same vector keeps the rows at or above it, the one exactly on it included', async function (assert) {
      let on = productRef;
      assert.strictEqual(
        cosine(row('ottoman').vector!, AXIS),
        0.5,
        'the fixture has a row exactly on the floor',
      );
      let floored = nearest(products(), AXIS).filter(
        (r) => r.similarity >= 0.5,
      );
      let all = nearest(products(), AXIS);
      assert.strictEqual(
        floored[floored.length - 1].name,
        'ottoman',
        'and rows above and below it',
      );
      assert.true(floored.length < all.length);
      let inOffice = nearest(
        admit(products(), [
          (r) => r.doc.department === 'Office',
          (r) => !!r.vector,
        ]),
        AXIS,
      );
      let page = { size: 500, total: 'exact' };
      let cases: [
        string,
        { name: string; similarity: number }[],
        [string, Q][],
      ][] = [
        [
          'at least 0.5',
          floored,
          forms({
            saved: {
              filter: {
                on,
                near: { embedding: { to: AXIS, minSimilarity: 0.5 } },
              },
              sort: [{ on, by: 'embedding', near: AXIS }],
              page,
            },
            typed: {
              type: on,
              filter: { near: { embedding: { to: AXIS, minSimilarity: 0.5 } } },
              sort: [{ by: 'embedding', near: AXIS }],
              page,
            },
          }),
        ],
        [
          'no floor: every row with a vector',
          all,
          forms({
            saved: {
              filter: { on, near: { embedding: { to: AXIS } } },
              sort: [{ on, by: 'embedding', near: AXIS }],
              page,
            },
            typed: {
              type: on,
              filter: { near: { embedding: { to: AXIS } } },
              sort: [{ by: 'embedding', near: AXIS }],
              page,
            },
          }),
        ],
        [
          'no floor, one department',
          inOffice,
          forms({
            typed: {
              type: on,
              filter: {
                every: [
                  { in: { department: ['Office'] } },
                  { near: { embedding: { to: AXIS } } },
                ],
              },
              sort: [{ by: 'embedding', near: AXIS }],
              page,
            },
          }),
        ],
      ];
      for (let [name, expected, variants] of cases) {
        for (let [form, q] of variants) {
          let got = await ask(q);
          nearestFirst(assert, got, expected, [], `${name}, ${form}`);
          assert.strictEqual(
            got.meta.page.total,
            expected.length,
            `${name}, ${form}: total`,
          );
        }
      }
    });

    test('more like this: the products nearest one product, without it, in its department; those with no vector last', async function (assert) {
      let on = productRef;
      let source = row('sofa');
      // The card's own stored vector, passed as the card holds it.
      let target = VectorSerializer.encodeVector(source.vector!);
      let inDepartment = admit(products(), [
        (r) => r.name !== 'sofa',
        (r) => r.doc.department === 'Living',
      ]);
      let anotherKind = products().filter(
        (r) =>
          r.name !== 'sofa' &&
          r.doc.department === 'Living' &&
          r.doc.kind !== 'Sofa',
      );
      assert.true(
        withoutVector(inDepartment).length > 1,
        'the fixture has rows with no vector that the filter keeps',
      );
      let cases: [string, Row[], [string, Q][]][] = [
        [
          'same department',
          inDepartment,
          forms({
            saved: {
              filter: {
                every: [
                  { type: on },
                  { not: { on, eq: { id: idOf(source) } } },
                  { on, eq: { department: 'Living' } },
                ],
              },
              sort: [{ on, by: 'embedding', near: target }],
              page: { size: 12 },
            },
            typed: {
              type: on,
              filter: {
                every: [
                  { not: { eq: { id: idOf(source) } } },
                  { eq: { department: 'Living' } },
                ],
              },
              sort: [{ by: 'embedding', near: target }],
              page: { size: 12 },
            },
          }),
        ],
        [
          'same department, another kind of thing',
          anotherKind,
          forms({
            saved: {
              filter: {
                every: [
                  { type: on },
                  { not: { on, eq: { id: idOf(source) } } },
                  { on, eq: { department: 'Living' } },
                  { not: { on, eq: { kind: 'Sofa' } } },
                ],
              },
              sort: [{ on, by: 'embedding', near: source.vector }],
              page: { size: 12 },
            },
            typed: {
              type: on,
              filter: {
                every: [
                  { not: { eq: { id: idOf(source) } } },
                  { eq: { department: 'Living' } },
                  { not: { eq: { kind: 'Sofa' } } },
                ],
              },
              sort: [{ by: 'embedding', near: source.vector }],
              page: { size: 12 },
            },
          }),
        ],
      ];
      for (let [name, kept, variants] of cases) {
        let ranked = nearest(kept, source.vector!);
        for (let [form, q] of variants) {
          let got = await ask(q);
          nearestFirst(
            assert,
            got,
            ranked,
            withoutVector(kept),
            `${name}, ${form}`,
          );
          assert.strictEqual(
            got.meta.page.total,
            kept.length,
            `${name}, ${form}: total`,
          );
          let top = await ask({ ...q, page: { size: 3 } });
          assert.deepEqual(
            top.names,
            ranked.slice(0, 3).map((r) => r.name),
            `${name}, ${form}: a short page is the top of the same order`,
          );
          assert.strictEqual(
            top.meta.page.total,
            kept.length,
            `${name}, ${form}: and still counts every match`,
          );
        }
      }
    });

    test('close and popular: similarity weighted twice over views, without the source product', async function (assert) {
      let on = productRef;
      let source = row('sofa');
      let kept = admit(products(), [(r) => r.name !== 'sofa']);
      let expected = fuse(kept, [
        { near: source.vector!, weight: 2 },
        { by: 'views' },
      ]);
      let all = forms({
        typed: {
          type: on,
          filter: { every: [{ not: { eq: { id: idOf(source) } } }] },
          sort: [
            {
              blend: [
                { by: 'embedding', near: source.vector, weight: 2 },
                { by: 'views', weight: 1 },
              ],
            },
          ],
          page: { size: 50 },
        },
      });
      for (let [form, q] of all) {
        let got = await ask(q);
        fused(assert, got, expected, form);
        let top = await ask({ ...q, page: { size: 12 } });
        assert.deepEqual(
          top.names,
          expected.slice(0, 12).map((e) => e.name),
          `${form}: a page of twelve is the top of the ranking over every match`,
        );
      }
    });

    test('less like this, least viewed, cheapest: negative weights on a vector and a field, an ascending field and a boost', async function (assert) {
      let on = productRef;
      let unliked = row('sofa').vector!;
      let kept = admit(products(), [
        (r) => ['Living', 'Office'].includes(String(r.doc.department)),
      ]);
      let expected = fuse(
        kept,
        [
          { near: TASTE },
          { near: unliked, weight: -0.8 },
          { by: 'views', weight: -0.6 },
          { by: 'price', direction: 'asc', weight: 0.5 },
          { by: 'rating', weight: 0.35 },
          { boost: (r) => r.doc.brand === 'Birch', weight: 1.5 },
          { boost: (r) => r.doc.inStock === false, weight: -0.9 },
        ],
        40,
      );
      let all = forms({
        typed: {
          type: on,
          filter: { in: { department: ['Living', 'Office'] } },
          sort: [
            {
              blend: [
                { by: 'embedding', near: TASTE },
                { by: 'embedding', near: unliked, weight: -0.8 },
                { by: 'views', weight: -0.6 },
                { by: 'price', direction: 'asc', weight: 0.5 },
                { by: 'rating', weight: 0.35 },
                { boost: { eq: { brand: 'Birch' } }, weight: 1.5 },
                { boost: { eq: { inStock: false } }, weight: -0.9 },
              ],
              k: 40,
            },
            { by: 'price' },
          ],
          page: { size: 50 },
        },
      });
      for (let [form, q] of all) {
        fused(assert, await ask(q), expected, form);
      }
    });

    test('dupes of one product: a binding gives the vector, the price ceiling, the department and the brand to avoid', async function (assert) {
      let on = productRef;
      // The source falls to its own price ceiling, with no clause to say so.
      let source = row('armchair');
      let kept = admit(products(), [
        (r) => r.vector != null && cosine(r.vector, source.vector!) >= 0.3,
        (r) => num(r.doc.price) < num(source.doc.price),
        (r) => r.doc.department === source.doc.department,
        (r) => r.doc.brand == null || r.doc.brand !== source.doc.brand,
      ]);
      let ranked = nearest(kept, source.vector!);
      let its = (path: string) => `$dupe.${path}`;
      let all = forms({
        saved: {
          let: {
            $dupe: {
              from: { filter: { on, eq: { id: idOf(source) } } },
              one: true,
            },
          },
          filter: {
            every: [
              { type: on },
              {
                on,
                near: {
                  embedding: { to: its('embedding'), minSimilarity: 0.3 },
                },
              },
              { on, range: { price: { lt: its('price') } } },
              { on, eq: { department: its('department') } },
              {
                any: [
                  { on, eq: { brand: null } },
                  { not: { on, eq: { brand: its('brand') } } },
                ],
              },
            ],
          },
          sort: [{ on, by: 'embedding', near: its('embedding') }],
          page: { size: 24 },
        },
        typed: {
          type: on,
          let: {
            $dupe: {
              from: { type: on, filter: { eq: { id: idOf(source) } } },
              one: true,
            },
          },
          filter: {
            every: [
              {
                near: {
                  embedding: { to: its('embedding'), minSimilarity: 0.3 },
                },
              },
              { range: { price: { lt: its('price') } } },
              { eq: { department: its('department') } },
              {
                any: [
                  { eq: { brand: null } },
                  { not: { eq: { brand: its('brand') } } },
                ],
              },
            ],
          },
          sort: [{ by: 'embedding', near: its('embedding') }],
          page: { size: 24 },
        },
      });
      for (let [form, q] of all) {
        let got = await ask(q);
        nearestFirst(assert, got, ranked, [], form);
        assert.deepEqual(
          got.meta.lets,
          { $dupe: { strategy: 'card', found: true } },
          `${form}: the binding found its card`,
        );
      }
    });

    // ---- the shop: a faceted sidebar under each ranking -------------------

    // The sidebar as a shop builds it: each pick is one clause, a checklist
    // an `any` of `eq`, a price bar a half-open range, stars a floor, a
    // switch an `eq`. Each facet counts without its own pick.
    interface Picks {
      words?: string;
      brands?: string[];
      price?: { gte: number; lt: number };
      stars?: number;
      inStock?: boolean;
    }
    const priceBuckets: Bucket[] = [
      { key: '0', from: 0, to: 100 },
      { key: '1', from: 100, to: 300 },
      { key: '2', from: 300 },
    ];
    // Star floors overlap: four and up is inside three and up.
    const starBuckets: Bucket[] = [
      { key: '4', from: 4 },
      { key: '3', from: 3 },
    ];
    const sidebarFacets = [
      { by: 'brand', own: 'ignore', size: 200 },
      { by: 'price', own: 'ignore', stats: true, ranges: priceBuckets },
      { by: 'rating', own: 'ignore', ranges: starBuckets },
      { by: 'inStock', own: 'ignore' },
      { by: 'colors' },
    ];

    function sidebar(picks: Picks) {
      let on = productRef;
      let clauses: {
        field?: string;
        keep: (r: Row) => boolean;
        typed: Q;
        saved: Q;
      }[] = [];
      if (picks.words) {
        let words = picks.words;
        clauses.push({
          keep: (r) => has(r, words),
          typed: { matches: words },
          saved: { on, matches: words },
        });
      }
      if (picks.brands) {
        let brands = picks.brands;
        clauses.push({
          field: 'brand',
          keep: (r) => brands.includes(String(r.doc.brand)),
          typed: { any: brands.map((brand) => ({ eq: { brand } })) },
          saved: { any: brands.map((brand) => ({ on, eq: { brand } })) },
        });
      }
      if (picks.price) {
        let price = picks.price;
        clauses.push({
          field: 'price',
          keep: (r) =>
            num(r.doc.price) >= price.gte && num(r.doc.price) < price.lt,
          typed: { range: { price } },
          saved: { on, range: { price } },
        });
      }
      if (picks.stars != null) {
        let stars = picks.stars;
        clauses.push({
          field: 'rating',
          keep: (r) => r.doc.rating != null && num(r.doc.rating) >= stars,
          typed: { range: { rating: { gte: stars } } },
          saved: { on, range: { rating: { gte: stars } } },
        });
      }
      if (picks.inStock != null) {
        let inStock = picks.inStock;
        clauses.push({
          field: 'inStock',
          keep: (r) => r.doc.inStock === inStock,
          typed: { eq: { inStock } },
          saved: { on, eq: { inStock } },
        });
      }
      let kept = admit(
        products(),
        clauses.map((c) => c.keep),
      );
      // The rows a facet counts: every clause but the one on its own field.
      let counted = (by: string) =>
        products().filter((r) =>
          clauses.every((c) => c.field === by || c.keep(r)),
        );
      for (let { by } of sidebarFacets.filter((f) => f.own)) {
        if (
          clauses.some((c) => c.field === by) &&
          counted(by).length === kept.length
        ) {
          fixture(`the ${by} pick turns away nothing its facet would count`);
        }
      }
      return {
        kept,
        counted,
        typedFilter: { every: clauses.map((c) => c.typed) },
        savedFilter: { every: [{ type: on }, ...clauses.map((c) => c.saved)] },
      };
    }

    function sidebarCounts(
      assert: Assert,
      got: Answer,
      side: ReturnType<typeof sidebar>,
      form: string,
    ) {
      assert.deepEqual(
        facetMap(got, 'brand'),
        valueCounts(side.counted('brand'), 'brand'),
        `${form}: brand counts, without the brand pick`,
      );
      let brandCounts = (got.meta.facets?.brand ?? []).map(
        (f: { count: number }) => f.count,
      );
      assert.deepEqual(
        brandCounts,
        [...brandCounts].sort((a: number, b: number) => b - a),
        `${form}: most common brand first`,
      );
      assert.deepEqual(
        facetMap(got, 'price'),
        bucketCounts(side.counted('price'), 'price', priceBuckets),
        `${form}: price buckets, the last open at the top, without the price pick`,
      );
      statsMatch(assert, got, 'price', side.counted('price'), form);
      assert.deepEqual(
        facetMap(got, 'rating'),
        bucketCounts(side.counted('rating'), 'rating', starBuckets),
        `${form}: overlapping star floors, without the stars pick`,
      );
      assert.deepEqual(
        facetMap(got, 'inStock'),
        valueCounts(side.counted('inStock'), 'inStock'),
        `${form}: in stock or not, without the switch`,
      );
      assert.deepEqual(
        facetMap(got, 'colors'),
        valueCounts(side.kept, 'colors'),
        `${form}: colors count under every pick`,
      );
    }

    // Runs a sidebar search under one sort in every form, with the facets and
    // without, and hands each answer to `rows` for the ranking's own check.
    async function sidebarSearch(
      assert: Assert,
      side: ReturnType<typeof sidebar>,
      sort: { typed: Q[]; saved?: Q[]; wire?: Q[] },
      rows: (got: Answer, form: string) => void,
    ) {
      let page = { size: 24, total: 'exact' };
      let build = (facets: boolean) =>
        forms({
          ...(sort.saved
            ? {
                saved: {
                  filter: side.savedFilter,
                  sort: sort.saved,
                  ...(facets ? { facets: sidebarFacets } : {}),
                  page,
                },
              }
            : {}),
          ...(sort.wire
            ? {
                anchored: {
                  query: {
                    filter: side.savedFilter,
                    ...(facets ? { facets: sidebarFacets } : {}),
                    page,
                  },
                  sort: sort.wire,
                },
              }
            : {}),
          typed: {
            type: productRef,
            filter: side.typedFilter,
            sort: sort.typed,
            ...(facets ? { facets: sidebarFacets } : {}),
            page,
          },
        });
      let faceted = build(true);
      let plain = build(false);
      for (let [i, [form, q]] of faceted.entries()) {
        let got = await ask(q);
        assert.deepEqual(
          [...got.names].sort(),
          side.kept.map((r) => r.name).sort(),
          `${form}: the rows every pick keeps`,
        );
        assert.strictEqual(
          got.meta.page.total,
          side.kept.length,
          `${form}: total`,
        );
        rows(got, form);
        sidebarCounts(assert, got, side, form);
        let bare = await ask(plain[i][1]);
        assert.deepEqual(
          bare.names,
          got.names,
          `${form}: asking for facets changes neither the rows nor their order`,
        );
      }
    }

    const everyPick: Picks = {
      words: 'brass',
      brands: ['Cinder', 'Birch', 'Arlo'],
      price: { gte: 50, lt: 300 },
      stars: 4,
      inStock: true,
    };
    const byCardURL = { by: 'cardURL' };

    test('the shop search page: words and sidebar picks under a relevance sort, each facet counting without its own pick', async function (assert) {
      let on = productRef;
      let side = sidebar(everyPick);
      // The docs give relevance no order this file can compute while text is
      // one of its signals, so the rows are checked as a set here.
      await sidebarSearch(
        assert,
        side,
        {
          typed: [{ relevance: true }, byCardURL],
          wire: [{ 'item.on': on, relevance: true }, { by: 'item.cardURL' }],
        },
        () => {},
      );
    });

    test('the same page sorted by a plain field, and by text relevance alone', async function (assert) {
      let on = productRef;
      let side = sidebar(everyPick);
      let cheapestLast = [...side.kept]
        .sort(comparator([{ by: 'price', direction: 'desc' }]))
        .map((r) => r.name);
      await sidebarSearch(
        assert,
        side,
        {
          typed: [{ by: 'price', direction: 'desc' }],
          saved: [{ on, by: 'price', direction: 'desc' }],
        },
        (got, form) =>
          assert.deepEqual(got.names, cheapestLast, `${form}: dearest first`),
      );
      await sidebarSearch(
        assert,
        side,
        { typed: [{ by: 'textRelevance' }, byCardURL] },
        (got, form) => {
          let scores = got.rows.map((r) => Number(r._matchRelevance));
          assert.true(
            scores.every((s) => s > 0),
            `${form}: every row carries its text relevance`,
          );
          assert.deepEqual(
            scores,
            [...scores].sort((a, b) => b - a),
            `${form}: rows are in the order of the relevance they carry`,
          );
        },
      );
    });

    test('looks like: no words, the picks stay, sorted by similarity and by a fused ranking, with the same facets', async function (assert) {
      let on = productRef;
      let side = sidebar({
        brands: ['Cinder', 'Birch', 'Arlo'],
        price: { gte: 50, lt: 300 },
        inStock: true,
      });
      assert.notStrictEqual(
        withoutVector(side.kept).length,
        0,
        'the fixture keeps a row with no vector',
      );
      let ranked = nearest(side.kept, TASTE);
      await sidebarSearch(
        assert,
        side,
        {
          typed: [{ by: 'embedding', near: TASTE }],
          saved: [{ on, by: 'embedding', near: TASTE }],
        },
        (got, form) =>
          nearestFirst(assert, got, ranked, withoutVector(side.kept), form),
      );
      let expected = fuse(side.kept, [
        { near: TASTE, weight: 2 },
        { by: 'views' },
        { by: 'price', direction: 'asc', weight: 0.5 },
      ]);
      await sidebarSearch(
        assert,
        side,
        {
          typed: [
            {
              blend: [
                { by: 'embedding', near: TASTE, weight: 2 },
                { by: 'views' },
                { by: 'price', direction: 'asc', weight: 0.5 },
              ],
            },
          ],
        },
        (got, form) => fused(assert, got, expected, form),
      );
    });

    test('a shelf rule: ranges and a switch with no words, ranked by weighted popularity and quality', async function (assert) {
      let on = productRef;
      let kept = admit(products(), [
        (r) => r.doc.inStock === true,
        (r) => num(r.doc.price) <= 300,
        (r) => r.doc.rating != null && num(r.doc.rating) >= 3.5,
      ]);
      // Relevance compiles to a blend of the signals the type declares, with
      // the default k: views is its popularity and rating its quality. No
      // words, so there is no text signal.
      let expected = fuse(kept, [
        { by: 'views', weight: 1 },
        { by: 'rating', weight: 0.4 },
      ]);
      let leastSeen = fuse(kept, [
        { by: 'views', weight: -1 },
        { by: 'rating', weight: 0.4 },
      ]);
      let weights = { popularity: 1, quality: 0.4, recency: 0, priority: 0 };
      let cases: [string, { name: string; score: number }[], [string, Q][]][] =
        (
          [
            ['most seen', expected, weights],
            ['least seen', leastSeen, { ...weights, popularity: -1 }],
          ] as const
        ).map(([name, ranking, relevance]) => [
          name,
          ranking,
          forms({
            anchored: {
              query: {
                filter: {
                  every: [
                    { type: on },
                    { on, eq: { inStock: true } },
                    { on, range: { price: { lte: 300 } } },
                    { on, range: { rating: { gte: 3.5 } } },
                  ],
                },
                page: { size: 12 },
              },
              sort: [{ 'item.on': on, relevance }],
            },
            typed: {
              type: on,
              filter: {
                every: [
                  { eq: { inStock: true } },
                  { range: { price: { lte: 300 } } },
                  { range: { rating: { gte: 3.5 } } },
                ],
              },
              sort: [{ relevance }],
              page: { size: 12 },
            },
          }),
        ]);
      for (let [name, ranking, variants] of cases) {
        for (let [form, q] of variants) {
          fused(assert, await ask(q), ranking, `${name}, ${form}`);
        }
      }
    });

    test('relevance by words alone ranks a title match over a body match, and by meaning alone is the similarity order', async function (assert) {
      let on = productRef;
      let linen = admit(products(), [(r) => has(r, 'linen')]);
      let inTitle = linen.filter((r) =>
        String(r.doc.title).toLowerCase().split(' ').includes('linen'),
      );
      assert.strictEqual(
        inTitle.length,
        1,
        'one product has the word in its title',
      );
      assert.true(linen.length > 2, 'and others only in their blurb');
      let off = { popularity: 0, quality: 0, recency: 0, priority: 0 };
      let worded = forms({
        anchored: {
          query: { filter: { on, matches: 'linen' }, page: { size: 24 } },
          sort: [{ 'item.on': on, relevance: { text: 1, ...off } }],
        },
        typed: {
          type: on,
          filter: { matches: 'linen' },
          sort: [{ relevance: { text: 1, ...off } }],
          page: { size: 24 },
        },
      });
      // Text and the declared signals off, `near` given: only meaning ranks,
      // and a product with no vector gets nothing from it.
      let brass = admit(products(), [(r) => has(r, 'brass')]);
      let ranked = fuse(
        brass.filter((r) => r.vector),
        [{ near: TASTE }],
      );
      let meant = forms({
        typed: {
          type: on,
          filter: { matches: 'brass' },
          sort: [{ near: TASTE, relevance: { text: 0, meaning: 1, ...off } }],
          page: { size: 24 },
        },
      });
      for (let [form, q] of worded) {
        let got = await ask(q);
        assert.deepEqual(
          [...got.names].sort(),
          linen.map((r) => r.name).sort(),
          `${form}: the rows holding the word`,
        );
        assert.strictEqual(
          got.names[0],
          inTitle[0].name,
          `${form}: the title match comes first`,
        );
      }
      for (let [form, q] of meant) {
        let got = await ask(q);
        assert.deepEqual(
          got.names.slice(0, ranked.length),
          ranked.map((e) => e.name),
          `${form}: most similar first`,
        );
        assert.deepEqual(
          got.names.slice(ranked.length).sort(),
          withoutVector(brass),
          `${form}: the match with no vector is kept, after the ranked ones`,
        );
      }
    });

    test('a misspelled word beside structured picks: one edit away is found, two is not, and an always-true branch keeps every row', async function (assert) {
      let on = productRef;
      let walnut = (r: Row) => has(r, 'walnut');
      let living = (r: Row) => r.doc.department === 'Living';
      let dune = (r: Row) => r.doc.brand === 'Dune';
      let under = (r: Row) => num(r.doc.price) < 300;
      let names = (rows: Row[]) => rows.map((r) => r.name).sort();
      // "walnot" is one edit from "walnut", a word of the titles; "wolnot" is
      // two, past the one edit a six-letter word is allowed.
      let cases: [string, string[], Intent][] = [
        [
          'the misspelling and a department',
          names(admit(products(), [walnut, living])),
          {
            saved: {
              filter: {
                every: [
                  { type: on },
                  { on, matches: 'walnot', typos: true },
                  { on, eq: { department: 'Living' } },
                ],
              },
            },
            typed: {
              type: on,
              filter: {
                every: [
                  { matches: 'walnot', typos: true },
                  { eq: { department: 'Living' } },
                ],
              },
            },
          },
        ],
        [
          'the misspelling or a brand, under a price',
          names(admit(products(), [(r) => walnut(r) || dune(r), under])),
          {
            saved: {
              filter: {
                every: [
                  { type: on },
                  {
                    any: [
                      { on, matches: 'walnot', typos: true },
                      { on, eq: { brand: 'Dune' } },
                    ],
                  },
                  { on, range: { price: { lt: 300 } } },
                ],
              },
            },
            typed: {
              type: on,
              filter: {
                every: [
                  {
                    any: [
                      { matches: 'walnot', typos: true },
                      { eq: { brand: 'Dune' } },
                    ],
                  },
                  { range: { price: { lt: 300 } } },
                ],
              },
            },
          },
        ],
        [
          'a word too far or a brand, under a price: the brand alone',
          names(products().filter((r) => dune(r) && under(r))),
          {
            typed: {
              type: on,
              filter: {
                every: [
                  {
                    any: [
                      { matches: 'wolnot', typos: true },
                      { eq: { brand: 'Dune' } },
                    ],
                  },
                  { range: { price: { lt: 300 } } },
                ],
              },
            },
          },
        ],
        [
          'the misspelling beside a type anchor that is always true: the department',
          names(admit(products(), [living])),
          {
            saved: {
              filter: {
                every: [
                  { type: on },
                  {
                    any: [{ on, matches: 'walnot', typos: true }, { type: on }],
                  },
                  { on, eq: { department: 'Living' } },
                ],
              },
            },
            typed: {
              type: on,
              filter: {
                every: [
                  { any: [{ matches: 'walnot', typos: true }, { type: on }] },
                  { eq: { department: 'Living' } },
                ],
              },
            },
          },
        ],
        [
          'a word too far and a department: nothing',
          [],
          {
            typed: {
              type: on,
              filter: {
                every: [
                  { matches: 'wolnot', typos: true },
                  { eq: { department: 'Living' } },
                ],
              },
            },
          },
        ],
        [
          'the misspelling without typos: nothing',
          [],
          {
            typed: {
              type: on,
              filter: {
                every: [
                  { matches: 'walnot' },
                  { eq: { department: 'Living' } },
                ],
              },
            },
          },
        ],
      ];
      let planned = cases.map(([name, expected, intent]) => ({
        name,
        expected,
        all: forms({
          ...(intent.saved
            ? { saved: { ...intent.saved, page: { size: 50 } } }
            : {}),
          typed: { ...intent.typed, page: { size: 50 } },
        }),
      }));
      for (let { name, expected, all } of planned) {
        for (let [form, q] of all) {
          assert.deepEqual(
            (await ask(q)).names.sort(),
            expected,
            `${name}, ${form}`,
          );
        }
      }
    });

    test('a page of one row read as a count gives the number of matches', async function (assert) {
      let cases: [
        string,
        number,
        Intent,
        ((got: Answer, form: string) => void)?,
      ][] = [
        [
          'posts liked fifty times or more, outside a subtype',
          admit(posts(), [
            (r) => num(r.doc.likes) >= 50,
            (r) => r.type !== 'Video',
          ]).length,
          {
            saved: {
              filter: {
                every: [
                  { type: postRef },
                  { not: { type: videoRef } },
                  { on: postRef, range: { likes: { gte: 50 } } },
                ],
              },
            },
            typed: {
              type: postRef,
              filter: {
                every: [
                  { not: { type: videoRef } },
                  { range: { likes: { gte: 50 } } },
                ],
              },
            },
          },
        ],
        [
          'products in either of two colors',
          admit(products(), [
            (r) => list(r.doc.colors).some((c) => ['grey', 'oak'].includes(c)),
          ]).length,
          {
            saved: {
              filter: {
                any: [
                  { on: productRef, eq: { colors: 'grey' } },
                  { on: productRef, eq: { colors: 'oak' } },
                ],
              },
            },
            typed: {
              type: productRef,
              filter: {
                any: [{ eq: { colors: 'grey' } }, { eq: { colors: 'oak' } }],
              },
            },
          },
        ],
        [
          'posts near a vector',
          admit(posts(), [
            (r) => r.vector != null && cosine(r.vector, TASTE) >= 0.7,
          ]).length,
          {
            saved: {
              filter: {
                on: postRef,
                near: { embedding: { to: TASTE, minSimilarity: 0.7 } },
              },
            },
            typed: {
              type: postRef,
              filter: {
                near: { embedding: { to: TASTE, minSimilarity: 0.7 } },
              },
            },
          },
        ],
        [
          'every product, with one facet over the whole catalog',
          products().length,
          {
            saved: {
              filter: { type: productRef },
              facets: [{ by: 'brand', own: 'ignore', size: 200 }],
            },
            typed: {
              type: productRef,
              facets: [{ by: 'brand', own: 'ignore', size: 200 }],
            },
          },
          (got, form) =>
            assert.deepEqual(
              facetMap(got, 'brand'),
              valueCounts(products(), 'brand'),
              `${form}: the facet counts every product`,
            ),
        ],
      ];
      let planned = cases.flatMap(([name, count, intent, also]) =>
        [{ size: 1, total: 'exact' }, { size: 1 }].map((page) => ({
          name: `${name}, ${page.total ? 'an exact total' : 'the default total'}`,
          count,
          also,
          all: forms({
            saved: { ...intent.saved, page },
            typed: { ...intent.typed, page },
          }),
        })),
      );
      for (let { name, count, also, all } of planned) {
        for (let [form, q] of all) {
          let got = await ask(q);
          assert.strictEqual(got.names.length, 1, `${name}, ${form}: one row`);
          assert.strictEqual(
            got.meta.page.total,
            count,
            `${name}, ${form}: total`,
          );
          also?.(got, `${name}, ${form}`);
        }
      }
    });
  });
});
