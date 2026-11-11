import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  baseCardRef,
  baseFileRef,
  baseRef,
  backfillFacetValues,
  facetFieldSpecsOf,
  IndexQueryEngine,
  internalKeyFor,
  param,
  query,
  type VirtualNetwork,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { lowerQuery } from '@cardstack/runtime-common/query-syntax';
import {
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common/search-entry';

import { createVirtualNetwork, setupDB } from './helpers/index.ts';

// Seven things the query language supports that no sample app uses: big
// integers, dates, string order, subclasses, paths through links, two
// conditions on one list, and files beside cards. Every row is seeded
// straight into boxel_index in the shape the indexer writes, and every
// expectation is computed here in plain JavaScript over the same rows (or
// reasoned by hand, with the reason beside it).
//
// Each case is asked in every form it has: as a query saved in a realm writes
// it (an `on` anchor), over the search wire (derived from the saved form and
// read back), in the newer spelling (a top-level `type`, bare clauses), and
// the newer spelling over the wire.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const refs = {
  string: ref('@cardstack/base/string', 'default'),
  number: ref('@cardstack/base/number', 'default'),
  bigInteger: ref('@cardstack/base/big-integer', 'default'),
  date: ref('@cardstack/base/date', 'default'),
  datetime: ref('@cardstack/base/datetime', 'default'),
  CardDef: baseCardRef,
  FileDef: baseFileRef,
  BaseDef: baseRef,
};

// --- definitions as plain objects --------------------------------------------

type FieldSpec = Record<string, unknown>;

const primitive = (
  fieldOrCard: ResolvedCodeRef,
  serializerName?: string,
): FieldSpec => ({
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard,
  ...(serializerName ? { serializerName } : {}),
  // Every field here is a facet: these cases test how types and paths read,
  // not which fields declare one.
  search: { facet: true },
});

const F = {
  string: primitive(refs.string),
  number: primitive(refs.number, 'number'),
  bigInteger: primitive(refs.bigInteger, 'big-integer'),
  date: primitive(refs.date, 'date'),
  datetime: primitive(refs.datetime, 'datetime'),
  many: (of: FieldSpec): FieldSpec => ({ ...of, type: 'containsMany' }),
  compounds: (of: ResolvedCodeRef): FieldSpec => ({
    type: 'containsMany',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: of,
    search: { facet: true },
  }),
  link: (to: ResolvedCodeRef, searchable?: unknown): FieldSpec => ({
    type: 'linksTo',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: to,
    search: { facet: true },
    ...(searchable === undefined ? {} : { searchable }),
  }),
  links: (to: ResolvedCodeRef, searchable?: unknown): FieldSpec => ({
    type: 'linksToMany',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: to,
    search: { facet: true },
    ...(searchable === undefined ? {} : { searchable }),
  }),
};

function definition(
  codeRef: ResolvedCodeRef,
  fields: Record<string, FieldSpec>,
  kind: 'card-def' | 'field-def' | 'file-def' = 'card-def',
): Definition {
  // Every card has an `id`, as CardDef declares one.
  let all = kind === 'card-def' ? { id: F.string, ...fields } : fields;
  let names = Object.keys(all);
  return {
    type: kind,
    codeRef,
    displayName: codeRef.name,
    fields: Object.fromEntries(names.map((n, i) => [n, `f${i}`])),
    fieldDefs: Object.fromEntries(names.map((n, i) => [`f${i}`, all[n]])),
  } as unknown as Definition;
}

function makeDefinitionLookup(definitions: Definition[]): DefinitionLookup {
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

// --- rows ------------------------------------------------------------------------

type Doc = Record<string, any>;
interface Row {
  name: string;
  // The row's whole type chain, most specific first and ending at BaseDef,
  // as the indexer stamps `types`.
  chain: ResolvedCodeRef[];
  doc: Doc;
  kind?: 'instance' | 'file';
  // Defaults to the realm URL plus the name.
  url?: string;
}

const cardChain = (...own: ResolvedCodeRef[]) => [
  ...own,
  refs.CardDef,
  refs.BaseDef,
];

async function seed(
  dbAdapter: PgAdapter,
  vn: VirtualNetwork,
  realm: string,
  rows: Row[],
) {
  for (let row of rows) {
    let url = row.url ?? `${realm}${row.name}`;
    let kind = row.kind ?? 'instance';
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
      param(kind),
      `,`,
      param(JSON.stringify({ id: url, type: 'card' })),
      `::jsonb,`,
      param(
        JSON.stringify(kind === 'instance' ? { id: url, ...row.doc } : row.doc),
      ),
      `::jsonb,`,
      `'[]'::jsonb,`,
      param(
        JSON.stringify(row.chain.map((r) => internalKeyFor(r, undefined, vn))),
      ),
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
  // The rows went straight into boxel_index: their facet rows are written
  // from their search docs, as a declaration change does.
  let lookup = makeDefinitionLookup(DEFINITIONS);
  let own = new Map(
    rows
      .filter((row) => (row.kind ?? 'instance') === 'instance')
      .map((row) => [
        internalKeyFor(row.chain[0], undefined, vn),
        row.chain[0],
      ]),
  );
  for (let [key, type] of own) {
    let def = await lookup.lookupDefinition(type).catch(() => undefined);
    if (!def) continue;
    await backfillFacetValues(
      dbAdapter,
      realm,
      key,
      await facetFieldSpecsOf(def, (r) =>
        lookup.lookupDefinition(r as ResolvedCodeRef),
      ),
    );
  }
}

const everything = { size: 200, total: 'exact' as const };

interface Parts {
  filter?: Record<string, any>;
  sort?: Record<string, any>[];
  facets?: Record<string, any>[];
}

// One question about one type, in the two spellings a query has.
function ask(type: ResolvedCodeRef, parts: Parts) {
  let rest = parts.facets ? { facets: parts.facets } : {};
  return {
    saved: {
      filter: parts.filter ? { on: type, ...parts.filter } : { type },
      ...(parts.sort
        ? { sort: parts.sort.map((s) => ({ on: type, ...s })) }
        : {}),
      ...rest,
      page: everything,
    } as Record<string, any>,
    typed: {
      type,
      ...(parts.filter ? { filter: parts.filter } : {}),
      ...(parts.sort ? { sort: parts.sort } : {}),
      ...rest,
      page: everything,
    } as Record<string, any>,
  };
}

interface Asked {
  saved?: Record<string, any>;
  typed?: Record<string, any>;
}

// Every form the question has, as the query the engine is handed.
function forms(asked: Asked): [string, () => Record<string, any>][] {
  let out: [string, () => Record<string, any>][] = [];
  let { saved, typed } = asked;
  if (saved) {
    out.push(['as saved', () => saved!]);
    out.push([
      'over the wire',
      () =>
        parseSearchEntryQueryFromPayload(
          JSON.parse(
            JSON.stringify(searchEntryWireQueryFromQuery(saved as Query)),
          ),
        ).itemQuery,
    ]);
  }
  if (typed) {
    out.push(['newer spelling', () => lowerQuery(typed!).query]);
    out.push([
      'newer spelling over the wire',
      () =>
        parseSearchEntryQueryFromPayload(JSON.parse(JSON.stringify(typed)))
          .itemQuery,
    ]);
  }
  return out;
}

const byName = (a: Row, b: Row) => (a.name < b.name ? -1 : 1);

// Rows in the order a comparator over their docs gives. A row the comparator
// has no value for (`valueOf` gives null) goes last whichever way the sort
// runs, as the docs say of a field sort, and ties fall back to the URL.
function ordered<V>(
  rows: Row[],
  valueOf: (row: Row) => V | null | undefined,
  compare: (a: V, b: V) => number,
  direction: 'asc' | 'desc',
): string[] {
  return [...rows]
    .sort((a, b) => {
      let va = valueOf(a);
      let vb = valueOf(b);
      if (va == null || vb == null) {
        return va == null && vb == null ? byName(a, b) : va == null ? 1 : -1;
      }
      let c = compare(va, vb) * (direction === 'asc' ? 1 : -1);
      return c || byName(a, b);
    })
    .map((row) => row.name);
}

function countsOf(values: (string | null | undefined)[]) {
  let counts: Record<string, number> = {};
  for (let v of values) {
    if (v != null) counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

// The start of the UTC day, week (Monday), month or year a calendar day is
// in, as `YYYY-MM-DD`.
function bucketOf(day: string, interval: 'day' | 'week' | 'month' | 'year') {
  if (interval === 'day') return day;
  if (interval === 'month') return `${day.slice(0, 7)}-01`;
  if (interval === 'year') return `${day.slice(0, 4)}-01-01`;
  let d = new Date(`${day}T00:00:00.000Z`);
  let sinceMonday = (d.getUTCDay() + 6) % 7;
  return utcDay(new Date(d.getTime() - sinceMonday * DAY_MS));
}

// A date-time as the index holds it: the field's zoneless spelling
// (`yyyy-MM-ddTHH:mm`), which a query reads as UTC. Written here in UTC so the
// fixture means the same instants on a machine in any time zone; the
// serializer still writes its local wall time, a known follow-up.
const stored = (iso: string | Date) => new Date(iso).toISOString().slice(0, 16);

// --- 1. big integers ---------------------------------------------------------------

const bigRealm = 'http://qtp-big-integers/';
const Ledger = ref(`${bigRealm}ledger`, 'Ledger');
// A big integer is a decimal string in the search doc.
const BIG_ROWS: Row[] = (
  [
    ['two53', '9007199254740992'],
    ['two53plus1', '9007199254740993'],
    ['two53plus1again', '9007199254740993'],
    ['two53plus2', '9007199254740994'],
    ['minusTwo53plus1', '-9007199254740993'],
    ['thirtyDigits', '123456789012345678901234567890'],
    ['nine', '9'],
    ['ten', '10'],
    ['hundred', '100'],
    ['minusFive', '-5'],
    ['zero', '0'],
    ['none', null],
  ] as [string, string | null][]
).map(([name, amount]) => ({
  name,
  chain: cardChain(Ledger),
  doc: { amount },
}));
const amountOf = (row: Row): bigint | null =>
  row.doc.amount == null ? null : BigInt(row.doc.amount);
const bigNames = (keep: (n: bigint) => boolean) =>
  BIG_ROWS.filter((row) => {
    let n = amountOf(row);
    return n != null && keep(n);
  })
    .map((row) => row.name)
    .sort();

// --- 2. dates ------------------------------------------------------------------------

const dateRealm = 'http://qtp-dates/';
const Event = ref(`${dateRealm}event`, 'Event');
// 2024-03-03 is a Sunday and 2024-03-04 a Monday; 2024-01-01 is a Monday;
// 2024 is a leap year.
const EVENT_ROWS: Row[] = (
  [
    ['e01', '2023-12-31', '2023-06-15T12:00:00.000Z'],
    ['e02', '2024-01-01', '2024-03-04T10:00:00.000Z'],
    ['e03', '2024-02-28', '2024-03-04T10:30:00.000Z'],
    ['e04', '2024-02-29', '2024-12-31T23:59:00.000Z'],
    ['e05', '2024-03-01', '2025-01-01T00:01:00.000Z'],
    ['e06', '2024-03-03', null],
    ['e07', '2024-03-04', '2024-03-04T10:00:00.000Z'],
    ['e08', '2024-12-31', null],
    ['e09', '2025-01-01', null],
    ['e10', null, null],
    ['e11', '2024-03-04', null],
  ] as [string, string | null, string | null][]
).map(([name, day, at]) => ({
  name,
  chain: cardChain(Event),
  // `instant` is not a field: it is the true time the row's `at` was written
  // from, kept for the plain evaluation.
  doc: { day, at: at ? stored(at) : null, instant: at },
}));
const eventNames = (keep: (row: Row) => boolean) =>
  EVENT_ROWS.filter(keep)
    .map((row) => row.name)
    .sort();
const dayOf = (row: Row) => row.doc.day as string | null;
const instantOf = (row: Row) =>
  row.doc.instant == null ? null : Date.parse(row.doc.instant);

// Rows around the clock the test runs by, in a realm of their own.
const clockRealm = 'http://qtp-relative-dates/';
const Visit = ref(`${clockRealm}visit`, 'Visit');
const SEEDED_AT = Date.now();
// One row for each UTC day from 45 days back to 3 days ahead, so whichever
// day a bound falls on has a row on it and one on each side.
const DAY_OFFSETS = Array.from({ length: 49 }, (_, i) => i - 45);
// Hours from the seeding time. No row is within half an hour of a bound the
// tests ask about, so a slow run cannot move one across it.
const HOUR_OFFSETS = [-73, -49, -25, -23, -3, -0.5, 1, 25];
const VISIT_ROWS: Row[] = [
  ...DAY_OFFSETS.map((offset) => ({
    name: `day${offset < 0 ? 'm' : 'p'}${String(Math.abs(offset)).padStart(2, '0')}`,
    chain: cardChain(Visit),
    doc: { day: utcDay(new Date(SEEDED_AT + offset * DAY_MS)), at: null },
  })),
  ...HOUR_OFFSETS.map((offset, i) => ({
    name: `hour${i}`,
    chain: cardChain(Visit),
    doc: {
      day: null,
      at: stored(new Date(SEEDED_AT + offset * HOUR_MS)),
      instant: SEEDED_AT + offset * HOUR_MS,
    },
  })),
  { name: 'blank', chain: cardChain(Visit), doc: { day: null, at: null } },
];

// --- 3. strings ------------------------------------------------------------------------

const textRealm = 'http://qtp-strings/';
const Label = ref(`${textRealm}label`, 'Label');
const TEXTS: [string, string | null][] = [
  ['lowerApple', 'apple'],
  ['upperApple', 'Apple'],
  ['accentApple', 'äpple'],
  ['spaceApple', ' apple'],
  ['lowerBanana', 'banana'],
  ['upperBanana', 'Banana'],
  ['eclair', 'eclair'],
  ['accentEclair', 'éclair'],
  ['lowerZebra', 'zebra'],
  ['upperZebra', 'Zebra'],
  ['item2', 'item 2'],
  ['item9', 'item 9'],
  ['item10', 'item 10'],
  ['greek', 'Ωmega'],
  ['kanji', '日本'],
  ['emoji', '😀 smile'],
  ['empty', ''],
  ['none', null],
];
const LABEL_ROWS: Row[] = TEXTS.map(([name, text]) => ({
  name,
  chain: cardChain(Label),
  doc: { text },
}));
const textOf = (row: Row) => row.doc.text as string | null;
const labelNames = (keep: (text: string) => boolean) =>
  LABEL_ROWS.filter((row) => textOf(row) != null && keep(textOf(row)!))
    .map((row) => row.name)
    .sort();

// --- 4. subclasses -----------------------------------------------------------------------

const classRealm = 'http://qtp-subclasses/';
const Animal = ref(`${classRealm}animal`, 'Animal');
const Bird = ref(`${classRealm}bird`, 'Bird');
const Fish = ref(`${classRealm}fish`, 'Fish');
// `code` is a number on a bird and a string on a fish.
const bird = (name: string, song: string | null, code: number | null): Row => ({
  name,
  chain: cardChain(Bird, Animal),
  doc: { title: name, song, code },
});
const fish = (
  name: string,
  depth: string | null,
  code: string | null,
): Row => ({
  name,
  chain: cardChain(Fish, Animal),
  doc: { title: name, depth, code },
});
const CLASS_ROWS: Row[] = [
  { name: 'animal1', chain: cardChain(Animal), doc: { title: 'animal1' } },
  { name: 'animal2', chain: cardChain(Animal), doc: { title: 'animal2' } },
  bird('bird1', 'trill', 9),
  bird('bird2', 'chirp', 10),
  bird('bird3', 'trill', 100),
  bird('bird4', null, null),
  fish('fish1', 'trill', '9'),
  fish('fish2', 'deep', '10'),
  fish('fish3', 'shallow', 'abc'),
  fish('fish4', null, null),
];
const isA = (row: Row, type: ResolvedCodeRef) => row.chain.includes(type);
const classNames = (keep: (row: Row) => boolean) =>
  CLASS_ROWS.filter(keep)
    .map((row) => row.name)
    .sort();

// --- 5. paths through links -------------------------------------------------------------

const linkRealm = 'http://qtp-links/';
const Country = ref(`${linkRealm}country`, 'Country');
const Maker = ref(`${linkRealm}maker`, 'Maker');
const Part = ref(`${linkRealm}part`, 'Part');
const Order = ref(`${linkRealm}order`, 'Order');

const country = (name: string) => ({ id: `${linkRealm}Country/${name}`, name });
const maker = (name: string, founded: number, from?: string) => ({
  id: `${linkRealm}Maker/${name}`,
  name,
  founded,
  country: from ? country(from) : null,
});
const part = (name: string, weight: number, by?: ReturnType<typeof maker>) => ({
  id: `${linkRealm}Part/${name}`,
  name,
  weight,
  // A part's maker is carried with its own fields, but the maker's country is
  // one hop further than the order's `items` route reaches: a bare id.
  maker: by
    ? { ...by, country: by.country ? { id: by.country.id } : null }
    : null,
});
const acme = maker('Acme', 1950, 'Norway');
const bolt = maker('Bolt', 1990, 'Chile');
const crux = maker('Crux', 2010);
const order = (
  name: string,
  brand: ReturnType<typeof maker> | null,
  items: ReturnType<typeof part>[] | null,
  secret: ReturnType<typeof maker> | null,
): Row => ({
  name,
  chain: cardChain(Order),
  doc: {
    brand,
    items,
    // `secret` is not searchable: the search doc holds only the link's id.
    secret: secret ? { id: secret.id } : null,
  },
});
const ORDER_ROWS: Row[] = [
  order('o1', acme, [part('gear', 5, acme), part('axle', 12, bolt)], bolt),
  order('o2', bolt, [part('gear', 5, acme)], acme),
  order('o3', crux, [part('axle', 12, bolt), part('rim', 20, crux)], acme),
  order('o4', acme, [part('rim', 20)], null),
  // No brand; an empty list of links is null in a search doc.
  order('o5', null, null, bolt),
  order('o6', bolt, [], null),
];
const orderNames = (keep: (doc: Doc) => boolean) =>
  ORDER_ROWS.filter((row) => keep(row.doc))
    .map((row) => row.name)
    .sort();
const itemsOf = (doc: Doc): ReturnType<typeof part>[] => doc.items ?? [];

// --- 6. a list of compound values ----------------------------------------------------

const kitRealm = 'http://qtp-compound-lists/';
const Swatch = ref(`${kitRealm}swatch`, 'Swatch');
const Kit = ref(`${kitRealm}kit`, 'Kit');
interface SwatchValue {
  color: string;
  size: number;
}
const kit = (
  name: string,
  items: SwatchValue[] | null,
  sizes: number[] | null,
): Row => ({ name, chain: cardChain(Kit), doc: { items, sizes } });
const KIT_ROWS: Row[] = [
  kit('redTen', [{ color: 'red', size: 10 }], [10]),
  kit(
    'redFiveBlueTen',
    [
      { color: 'red', size: 5 },
      { color: 'blue', size: 10 },
    ],
    [5, 20],
  ),
  kit('greenThree', [{ color: 'green', size: 3 }], [5, 12, 20]),
  kit('redFive', [{ color: 'red', size: 5 }], [3]),
  kit('emptyList', [], []),
  kit('noList', null, null),
];
const swatchesOf = (row: Row): SwatchValue[] => row.doc.items ?? [];
const sizesOf = (row: Row): number[] => row.doc.sizes ?? [];
const kitNames = (keep: (row: Row) => boolean) =>
  KIT_ROWS.filter(keep)
    .map((row) => row.name)
    .sort();

// --- 7. files beside cards -------------------------------------------------------------

const mixedRealm = 'http://qtp-mixed/';
const Note = ref(`${mixedRealm}note`, 'Note');
const MarkdownDef = ref(`${mixedRealm}markdown-def`, 'MarkdownDef');
const fileChain = (...own: ResolvedCodeRef[]) => [
  ...own,
  refs.FileDef,
  refs.BaseDef,
];
// A card's `.json` is indexed twice under one URL: as an instance and as a
// file. The file row carries `_isCardInstanceFile`.
const noteRows = (name: string, title: string, body: string): Row[] => [
  {
    name: `instance:${name}`,
    url: `${mixedRealm}${name}.json`,
    chain: cardChain(Note),
    doc: { cardTitle: title, _title: title, _cardType: 'Note', body },
  },
  {
    name: `file:${name}`,
    url: `${mixedRealm}${name}.json`,
    kind: 'file',
    chain: fileChain(),
    doc: {
      name: `${name}.json`,
      _title: `${name}.json`,
      _isCardInstanceFile: true,
    },
  },
];
const fileRow = (name: string, own: ResolvedCodeRef[] = []): Row => ({
  name: `file:${name}`,
  url: `${mixedRealm}${name}`,
  kind: 'file',
  chain: fileChain(...own),
  doc: { name, _title: name },
});
const MIXED_ROWS: Row[] = [
  ...noteRows('alpha', 'Alpha plan', 'draft'),
  ...noteRows('gamma', 'gamma notes', 'final'),
  fileRow('Beta.md', [MarkdownDef]),
  fileRow('delta.txt'),
  fileRow('plan.md', [MarkdownDef]),
];
const mixedNames = (keep: (row: Row) => boolean) =>
  MIXED_ROWS.filter(keep)
    .map((row) => row.name)
    .sort();
const isFile = (row: Row) => row.kind === 'file';

const DEFINITIONS: Definition[] = [
  definition(refs.CardDef, {}),
  definition(refs.BaseDef, {}, 'field-def'),
  definition(refs.FileDef, { name: F.string }, 'file-def'),
  definition(Ledger, { amount: F.bigInteger }),
  definition(Event, { day: F.date, at: F.datetime }),
  definition(Visit, { day: F.date, at: F.datetime }),
  definition(Label, { text: F.string }),
  definition(Animal, { title: F.string }),
  definition(Bird, { title: F.string, song: F.string, code: F.number }),
  definition(Fish, { title: F.string, depth: F.string, code: F.string }),
  definition(Country, { name: F.string }),
  definition(Maker, {
    name: F.string,
    founded: F.number,
    country: F.link(Country),
  }),
  definition(Part, {
    name: F.string,
    weight: F.number,
    maker: F.link(Maker),
  }),
  definition(Order, {
    // The brand, and through it the brand's country.
    brand: F.link(Maker, ['', 'country']),
    // Each item, and through it the item's maker.
    items: F.links(Part, ['', 'maker']),
    secret: F.link(Maker),
  }),
  definition(Swatch, { color: F.string, size: F.number }, 'field-def'),
  definition(Kit, {
    items: F.compounds(Swatch),
    sizes: F.many(F.number),
  }),
  definition(Note, { cardTitle: F.string, body: F.string }),
  definition(MarkdownDef, { name: F.string }, 'file-def'),
];

module(basename(import.meta.filename), function () {
  module('query types and paths (Postgres integration)', function (hooks) {
    let engine: IndexQueryEngine;
    let db: PgAdapter;

    setupDB(hooks, {
      before: async (dbAdapter) => {
        db = dbAdapter;
        let vn = createVirtualNetwork();
        engine = new IndexQueryEngine(
          dbAdapter,
          makeDefinitionLookup(DEFINITIONS),
          vn,
        );
        await seed(dbAdapter, vn, bigRealm, BIG_ROWS);
        await seed(dbAdapter, vn, dateRealm, EVENT_ROWS);
        await seed(dbAdapter, vn, clockRealm, VISIT_ROWS);
        await seed(dbAdapter, vn, textRealm, LABEL_ROWS);
        await seed(dbAdapter, vn, classRealm, CLASS_ROWS);
        await seed(dbAdapter, vn, linkRealm, ORDER_ROWS);
        await seed(dbAdapter, vn, kitRealm, KIT_ROWS);
        await seed(dbAdapter, vn, mixedRealm, MIXED_ROWS);
      },
    });

    // Row names of a card search, in the order returned.
    async function search(realm: string, q: Record<string, any>) {
      let { cards, meta } = await engine.searchCards(
        new URL(realm),
        q as Query,
      );
      return {
        names: cards.map((c) => String(c.id).slice(realm.length)),
        meta: meta as Record<string, any>,
      };
    }

    function facetCounts(meta: Record<string, any>, by: string) {
      return Object.fromEntries(
        (meta.facets?.[by] ?? []).map((f: { value: string; count: number }) => [
          f.value,
          f.count,
        ]),
      );
    }

    // Asks the question in every form and checks the rows: as a set, or in
    // order when `inOrder` is set.
    async function expectRows(
      assert: Assert,
      realm: string,
      asked: Asked,
      expected: string[],
      opts: { inOrder?: boolean; label?: string } = {},
    ) {
      for (let [form, build] of forms(asked)) {
        let label = `${opts.label ? `${opts.label}, ` : ''}${form}`;
        let names: string[];
        try {
          ({ names } = await search(realm, build()));
        } catch (e: any) {
          assert.ok(false, `${label}: refused or failed: ${e.message}`);
          continue;
        }
        assert.deepEqual(
          opts.inOrder ? names : [...names].sort(),
          opts.inOrder ? expected : [...expected].sort(),
          label,
        );
      }
    }

    async function expectFacet(
      assert: Assert,
      realm: string,
      asked: Asked,
      by: string,
      expected: Record<string, number>,
      label = '',
    ) {
      for (let [form, build] of forms(asked)) {
        let name = `${label ? `${label}, ` : ''}${form}`;
        try {
          let { meta } = await search(realm, build());
          assert.deepEqual(facetCounts(meta, by), expected, name);
        } catch (e: any) {
          assert.ok(false, `${name}: refused or failed: ${e.message}`);
        }
      }
    }

    // ---------------------------------------------------------------------
    module('big integers', function () {
      const big = (parts: Parts) => ask(Ledger, parts);

      test('eq on a big integer written as a string tells 2^53 + 1 from 2^53', async function (assert) {
        await expectRows(
          assert,
          bigRealm,
          big({ filter: { eq: { amount: '9007199254740993' } } }),
          bigNames((n) => n === 9007199254740993n),
        );
        await expectRows(
          assert,
          bigRealm,
          big({ filter: { eq: { amount: '9007199254740992' } } }),
          ['two53'],
        );
      });

      test('eq on a big integer takes a query value written as a number', async function (assert) {
        await expectRows(
          assert,
          bigRealm,
          big({ filter: { eq: { amount: 10 } } }),
          ['ten'],
        );
        // 2^53 is the largest power of two a JavaScript number holds exactly.
        await expectRows(
          assert,
          bigRealm,
          big({ filter: { eq: { amount: 2 ** 53 } } }),
          ['two53'],
        );
      });

      test('eq on a negative big integer matches only that value', async function (assert) {
        await expectRows(
          assert,
          bigRealm,
          big({ filter: { eq: { amount: '-9007199254740993' } } }),
          ['minusTwo53plus1'],
        );
        await expectRows(
          assert,
          bigRealm,
          big({ filter: { eq: { amount: -5 } } }),
          ['minusFive'],
        );
      });

      test('eq null on a big integer matches the row with no value, and not zero', async function (assert) {
        await expectRows(
          assert,
          bigRealm,
          big({ filter: { eq: { amount: null } } }),
          ['none'],
        );
      });

      test('not eq on a big integer returns the other values and not the row with no value', async function (assert) {
        await expectRows(
          assert,
          bigRealm,
          big({ filter: { not: { eq: { amount: '9007199254740993' } } } }),
          bigNames((n) => n !== 9007199254740993n),
        );
      });

      test('in on a big integer matches each listed value exactly, strings and numbers alike', async function (assert) {
        await expectRows(
          assert,
          bigRealm,
          big({
            filter: { in: { amount: ['9007199254740993', '-5', '9'] } },
          }),
          bigNames((n) => [9007199254740993n, -5n, 9n].includes(n)),
          { label: 'strings' },
        );
        await expectRows(
          assert,
          bigRealm,
          big({ filter: { in: { amount: [9, 100, 0] } } }),
          bigNames((n) => [9n, 100n, 0n].includes(n)),
          { label: 'numbers' },
        );
      });

      for (let [bound, keep] of [
        ['gt', (n: bigint, b: bigint) => n > b],
        ['gte', (n: bigint, b: bigint) => n >= b],
        ['lt', (n: bigint, b: bigint) => n < b],
        ['lte', (n: bigint, b: bigint) => n <= b],
      ] as [string, (n: bigint, b: bigint) => boolean][]) {
        test(`range ${bound} on a big integer compares exactly past 2^53`, async function (assert) {
          for (let value of ['9007199254740993', '-9007199254740993']) {
            await expectRows(
              assert,
              bigRealm,
              big({ filter: { range: { amount: { [bound]: value } } } }),
              bigNames((n) => keep(n, BigInt(value))),
              { label: value },
            );
          }
        });
      }

      test('range on a big integer compares 9, 10 and 100 as numbers, not as text', async function (assert) {
        await expectRows(
          assert,
          bigRealm,
          big({ filter: { range: { amount: { gte: '9', lte: '100' } } } }),
          ['hundred', 'nine', 'ten'],
          { label: 'string bounds' },
        );
        await expectRows(
          assert,
          bigRealm,
          big({ filter: { range: { amount: { gt: 9, lt: 100 } } } }),
          ['ten'],
          { label: 'number bounds' },
        );
      });

      for (let direction of ['asc', 'desc'] as const) {
        test(`sort ${direction} on a big integer is numeric at any size, with no value last`, async function (assert) {
          await expectRows(
            assert,
            bigRealm,
            big({ sort: [{ by: 'amount', direction }] }),
            ordered(
              BIG_ROWS,
              amountOf,
              (a, b) => (a < b ? -1 : a > b ? 1 : 0),
              direction,
            ),
            { inOrder: true },
          );
        });
      }

      test('a facet on a big integer counts each exact value apart from its neighbors', async function (assert) {
        await expectFacet(
          assert,
          bigRealm,
          big({ facets: [{ by: 'amount' }] }),
          'amount',
          countsOf(BIG_ROWS.map((row) => row.doc.amount)),
        );
      });

      test('facet statistics on a big integer give the numeric least and greatest', async function (assert) {
        // The docs give a number facet's stats min and max, and the engine
        // treats a big integer as a number. The least is the negative value
        // and the greatest the thirty-digit one; as text they would be "-5"
        // and "9".
        let amounts = BIG_ROWS.map(amountOf).filter(
          (n): n is bigint => n != null,
        );
        let least = amounts.reduce((a, b) => (b < a ? b : a));
        let greatest = amounts.reduce((a, b) => (b > a ? b : a));
        for (let [form, build] of forms(
          big({ facets: [{ by: 'amount', stats: true }] }),
        )) {
          let { meta } = await search(bigRealm, build());
          let stats = meta.facetStats?.amount ?? {};
          assert.strictEqual(
            String(stats.min),
            String(least),
            `${form}: least`,
          );
          assert.strictEqual(
            String(stats.max),
            String(greatest),
            `${form}: greatest`,
          );
        }
      });
    });

    // ---------------------------------------------------------------------
    module('dates', function () {
      const events = (parts: Parts) => ask(Event, parts);
      const visits = (parts: Parts) => ask(Visit, parts);

      test('eq on a date field matches that calendar day only', async function (assert) {
        await expectRows(
          assert,
          dateRealm,
          events({ filter: { eq: { day: '2024-02-29' } } }),
          eventNames((row) => dayOf(row) === '2024-02-29'),
        );
        await expectRows(
          assert,
          dateRealm,
          events({ filter: { eq: { day: '2024-03-04' } } }),
          ['e07', 'e11'],
        );
      });

      test('eq null on a date field matches the rows with no date', async function (assert) {
        await expectRows(
          assert,
          dateRealm,
          events({ filter: { eq: { day: null } } }),
          eventNames((row) => dayOf(row) == null),
        );
      });

      for (let [bound, keep] of [
        ['gt', (a: string, b: string) => a > b],
        ['gte', (a: string, b: string) => a >= b],
        ['lt', (a: string, b: string) => a < b],
        ['lte', (a: string, b: string) => a <= b],
      ] as [string, (a: string, b: string) => boolean][]) {
        test(`range ${bound} on a date field keeps the days on that side, and never a row with no date`, async function (assert) {
          // A `YYYY-MM-DD` day orders as its text does.
          for (let value of ['2024-02-29', '2024-12-31']) {
            await expectRows(
              assert,
              dateRealm,
              events({ filter: { range: { day: { [bound]: value } } } }),
              eventNames(
                (row) => dayOf(row) != null && keep(dayOf(row)!, value),
              ),
              { label: value },
            );
          }
        });
      }

      test('range with two bounds on a date field keeps the days between them', async function (assert) {
        await expectRows(
          assert,
          dateRealm,
          events({
            filter: {
              range: { day: { gte: '2024-02-29', lt: '2024-03-04' } },
            },
          }),
          ['e04', 'e05', 'e06'],
        );
      });

      for (let direction of ['asc', 'desc'] as const) {
        test(`sort ${direction} on a date field is by day, with no date last`, async function (assert) {
          await expectRows(
            assert,
            dateRealm,
            events({ sort: [{ by: 'day', direction }] }),
            ordered(
              EVENT_ROWS,
              dayOf,
              (a, b) => (a < b ? -1 : a > b ? 1 : 0),
              direction,
            ),
            { inOrder: true },
          );
        });

        test(`sort ${direction} on a date-time field is by instant, with no value last`, async function (assert) {
          await expectRows(
            assert,
            dateRealm,
            events({ sort: [{ by: 'at', direction }] }),
            ordered(EVENT_ROWS, instantOf, (a, b) => a - b, direction),
            { inOrder: true },
          );
        });
      }

      test('eq on a date-time field matches the rows at that minute', async function (assert) {
        let at = '2024-03-04T10:00:00.000Z';
        await expectRows(
          assert,
          dateRealm,
          events({ filter: { eq: { at: stored(at) } } }),
          eventNames((row) => instantOf(row) === Date.parse(at)),
        );
      });

      for (let [bound, keep] of [
        ['gt', (a: number, b: number) => a > b],
        ['gte', (a: number, b: number) => a >= b],
        ['lt', (a: number, b: number) => a < b],
        ['lte', (a: number, b: number) => a <= b],
      ] as [string, (a: number, b: number) => boolean][]) {
        test(`range ${bound} on a date-time field keeps the instants on that side, and never a row with no value`, async function (assert) {
          let at = '2024-03-04T10:00:00.000Z';
          await expectRows(
            assert,
            dateRealm,
            events({ filter: { range: { at: { [bound]: stored(at) } } } }),
            eventNames(
              (row) =>
                instantOf(row) != null && keep(instantOf(row)!, Date.parse(at)),
            ),
          );
        });
      }

      // A relative bound on a date field is the UTC calendar day the bound
      // falls on. Each case computes that day from the clock, asks, and
      // checks the clock again: if the day the bound falls on moved while
      // the query ran (midnight UTC passed), it asks again.
      type DayBound = (now: number) => number;
      async function relativeDays(
        assert: Assert,
        range: Record<string, string>,
        instantOfBound: Record<string, DayBound>,
      ) {
        let dayRows = VISIT_ROWS.filter((row) => row.doc.day != null);
        let boundDays = (now: number) =>
          Object.fromEntries(
            Object.entries(instantOfBound).map(([op, f]) => [
              op,
              utcDay(new Date(f(now))),
            ]),
          );
        for (let [form, build] of forms(
          visits({ filter: { range: { day: range } } }),
        )) {
          let names: string[] = [];
          let days: Record<string, string> = {};
          for (let attempt = 0; attempt < 5; attempt++) {
            days = boundDays(Date.now());
            ({ names } = await search(clockRealm, build()));
            if (
              JSON.stringify(boundDays(Date.now())) === JSON.stringify(days)
            ) {
              break;
            }
          }
          let expected = dayRows
            .filter((row) =>
              Object.entries(days).every(([op, day]) => {
                let d = row.doc.day as string;
                return op === 'gt'
                  ? d > day
                  : op === 'gte'
                    ? d >= day
                    : op === 'lt'
                      ? d < day
                      : d <= day;
              }),
            )
            .map((row) => row.name)
            .sort();
          assert.notStrictEqual(expected.length, 0, `${form}: some rows match`);
          assert.notStrictEqual(
            expected.length,
            dayRows.length,
            `${form}: some rows do not`,
          );
          assert.deepEqual(
            [...names].sort(),
            expected,
            `${form}: ${JSON.stringify(range)} with bounds ${JSON.stringify(days)}`,
          );
        }
      }

      test('gte now-30d on a date field starts on the UTC day thirty days back', async function (assert) {
        await relativeDays(
          assert,
          { gte: 'now-30d' },
          { gte: (now) => now - 30 * DAY_MS },
        );
      });

      test('gt now-30d on a date field starts the day after the boundary day', async function (assert) {
        await relativeDays(
          assert,
          { gt: 'now-30d' },
          { gt: (now) => now - 30 * DAY_MS },
        );
      });

      test('lte now on a date field ends on today in UTC', async function (assert) {
        await relativeDays(assert, { lte: 'now' }, { lte: (now) => now });
      });

      test('lt now on a date field ends on yesterday in UTC', async function (assert) {
        await relativeDays(assert, { lt: 'now' }, { lt: (now) => now });
      });

      test('gt now on a date field is the days after today in UTC', async function (assert) {
        await relativeDays(assert, { gt: 'now' }, { gt: (now) => now });
      });

      test('two relative bounds on a date field keep the days between them', async function (assert) {
        await relativeDays(
          assert,
          { gte: 'now-7d', lte: 'now+1d' },
          { gte: (now) => now - 7 * DAY_MS, lte: (now) => now + DAY_MS },
        );
      });

      test('a relative bound in hours on a date field is the UTC day that hour falls on', async function (assert) {
        await relativeDays(
          assert,
          { gte: 'now-36h' },
          { gte: (now) => now - 36 * HOUR_MS },
        );
      });

      test('a relative bound in weeks on a date field is seven days each', async function (assert) {
        await relativeDays(
          assert,
          { gte: 'now-2w' },
          { gte: (now) => now - 14 * DAY_MS },
        );
      });

      test('a relative bound rounded to the month on a date field starts on the first of this UTC month', async function (assert) {
        await relativeDays(
          assert,
          { lt: 'now/M' },
          {
            lt: (now) => {
              let d = new Date(now);
              return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
            },
          },
        );
      });

      test('a relative bound rounded to the week on a date field starts on Monday', async function (assert) {
        await relativeDays(
          assert,
          { lt: 'now-1w/w' },
          {
            lt: (now) => {
              let d = new Date(now - 7 * DAY_MS);
              let sinceMonday = (d.getUTCDay() + 6) % 7;
              return d.getTime() - sinceMonday * DAY_MS;
            },
          },
        );
      });

      // A relative bound on a date-time field compares instants. The rows
      // are at least half an hour from every bound asked about.
      async function relativeHours(
        assert: Assert,
        range: Record<string, string>,
        keep: (instant: number, now: number) => boolean,
      ) {
        let hourRows = VISIT_ROWS.filter((row) => row.doc.instant != null);
        for (let [form, build] of forms(
          visits({ filter: { range: { at: range } } }),
        )) {
          let now = Date.now();
          let { names } = await search(clockRealm, build());
          let expected = hourRows
            .filter((row) => keep(row.doc.instant, now))
            .map((row) => row.name)
            .sort();
          assert.notStrictEqual(expected.length, 0, `${form}: some rows match`);
          assert.notStrictEqual(
            expected.length,
            hourRows.length,
            `${form}: some rows do not`,
          );
          assert.deepEqual(
            [...names].sort(),
            expected,
            `${form}: ${JSON.stringify(range)}`,
          );
        }
      }

      test('gte now-24h on a date-time field keeps the last day of instants and what is to come', async function (assert) {
        await relativeHours(
          assert,
          { gte: 'now-24h' },
          (t, now) => t >= now - 24 * HOUR_MS,
        );
      });

      test('gte now-1d on a date-time field is the same instant as now-24h', async function (assert) {
        await relativeHours(
          assert,
          { gte: 'now-1d' },
          (t, now) => t >= now - 24 * HOUR_MS,
        );
      });

      test('lt now on a date-time field keeps the past', async function (assert) {
        await relativeHours(assert, { lt: 'now' }, (t, now) => t < now);
      });

      test('gt now on a date-time field keeps the future', async function (assert) {
        await relativeHours(assert, { gt: 'now' }, (t, now) => t > now);
      });

      test('two relative bounds on a date-time field keep the instants between them', async function (assert) {
        await relativeHours(
          assert,
          { gte: 'now-2h', lte: 'now+2h' },
          (t, now) => t >= now - 2 * HOUR_MS && t <= now + 2 * HOUR_MS,
        );
      });

      test('a relative bound in minutes on a date-time field moves by minutes', async function (assert) {
        await relativeHours(
          assert,
          { gte: 'now-90m' },
          (t, now) => t >= now - 90 * 60_000,
        );
      });

      for (let interval of ['day', 'week', 'month', 'year'] as const) {
        test(`a date facet by ${interval} puts each day in the ${interval} that holds it`, async function (assert) {
          // The fixture has a day on each side of a month end, a year end, a
          // leap day and a Sunday-to-Monday week boundary.
          await expectFacet(
            assert,
            dateRealm,
            events({ facets: [{ by: 'day', interval }] }),
            'day',
            countsOf(
              EVENT_ROWS.map((row) =>
                dayOf(row) ? bucketOf(dayOf(row)!, interval) : null,
              ),
            ),
          );
        });
      }

      test('a date facet by week starts its weeks on Monday', async function (assert) {
        // By hand: Sunday 2024-03-03 closes the week of Monday 2024-02-26,
        // which also holds 02-28, 02-29 and 03-01; Monday 2024-03-04 opens
        // the next, with two rows.
        for (let [form, build] of forms(
          events({ facets: [{ by: 'day', interval: 'week' }] }),
        )) {
          let { meta } = await search(dateRealm, build());
          let counts = facetCounts(meta, 'day');
          assert.strictEqual(counts['2024-02-26'], 4, `${form}: week of 02-26`);
          assert.strictEqual(counts['2024-03-04'], 2, `${form}: week of 03-04`);
        }
      });

      test('a date facet lists no bucket for a month with no rows', async function (assert) {
        // pins current behavior; rule not yet decided
        for (let [form, build] of forms(
          events({ facets: [{ by: 'day', interval: 'month' }] }),
        )) {
          let { meta } = await search(dateRealm, build());
          let months = Object.keys(facetCounts(meta, 'day')).sort();
          assert.deepEqual(
            months,
            [
              '2023-12-01',
              '2024-01-01',
              '2024-02-01',
              '2024-03-01',
              '2024-12-01',
              '2025-01-01',
            ],
            form,
          );
        }
      });

      test('a date facet lists its buckets oldest first', async function (assert) {
        // pins current behavior; rule not yet decided (the docs say a facet's
        // entries come most common first, and say nothing else of an interval)
        for (let [form, build] of forms(
          events({ facets: [{ by: 'day', interval: 'year' }] }),
        )) {
          let { meta } = await search(dateRealm, build());
          assert.deepEqual(
            (meta.facets?.day ?? []).map((f: { value: string }) => f.value),
            ['2023-01-01', '2024-01-01', '2025-01-01'],
            form,
          );
        }
      });

      test('a date facet asked for its missing count reports the rows with no date', async function (assert) {
        for (let [form, build] of forms(
          events({ facets: [{ by: 'day', interval: 'year', missing: true }] }),
        )) {
          let { meta } = await search(dateRealm, build());
          assert.strictEqual(
            meta.facetStats?.day?.missing,
            EVENT_ROWS.filter((row) => dayOf(row) == null).length,
            form,
          );
        }
      });

      for (let interval of ['day', 'month', 'year'] as const) {
        test(`a date-time facet by ${interval} buckets an instant by its UTC day, either side of midnight`, async function (assert) {
          // 2024-12-31T23:59Z and 2025-01-01T00:01Z are two minutes apart
          // and in different days, months and years.
          await expectFacet(
            assert,
            dateRealm,
            events({ facets: [{ by: 'at', interval }] }),
            'at',
            countsOf(
              EVENT_ROWS.map((row) =>
                row.doc.instant
                  ? bucketOf(utcDay(new Date(row.doc.instant)), interval)
                  : null,
              ),
            ),
          );
        });
      }
    });

    // ---------------------------------------------------------------------
    module('string order and matching', function () {
      const labels = (parts: Parts) => ask(Label, parts);

      test('eq on a string is exact about case', async function (assert) {
        // pins current behavior; rule not yet decided
        await expectRows(
          assert,
          textRealm,
          labels({ filter: { eq: { text: 'apple' } } }),
          labelNames((t) => t === 'apple'),
        );
        await expectRows(
          assert,
          textRealm,
          labels({ filter: { eq: { text: 'APPLE' } } }),
          [],
        );
      });

      test('eq on a string is exact about accents and leading spaces', async function (assert) {
        // pins current behavior; rule not yet decided
        await expectRows(
          assert,
          textRealm,
          labels({ filter: { eq: { text: 'eclair' } } }),
          ['eclair'],
        );
        await expectRows(
          assert,
          textRealm,
          labels({ filter: { eq: { text: 'äpple' } } }),
          ['accentApple'],
        );
        await expectRows(
          assert,
          textRealm,
          labels({ filter: { eq: { text: ' apple' } } }),
          ['spaceApple'],
        );
      });

      test('eq on an empty string matches the empty string and not a missing value', async function (assert) {
        await expectRows(
          assert,
          textRealm,
          labels({ filter: { eq: { text: '' } } }),
          ['empty'],
        );
      });

      test('eq null on a string matches a missing value and not the empty string', async function (assert) {
        await expectRows(
          assert,
          textRealm,
          labels({ filter: { eq: { text: null } } }),
          ['none'],
        );
      });

      test('eq on a string matches non-Latin text and emoji exactly', async function (assert) {
        for (let [name, text] of [
          ['greek', 'Ωmega'],
          ['kanji', '日本'],
          ['emoji', '😀 smile'],
        ]) {
          await expectRows(
            assert,
            textRealm,
            labels({ filter: { eq: { text } } }),
            [name],
            { label: text },
          );
        }
      });

      test('in on a string is exact about case and accents', async function (assert) {
        // pins current behavior; rule not yet decided
        let wanted = ['Apple', 'eclair', 'ZEBRA'];
        await expectRows(
          assert,
          textRealm,
          labels({ filter: { in: { text: wanted } } }),
          labelNames((t) => wanted.includes(t)),
        );
      });

      test('contains on a string ignores case', async function (assert) {
        await expectRows(
          assert,
          textRealm,
          labels({ filter: { contains: { text: 'APP' } } }),
          labelNames((t) => t.toLowerCase().includes('app')),
        );
      });

      test('contains on a string does not fold accents', async function (assert) {
        // pins current behavior; rule not yet decided
        await expectRows(
          assert,
          textRealm,
          labels({ filter: { contains: { text: 'ecl' } } }),
          ['eclair'],
          { label: 'plain letters' },
        );
        await expectRows(
          assert,
          textRealm,
          labels({ filter: { contains: { text: 'écl' } } }),
          ['accentEclair'],
          { label: 'accented letters' },
        );
      });

      test('contains on a string never matches a missing value', async function (assert) {
        await expectRows(
          assert,
          textRealm,
          labels({ filter: { contains: { text: 'e' } } }),
          labelNames((t) => t.toLowerCase().includes('e')),
        );
      });

      test('the order of strings is that of the database collation', async function (assert) {
        // pins current behavior; rule not yet decided. The docs name no
        // collation for a string sort or a string range, so the order is
        // whatever the database's default collation gives. This asks the
        // database to order the same strings itself and expects the sort to
        // agree with it, both ways, with no value last.
        let texts = TEXTS.map(([, t]) => t).filter(
          (t): t is string => t != null,
        );
        let ranked = (await db.execute(
          `SELECT t FROM unnest(ARRAY[${texts
            .map((t) => `'${t.replace(/'/g, "''")}'`)
            .join(',')}]::text[]) AS t ORDER BY t`,
        )) as { t: string }[];
        let rank = new Map(ranked.map((r, i) => [r.t, i]));
        for (let direction of ['asc', 'desc'] as const) {
          await expectRows(
            assert,
            textRealm,
            labels({ sort: [{ by: 'text', direction }] }),
            ordered(
              LABEL_ROWS,
              textOf,
              (a, b) => rank.get(a)! - rank.get(b)!,
              direction,
            ),
            { inOrder: true, label: direction },
          );
        }
      });

      test('a string sort puts the empty string first and a missing value last', async function (assert) {
        // The empty string is a value, and no string orders before it.
        for (let [form, build] of forms(labels({ sort: [{ by: 'text' }] }))) {
          let { names } = await search(textRealm, build());
          assert.strictEqual(names[0], 'empty', `${form}: first`);
          assert.strictEqual(names[names.length - 1], 'none', `${form}: last`);
          assert.strictEqual(names.length, LABEL_ROWS.length, `${form}: all`);
        }
      });

      test('a string sort orders digits inside strings as text', async function (assert) {
        // pins current behavior; rule not yet decided: "item 10" comes
        // before "item 2" and "item 9", character by character.
        for (let [form, build] of forms(labels({ sort: [{ by: 'text' }] }))) {
          let { names } = await search(textRealm, build());
          let items = names.filter((n) => n.startsWith('item'));
          assert.deepEqual(items, ['item10', 'item2', 'item9'], form);
        }
      });

      test('a string range keeps the strings the database collation orders on that side', async function (assert) {
        // pins current behavior; rule not yet decided (see the sort above)
        let texts = TEXTS.map(([, t]) => t).filter(
          (t): t is string => t != null,
        );
        for (let bound of ['banana', 'Banana', 'item 2']) {
          let above = (await db.execute(
            `SELECT t FROM unnest(ARRAY[${texts
              .map((t) => `'${t.replace(/'/g, "''")}'`)
              .join(',')}]::text[]) AS t WHERE t >= '${bound}'`,
          )) as { t: string }[];
          let kept = new Set(above.map((r) => r.t));
          await expectRows(
            assert,
            textRealm,
            labels({ filter: { range: { text: { gte: bound } } } }),
            labelNames((t) => kept.has(t)),
            { label: bound },
          );
        }
      });

      test('a string range never returns a missing value', async function (assert) {
        // Every string is at or after the empty string.
        await expectRows(
          assert,
          textRealm,
          labels({ filter: { range: { text: { gte: '' } } } }),
          labelNames(() => true),
        );
      });
    });

    // ---------------------------------------------------------------------
    module('subclasses', function () {
      test('a type filter on the base type returns the rows of every subclass', async function (assert) {
        await expectRows(
          assert,
          classRealm,
          {
            saved: { filter: { type: Animal }, page: everything },
            typed: { type: Animal, page: everything },
          },
          classNames((row) => isA(row, Animal)),
        );
      });

      test('a type filter on one subclass returns only its rows', async function (assert) {
        await expectRows(
          assert,
          classRealm,
          {
            saved: { filter: { type: Bird }, page: everything },
            typed: { type: Bird, page: everything },
          },
          classNames((row) => isA(row, Bird)),
        );
      });

      test('not a subclass, within the base type, returns the base rows and the other subclass', async function (assert) {
        await expectRows(
          assert,
          classRealm,
          {
            saved: {
              filter: { every: [{ type: Animal }, { not: { type: Bird } }] },
              page: everything,
            },
            typed: {
              type: Animal,
              filter: { not: { type: Bird } },
              page: everything,
            },
          },
          classNames((row) => isA(row, Animal) && !isA(row, Bird)),
        );
      });

      test('not a subclass, with no other type, returns every other row of the realm', async function (assert) {
        await expectRows(
          assert,
          classRealm,
          {
            // With no top-level type there is nothing the newer spelling
            // says differently, so this one has the saved form only.
            saved: { filter: { not: { type: Bird } }, page: everything },
          },
          classNames((row) => !isA(row, Bird)),
        );
      });

      test('a filter on a field one subclass declares, anchored on it, returns only that subclass', async function (assert) {
        // A fish has `depth: 'trill'` but no `song`.
        await expectRows(
          assert,
          classRealm,
          ask(Bird, { filter: { eq: { song: 'trill' } } }),
          classNames((row) => isA(row, Bird) && row.doc.song === 'trill'),
        );
      });

      test('any of two filters, each anchored on its own subclass, returns the matches of both', async function (assert) {
        let any = [
          { on: Bird, eq: { song: 'trill' } },
          { on: Fish, eq: { depth: 'trill' } },
        ];
        await expectRows(
          assert,
          classRealm,
          {
            saved: { filter: { any }, page: everything },
            typed: { type: Animal, filter: { any }, page: everything },
          },
          classNames(
            (row) =>
              (isA(row, Bird) && row.doc.song === 'trill') ||
              (isA(row, Fish) && row.doc.depth === 'trill'),
          ),
        );
      });

      test('eq on a field that is a number in one subclass and a string in the other matches under each anchor only its own rows', async function (assert) {
        await expectRows(
          assert,
          classRealm,
          ask(Bird, { filter: { eq: { code: 10 } } }),
          ['bird2'],
          { label: 'the number' },
        );
        await expectRows(
          assert,
          classRealm,
          ask(Fish, { filter: { eq: { code: '10' } } }),
          ['fish2'],
          { label: 'the string' },
        );
      });

      test('range on a field that is a number in one subclass compares as numbers under that anchor', async function (assert) {
        await expectRows(
          assert,
          classRealm,
          ask(Bird, { filter: { range: { code: { gte: 10 } } } }),
          classNames((row) => isA(row, Bird) && (row.doc.code ?? -1) >= 10),
        );
      });

      test('range on the same field compares as text under the anchor where it is a string', async function (assert) {
        // "9" and "abc" are both after "10" as text: "1" orders before "9"
        // and before any letter in every collation.
        await expectRows(
          assert,
          classRealm,
          ask(Fish, { filter: { range: { code: { gt: '10' } } } }),
          ['fish1', 'fish3'],
        );
      });

      for (let direction of ['asc', 'desc'] as const) {
        test(`sort ${direction} on a field that is a number in one subclass is numeric under that anchor`, async function (assert) {
          let birds = CLASS_ROWS.filter((row) => isA(row, Bird));
          await expectRows(
            assert,
            classRealm,
            ask(Bird, { sort: [{ by: 'code', direction }] }),
            ordered(
              birds,
              (row) => row.doc.code,
              (a, b) => a - b,
              direction,
            ),
            { inOrder: true },
          );
        });

        test(`sort ${direction} on the same field is by text under the anchor where it is a string`, async function (assert) {
          // "10" < "9" < "abc" as text in every collation.
          let fishes = CLASS_ROWS.filter((row) => isA(row, Fish));
          await expectRows(
            assert,
            classRealm,
            ask(Fish, { sort: [{ by: 'code', direction }] }),
            ordered(
              fishes,
              (row) => row.doc.code as string | null,
              (a, b) => (a < b ? -1 : a > b ? 1 : 0),
              direction,
            ),
            { inOrder: true },
          );
        });

        test(`sort ${direction} anchored on one subclass, over the base type, puts the rows without the field last`, async function (assert) {
          // Only birds have a `song`. Every other row has no value for it,
          // and a field sort puts rows with no value last, by URL.
          let sort = [{ on: Bird, by: 'song', direction }];
          await expectRows(
            assert,
            classRealm,
            {
              saved: { filter: { type: Animal }, sort, page: everything },
              typed: { type: Animal, sort, page: everything },
            },
            ordered(
              CLASS_ROWS,
              (row) => row.doc.song as string | null | undefined,
              (a, b) => (a < b ? -1 : a > b ? 1 : 0),
              direction,
            ),
            { inOrder: true },
          );
        });
      }

      test('a numeric sort anchored on one subclass, over rows where the other subclass holds text there, still answers', async function (assert) {
        // The fish rows hold "9", "10" and "abc" at `code`. Whatever place
        // they take, the search must answer with every row, the birds in
        // numeric order among themselves.
        let sort = [{ on: Bird, by: 'code' }];
        for (let [form, build] of forms({
          saved: { filter: { type: Animal }, sort, page: everything },
          typed: { type: Animal, sort, page: everything },
        })) {
          try {
            let { names } = await search(classRealm, build());
            assert.deepEqual(
              [...names].sort(),
              classNames(() => true),
              `${form}: every row once`,
            );
            assert.deepEqual(
              names.filter((n) => ['bird1', 'bird2', 'bird3'].includes(n)),
              ['bird1', 'bird2', 'bird3'],
              `${form}: birds by number`,
            );
          } catch (e: any) {
            assert.ok(false, `${form}: failed: ${e.message}`);
          }
        }
      });

      test('a facet on a field only one subclass has, over the base type, counts that subclass', async function (assert) {
        await expectFacet(
          assert,
          classRealm,
          {
            saved: {
              filter: { type: Animal },
              facets: [{ by: 'song' }],
              page: everything,
            },
            typed: { type: Animal, facets: [{ by: 'song' }], page: everything },
          },
          'song',
          countsOf(CLASS_ROWS.map((row) => row.doc.song)),
        );
      });

      test('a facet on a field two subclasses hold in different types counts each stored value', async function (assert) {
        // A facet counts each value as text, so the number 10 and the
        // string "10" both count under "10". Counted by value (`stats`): the
        // holders declare it as a number and as text, and alone a number
        // facet is range buckets.
        await expectFacet(
          assert,
          classRealm,
          {
            saved: {
              filter: { type: Animal },
              facets: [{ by: 'code', stats: true }],
              page: everything,
            },
            typed: {
              type: Animal,
              facets: [{ by: 'code', stats: true }],
              page: everything,
            },
          },
          'code',
          countsOf(
            CLASS_ROWS.map((row) =>
              row.doc.code == null ? null : String(row.doc.code),
            ),
          ),
        );
      });
    });

    // ---------------------------------------------------------------------
    module('paths through links', function () {
      const orders = (parts: Parts) => ask(Order, parts);

      test('eq on a one-hop path matches the cards whose link holds that value', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { eq: { 'brand.name': 'Acme' } } }),
          orderNames((doc) => doc.brand?.name === 'Acme'),
        );
      });

      test('in on a one-hop path matches any listed value', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { in: { 'brand.name': ['Bolt', 'Crux'] } } }),
          orderNames((doc) => ['Bolt', 'Crux'].includes(doc.brand?.name)),
        );
      });

      test('range on a one-hop number path compares numbers', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { range: { 'brand.founded': { gte: 1990 } } } }),
          orderNames((doc) => doc.brand != null && doc.brand.founded >= 1990),
        );
      });

      test('not eq on a one-hop path leaves out the card whose link is unset', async function (assert) {
        // A single link's field is a scalar: no value is neither equal nor
        // unequal.
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { not: { eq: { 'brand.name': 'Acme' } } } }),
          orderNames((doc) => doc.brand != null && doc.brand.name !== 'Acme'),
        );
      });

      test('eq null on a one-hop path matches the card whose link is unset', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { eq: { 'brand.name': null } } }),
          orderNames((doc) => doc.brand == null),
        );
      });

      test('eq on a two-hop path matches through both links', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { eq: { 'brand.country.name': 'Norway' } } }),
          orderNames((doc) => doc.brand?.country?.name === 'Norway'),
        );
      });

      test('eq null on a two-hop path matches an unset link at either hop', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { eq: { 'brand.country.name': null } } }),
          orderNames((doc) => doc.brand?.country?.name == null),
        );
      });

      test('eq on a path through a list of links matches when some linked card holds the value', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { eq: { 'items.name': 'axle' } } }),
          orderNames((doc) => itemsOf(doc).some((i) => i.name === 'axle')),
        );
      });

      test('in on a path through a list of links matches when some linked card holds a listed value', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { in: { 'items.name': ['axle', 'rim'] } } }),
          orderNames((doc) =>
            itemsOf(doc).some((i) => ['axle', 'rim'].includes(i.name)),
          ),
        );
      });

      test('range on a number path through a list of links holds when one linked card is inside both bounds', async function (assert) {
        // o1 holds weights 5 and 12 and o3 holds 12 and 20: only a 12 is
        // inside (5, 20).
        await expectRows(
          assert,
          linkRealm,
          orders({
            filter: { range: { 'items.weight': { gt: 5, lt: 20 } } },
          }),
          orderNames((doc) =>
            itemsOf(doc).some((i) => i.weight > 5 && i.weight < 20),
          ),
        );
      });

      test('not eq on a path through a list of links returns the cards with no such linked card, empty lists among them', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { not: { eq: { 'items.name': 'gear' } } } }),
          orderNames((doc) => !itemsOf(doc).some((i) => i.name === 'gear')),
        );
      });

      test('eq on a two-hop path through a list of links matches through the link of a linked card', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { eq: { 'items.maker.name': 'Bolt' } } }),
          orderNames((doc) =>
            itemsOf(doc).some((i) => i.maker?.name === 'Bolt'),
          ),
        );
      });

      test('eq on the id of a link matches the cards linked to that card', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { eq: { 'brand.id': acme.id } } }),
          orderNames((doc) => doc.brand?.id === acme.id),
        );
      });

      test('in on the id of a link matches the cards linked to any listed card', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { in: { 'brand.id': [bolt.id, crux.id] } } }),
          orderNames((doc) => [bolt.id, crux.id].includes(doc.brand?.id)),
        );
      });

      test('not eq on the id of a link leaves out the card whose link is unset', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { not: { eq: { 'brand.id': acme.id } } } }),
          orderNames((doc) => doc.brand != null && doc.brand.id !== acme.id),
        );
      });

      test('eq on the id of a list of links matches when some link is to that card', async function (assert) {
        let rim = `${linkRealm}Part/rim`;
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { eq: { 'items.id': rim } } }),
          orderNames((doc) => itemsOf(doc).some((i) => i.id === rim)),
        );
      });

      test('eq on the id of a link that is not searchable is answered, since the id is always in the search doc', async function (assert) {
        await expectRows(
          assert,
          linkRealm,
          orders({ filter: { eq: { 'secret.id': acme.id } } }),
          orderNames((doc) => doc.secret?.id === acme.id),
        );
      });

      for (let direction of ['asc', 'desc'] as const) {
        test(`sort ${direction} on a one-hop path orders by the linked value, an unset link last`, async function (assert) {
          await expectRows(
            assert,
            linkRealm,
            orders({ sort: [{ by: 'brand.name', direction }] }),
            ordered(
              ORDER_ROWS,
              (row) => row.doc.brand?.name as string | undefined,
              (a, b) => (a < b ? -1 : a > b ? 1 : 0),
              direction,
            ),
            { inOrder: true },
          );
        });

        test(`sort ${direction} on a one-hop number path orders by number, an unset link last`, async function (assert) {
          await expectRows(
            assert,
            linkRealm,
            orders({ sort: [{ by: 'brand.founded', direction }] }),
            ordered(
              ORDER_ROWS,
              (row) => row.doc.brand?.founded as number | undefined,
              (a, b) => a - b,
              direction,
            ),
            { inOrder: true },
          );
        });

        test(`sort ${direction} on a two-hop path orders by the far value, an unset link at either hop last`, async function (assert) {
          await expectRows(
            assert,
            linkRealm,
            orders({ sort: [{ by: 'brand.country.name', direction }] }),
            ordered(
              ORDER_ROWS,
              (row) => row.doc.brand?.country?.name as string | undefined,
              (a, b) => (a < b ? -1 : a > b ? 1 : 0),
              direction,
            ),
            { inOrder: true },
          );
        });
      }

      test('a sort on a path through a list of links answers with every card once', async function (assert) {
        // A card with several linked cards has several values to sort by.
        // Which one orders it is not documented, so only the rows are checked.
        await expectRows(
          assert,
          linkRealm,
          orders({ sort: [{ by: 'items.name' }] }),
          orderNames(() => true),
        );
      });

      test('a facet on a one-hop path counts the linked values', async function (assert) {
        await expectFacet(
          assert,
          linkRealm,
          orders({ facets: [{ by: 'brand.name' }] }),
          'brand.name',
          countsOf(ORDER_ROWS.map((row) => row.doc.brand?.name)),
        );
      });

      test('a facet on a two-hop path is refused: a facet reaches through one link', async function (assert) {
        // docs/search.md (Declaring a facet): a linked card's own declared
        // fields are facets, one link away; a facet by the far card's field
        // names the nearer link instead.
        for (let [form, build] of forms(
          orders({ facets: [{ by: 'brand.country.name' }] }),
        )) {
          try {
            await search(linkRealm, build());
            assert.ok(false, `${form}: answered instead of refusing`);
          } catch (e: any) {
            assert.strictEqual(
              e.code,
              'needs-declaration',
              `${form}: ${e.message}`,
            );
            assert.ok(e.message.includes('one link'), e.message);
          }
        }
      });

      test('a facet on a link counts the cards linked to each card, by its id', async function (assert) {
        await expectFacet(
          assert,
          linkRealm,
          orders({ facets: [{ by: 'brand' }] }),
          'brand',
          countsOf(ORDER_ROWS.map((row) => row.doc.brand?.id)),
        );
      });

      test('a facet on a list of links counts each linked card once per card that links to it', async function (assert) {
        await expectFacet(
          assert,
          linkRealm,
          orders({ facets: [{ by: 'items' }] }),
          'items',
          countsOf(
            ORDER_ROWS.flatMap((row) => [
              ...new Set(itemsOf(row.doc).map((i) => i.id)),
            ]),
          ),
        );
      });

      test('a facet on a path through a list of links counts each value once per card that holds it', async function (assert) {
        // The docs: `by` is a field path, and a list field counts each of
        // its values.
        await expectFacet(
          assert,
          linkRealm,
          orders({ facets: [{ by: 'items.name' }] }),
          'items.name',
          countsOf(
            ORDER_ROWS.flatMap((row) => [
              ...new Set(itemsOf(row.doc).map((i) => i.name)),
            ]),
          ),
        );
      });

      test('a facet counts only the filtered cards when the filter is on a linked path', async function (assert) {
        let kept = ORDER_ROWS.filter((row) => row.doc.brand?.founded >= 1990);
        await expectFacet(
          assert,
          linkRealm,
          orders({
            filter: { range: { 'brand.founded': { gte: 1990 } } },
            facets: [{ by: 'brand.name' }],
          }),
          'brand.name',
          countsOf(kept.map((row) => row.doc.brand?.name)),
        );
      });

      test('a filter on a path that crosses a link that is not searchable is refused, naming the link', async function (assert) {
        for (let filter of [
          { eq: { 'secret.name': 'Acme' } },
          { in: { 'secret.name': ['Acme'] } },
          { range: { 'secret.founded': { gte: 1990 } } },
          { not: { eq: { 'secret.name': 'Acme' } } },
          { contains: { 'secret.name': 'Ac' } },
        ]) {
          for (let [form, build] of forms(orders({ filter }))) {
            let label = `${JSON.stringify(filter)}, ${form}`;
            try {
              await search(linkRealm, build());
              assert.ok(false, `${label}: answered instead of refusing`);
            } catch (e: any) {
              assert.strictEqual(
                e.name,
                'FilterRefersToNonsearchableFieldError',
                `${label}: ${e.message}`,
              );
              assert.strictEqual(e.relationshipPath, 'secret', label);
              assert.strictEqual(e.reason, 'not-searchable', label);
            }
          }
        }
      });

      test('a filter two hops deep is refused when only the first hop is searchable', async function (assert) {
        // `items` reaches each part and its maker, and no further.
        for (let [form, build] of forms(
          orders({ filter: { eq: { 'items.maker.country.name': 'Chile' } } }),
        )) {
          try {
            await search(linkRealm, build());
            assert.ok(false, `${form}: answered instead of refusing`);
          } catch (e: any) {
            assert.strictEqual(
              e.name,
              'FilterRefersToNonsearchableFieldError',
              `${form}: ${e.message}`,
            );
            assert.strictEqual(e.relationshipPath, 'items.maker.country', form);
          }
        }
      });

      test('a sort on a path that crosses a link that is not searchable is not refused: every card sorts as having no value', async function (assert) {
        // pins current behavior; rule not yet decided. A filter on the same
        // path is refused; a sort reads a value the search doc does not
        // hold, so the rows come back in URL order.
        await expectRows(
          assert,
          linkRealm,
          orders({ sort: [{ by: 'secret.name', direction: 'desc' }] }),
          ORDER_ROWS.map((row) => row.name).sort(),
          { inOrder: true },
        );
      });

      test('a facet on a path that crosses a link that is not searchable is not refused: it counts nothing', async function (assert) {
        // pins current behavior; rule not yet decided
        await expectFacet(
          assert,
          linkRealm,
          orders({ facets: [{ by: 'secret.name' }] }),
          'secret.name',
          {},
        );
      });
    });

    // ---------------------------------------------------------------------
    module('two conditions on one list', function () {
      const kits = (parts: Parts) => ask(Kit, parts);
      const redAndTen = {
        every: [{ eq: { 'items.color': 'red' } }, { eq: { 'items.size': 10 } }],
      };

      test('two filters on one list of compound values are each met by some element, not by the same one', async function (assert) {
        // The docs: each filter is its own test of the card. So the kit
        // with a red 5 and a blue 10 matches beside the kit with a red 10.
        await expectRows(
          assert,
          kitRealm,
          kits({ filter: redAndTen }),
          kitNames(
            (row) =>
              swatchesOf(row).some((s) => s.color === 'red') &&
              swatchesOf(row).some((s) => s.size === 10),
          ),
        );
      });

      test('one eq naming two paths of a list of compound values is still two tests', async function (assert) {
        // pins current behavior; rule not yet decided. The language has no
        // way to ask for one element that is both red and size 10.
        await expectRows(
          assert,
          kitRealm,
          kits({ filter: { eq: { 'items.color': 'red', 'items.size': 10 } } }),
          ['redFiveBlueTen', 'redTen'],
        );
      });

      test('not over two filters on one list returns the cards that fail either, empty and missing lists among them', async function (assert) {
        await expectRows(
          assert,
          kitRealm,
          kits({ filter: { not: redAndTen } }),
          kitNames(
            (row) =>
              !(
                swatchesOf(row).some((s) => s.color === 'red') &&
                swatchesOf(row).some((s) => s.size === 10)
              ),
          ),
        );
      });

      test('not eq on a path into a list of compound values returns the cards with no such element', async function (assert) {
        await expectRows(
          assert,
          kitRealm,
          kits({ filter: { not: { eq: { 'items.color': 'red' } } } }),
          kitNames((row) => !swatchesOf(row).some((s) => s.color === 'red')),
        );
      });

      test('a range with two bounds on a list of numbers is met by one element inside both', async function (assert) {
        // [5, 20] has an element above 8 and another below 15, and none
        // between: it does not match. [10] and [5, 12, 20] do.
        await expectRows(
          assert,
          kitRealm,
          kits({ filter: { range: { sizes: { gt: 8, lt: 15 } } } }),
          kitNames((row) => sizesOf(row).some((n) => n > 8 && n < 15)),
        );
      });

      test('a range with two bounds on a number inside a list of compound values is met by one element inside both', async function (assert) {
        // The kit with sizes 5 and 10 has no size inside (5, 10).
        await expectRows(
          assert,
          kitRealm,
          kits({ filter: { range: { 'items.size': { gt: 5, lt: 10 } } } }),
          kitNames((row) =>
            swatchesOf(row).some((s) => s.size > 5 && s.size < 10),
          ),
          { label: 'none inside' },
        );
        await expectRows(
          assert,
          kitRealm,
          kits({ filter: { range: { 'items.size': { gt: 3, lt: 10 } } } }),
          kitNames((row) =>
            swatchesOf(row).some((s) => s.size > 3 && s.size < 10),
          ),
          { label: 'the fives' },
        );
      });

      test('two ranges on one list, combined with every, are met by different elements', async function (assert) {
        // The same two bounds as separate filters: now [5, 20] matches too.
        await expectRows(
          assert,
          kitRealm,
          kits({
            filter: {
              every: [
                { range: { sizes: { gt: 8 } } },
                { range: { sizes: { lt: 15 } } },
              ],
            },
          }),
          kitNames(
            (row) =>
              sizesOf(row).some((n) => n > 8) &&
              sizesOf(row).some((n) => n < 15),
          ),
        );
      });

      test('not over a two-bound range on a list returns the cards with no element inside, empty and missing lists among them', async function (assert) {
        await expectRows(
          assert,
          kitRealm,
          kits({ filter: { not: { range: { sizes: { gt: 8, lt: 15 } } } } }),
          kitNames((row) => !sizesOf(row).some((n) => n > 8 && n < 15)),
        );
      });

      test('a facet on a path into a list of compound values counts each value once per card', async function (assert) {
        // The docs: a list field counts each of its values.
        await expectFacet(
          assert,
          kitRealm,
          kits({ facets: [{ by: 'items.color' }] }),
          'items.color',
          countsOf(
            KIT_ROWS.flatMap((row) => [
              ...new Set(swatchesOf(row).map((s) => s.color)),
            ]),
          ),
        );
      });

      test('a facet on a list of numbers counts each value once per card', async function (assert) {
        await expectFacet(
          assert,
          kitRealm,
          // counted by value: a number facet with `stats`
          kits({ facets: [{ by: 'sizes', stats: true }] }),
          'sizes',
          countsOf(
            KIT_ROWS.flatMap((row) => [...new Set(sizesOf(row))].map(String)),
          ),
        );
      });
    });

    // ---------------------------------------------------------------------
    module('files beside cards', function () {
      // `scope` is read off the wire and handed to the engine as the row
      // kind to search, as the realm does: 'cards' is instance rows, 'files'
      // file rows, 'all' both.
      async function searchScope(
        scope: 'cards' | 'files' | 'all' | undefined,
        q: Record<string, any>,
      ) {
        let parsed = parseSearchEntryQueryFromPayload(
          JSON.parse(
            JSON.stringify({
              ...searchEntryWireQueryFromQuery(q as Query),
              ...(scope ? { scope } : {}),
            }),
          ),
        );
        let kind = parsed.scope ?? 'all';
        let { results, meta } = await engine.search(
          new URL(mixedRealm),
          parsed.itemQuery as Query,
          {},
          { kind: 'dataOnly' },
          kind === 'cards' ? 'instance' : kind === 'files' ? 'file' : 'all',
        );
        return {
          names: results.map(
            (r) =>
              `${r.type}:${String(r.url)
                .slice(mixedRealm.length)
                .replace(/\.json$/, '')}`,
          ),
          meta,
        };
      }
      const page = everything;

      test('scope cards returns card rows only', async function (assert) {
        let { names } = await searchScope('cards', { page });
        assert.deepEqual(
          [...names].sort(),
          mixedNames((row) => !isFile(row)),
        );
      });

      test('scope files returns file rows only, the file row of a card among them', async function (assert) {
        let { names } = await searchScope('files', { page });
        assert.deepEqual([...names].sort(), mixedNames(isFile));
      });

      test('scope all returns both rows of a card: its instance and its file', async function (assert) {
        let { names, meta } = await searchScope('all', { page });
        assert.deepEqual(
          [...names].sort(),
          mixedNames(() => true),
        );
        assert.strictEqual(meta.page.total, MIXED_ROWS.length);
      });

      test('a search that names no scope searches both kinds', async function (assert) {
        let { names } = await searchScope(undefined, { page });
        assert.deepEqual(
          [...names].sort(),
          mixedNames(() => true),
        );
      });

      test('a scope the wire does not know is refused', async function (assert) {
        assert.throws(
          () => parseSearchEntryQueryFromPayload({ scope: 'both' }),
          (e: any) => /scope must be one of/.test(e.message),
        );
      });

      test('in a mixed search, eq _isCardInstanceFile false returns each card once and every plain file', async function (assert) {
        let { names } = await searchScope('all', {
          filter: { eq: { _isCardInstanceFile: false } },
          page,
        });
        assert.deepEqual(
          [...names].sort(),
          mixedNames((row) => !row.doc._isCardInstanceFile),
        );
        assert.strictEqual(
          new Set(names.map((n) => n.replace(/^(instance|file):/, ''))).size,
          names.length,
          'no card or file twice',
        );
      });

      test('in a mixed search, eq _isCardInstanceFile true returns only the file rows of cards', async function (assert) {
        let { names } = await searchScope('all', {
          filter: { eq: { _isCardInstanceFile: true } },
          page,
        });
        assert.deepEqual(
          [...names].sort(),
          mixedNames((row) => row.doc._isCardInstanceFile === true),
        );
      });

      test('in a mixed search, contains on _title matches cards and files, ignoring case', async function (assert) {
        let { names } = await searchScope('all', {
          filter: { contains: { _title: 'PLAN' } },
          page,
        });
        assert.deepEqual(
          [...names].sort(),
          mixedNames((row) => row.doc._title.toLowerCase().includes('plan')),
        );
      });

      test('contains on _title under scope cards keeps only the cards it matches', async function (assert) {
        let { names } = await searchScope('cards', {
          filter: { contains: { _title: 'a' } },
          page,
        });
        assert.deepEqual(
          [...names].sort(),
          mixedNames(
            (row) => !isFile(row) && row.doc._title.toLowerCase().includes('a'),
          ),
        );
      });

      test('in a mixed search, a type filter on BaseDef matches every row of both kinds', async function (assert) {
        let { names } = await searchScope('all', {
          filter: { type: refs.BaseDef },
          page,
        });
        assert.deepEqual(
          [...names].sort(),
          mixedNames(() => true),
        );
      });

      test('in a mixed search, a BaseDef type filter combines with another condition under every', async function (assert) {
        let { names } = await searchScope('all', {
          filter: {
            every: [
              { type: refs.BaseDef },
              { eq: { _isCardInstanceFile: false } },
              { contains: { _title: 'a' } },
            ],
          },
          page,
        });
        assert.deepEqual(
          [...names].sort(),
          mixedNames(
            (row) =>
              !row.doc._isCardInstanceFile &&
              row.doc._title.toLowerCase().includes('a'),
          ),
        );
      });

      test('in a mixed search, a filter on a card field narrows the result to cards', async function (assert) {
        let { names } = await searchScope('all', {
          filter: { on: Note, eq: { body: 'draft' } },
          page,
        });
        assert.deepEqual(names, ['instance:alpha']);
      });

      test('in a mixed search, a card type filter returns the cards and not their file rows', async function (assert) {
        let { names } = await searchScope('all', {
          filter: { type: Note },
          page,
        });
        assert.deepEqual(
          [...names].sort(),
          mixedNames((row) => !isFile(row)),
        );
      });

      test('in a mixed search, a FileDef type filter returns every file row and no card', async function (assert) {
        let { names } = await searchScope('all', {
          filter: { type: refs.FileDef },
          page,
        });
        assert.deepEqual([...names].sort(), mixedNames(isFile));
      });

      test('in a mixed search, a file subtype filter returns only the files of that type', async function (assert) {
        let { names } = await searchScope('all', {
          filter: { type: MarkdownDef },
          page,
        });
        assert.deepEqual(
          [...names].sort(),
          mixedNames((row) => row.chain.includes(MarkdownDef)),
        );
      });

      test('a card type filter under scope files returns nothing, and is not refused', async function (assert) {
        let { names } = await searchScope('files', {
          filter: { type: Note },
          page,
        });
        assert.deepEqual(names, []);
      });

      test('in a mixed search, not eq _cardType null is the cards only', async function (assert) {
        let { names } = await searchScope('all', {
          filter: { not: { eq: { _cardType: null } } },
          page,
        });
        assert.deepEqual(
          [...names].sort(),
          mixedNames((row) => !isFile(row)),
        );
      });

      for (let direction of ['asc', 'desc'] as const) {
        test(`in a mixed search, sort ${direction} on _title orders cards and files together by title`, async function (assert) {
          // The sort names a type only so the engine can resolve the key.
          // Rows deduplicated so each title appears once; the fixture's
          // titles differ in their first letter, whatever its case, so the
          // order is the same in any collation that ignores case first, and
          // the expectation asks the database for the order of those
          // letters rather than assuming one.
          let rows = MIXED_ROWS.filter((row) => !row.doc._isCardInstanceFile);
          let titles = rows.map((row) => row.doc._title as string);
          let ranked = (await db.execute(
            `SELECT t FROM unnest(ARRAY[${titles
              .map((t) => `'${t}'`)
              .join(',')}]::text[]) AS t ORDER BY t`,
          )) as { t: string }[];
          let rank = new Map(ranked.map((r, i) => [r.t, i]));
          let { names } = await searchScope('all', {
            filter: { eq: { _isCardInstanceFile: false } },
            sort: [{ on: refs.BaseDef, by: '_title', direction }],
            page,
          });
          assert.deepEqual(
            names,
            ordered(
              rows,
              (row) => row.doc._title as string,
              (a, b) => rank.get(a)! - rank.get(b)!,
              direction,
            ),
          );
        });

        test(`in a mixed search, sort ${direction} on _cardType puts every file after the cards`, async function (assert) {
          // The docs: a file row never carries `_cardType`, so it sinks to
          // the tail whichever way the sort runs.
          let { names } = await searchScope('all', {
            sort: [{ on: refs.BaseDef, by: '_cardType', direction }],
            page,
          });
          let firstFile = names.findIndex((n) => n.startsWith('file:'));
          assert.strictEqual(names.length, MIXED_ROWS.length, 'every row');
          assert.deepEqual(
            names.slice(0, firstFile).sort(),
            mixedNames((row) => !isFile(row)),
            'the cards lead',
          );
          assert.true(
            names.slice(firstFile).every((n) => n.startsWith('file:')),
            'the files follow',
          );
        });
      }

      test('in a mixed search, a sort on _title that names no type is refused', async function (assert) {
        // pins current behavior; rule not yet decided. The docs list
        // `_title` as a sort key both kinds carry, and say nothing of the
        // anchor the engine needs to resolve it.
        try {
          await searchScope('all', { sort: [{ by: '_title' }], page });
          assert.ok(false, 'answered instead of refusing');
        } catch (e: any) {
          assert.true(
            // a named page total makes the query the newer spelling, whose
            // lowering names the anchor to add
            /must name its type|must say which card type/.test(e.message),
            `refused: ${e.message}`,
          );
        }
      });

      test('a mixed search with no sort orders by URL, the file row of a card before its instance row', async function (assert) {
        // pins current behavior; rule not yet decided: the two rows of a
        // card share a URL and are told apart by kind, 'file' before
        // 'instance'.
        let { names } = await searchScope('all', { page });
        let expected = [...MIXED_ROWS]
          .sort((a, b) => {
            let ua = a.url!;
            let ub = b.url!;
            if (ua !== ub) return ua < ub ? -1 : 1;
            return (a.kind ?? 'instance') < (b.kind ?? 'instance') ? -1 : 1;
          })
          .map((row) => row.name);
        assert.deepEqual(names, expected);
      });
    });
  });
});
