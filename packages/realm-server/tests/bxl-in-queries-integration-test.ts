import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  InvalidQueryError,
  VirtualNetwork,
  assertQuery,
  internalKeyFor,
  param,
  query,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers/index.ts';

// BXL expressions as a search query uses them: an `expression` sort, a blend
// signal and a window (an expression sort entry with `top`, docs/search.md). This is not a test of BXL: it runs
// a representative subset of the language through the query engine and checks
// each row's value and the resulting order against the same expression
// written here as plain JavaScript over the fixture.
//
// Every expression runs as SQL (BXL's score profile), over every match or over
// a window. One the profile cannot express is refused with
// `expression-unsupported`, wherever it is written: there is no other place
// it runs. The `unsupported` cases below are that list.
//
// Numbers: fixture values are multiples of a quarter, so sums and products
// are exact. Quotients, logarithms and powers are compared with a relative
// tolerance of 1e-9 (`close`), since Postgres and JavaScript may differ in
// the last bit.
//
// Rows with no value (the expression ends blank or as an error) rank last,
// whichever direction the sort takes.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const realm = 'http://bxl-in-queries-test/';
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const cardDefRef = ref('@cardstack/base/card-api', 'CardDef');
const itemRef = ref(`${realm}item`, 'Item');

// --- the fixture -------------------------------------------------------------

interface Item {
  id: string;
  tier: string;
  title: string;
  price?: number | null;
  rating?: number | null;
  stock?: number | null;
  delta?: number | null;
  brand?: string | null;
  sku?: string | null;
  // a number kept as text, or text that is not a number
  code?: string | null;
  note?: string | null;
  inStock?: boolean | null;
  // a date, and a date-time
  releasedOn?: string | null;
  updatedAt?: string | null;
  tags?: string[] | null;
  scores?: number[] | null;
  // a compound field, and a link as a search doc carries it
  dims?: { width?: number; height?: number } | null;
  maker?: { id: string; name: string; founded: number } | null;
}

const makers = {
  northwind: {
    id: `${realm}Maker/northwind`,
    name: 'Northwind',
    founded: 1990,
  },
  harbor: { id: `${realm}Maker/harbor`, name: 'Harbor', founded: 1975 },
  atelier: { id: `${realm}Maker/atelier`, name: 'Atelier Nine', founded: 2011 },
  tidewater: {
    id: `${realm}Maker/tidewater`,
    name: 'Tidewater Co',
    founded: 2003,
  },
  stonefield: {
    id: `${realm}Maker/stonefield`,
    name: 'Stonefield',
    founded: 1988,
  },
};

// Each numeric field holds distinct values, with a zero, negatives, decimals
// and gaps. Every `releasedOn` is on or before its `updatedAt`.
const ITEMS: Item[] = [
  {
    id: 'i01',
    tier: 'a',
    title: 'Brass Lamp',
    price: 19.25,
    rating: 4.5,
    stock: 12,
    delta: -3,
    brand: 'Lumen',
    sku: 'A-017',
    code: '12',
    note: '  warm   glow  ',
    inStock: true,
    releasedOn: '2026-01-15',
    updatedAt: '2026-03-01T02:30:00.000Z',
    tags: ['home', 'light'],
    scores: [3, 4.5, -1],
    dims: { width: 10, height: 25 },
    maker: makers.northwind,
  },
  {
    id: 'i02',
    tier: 'b',
    title: 'oak desk',
    price: 4.75,
    rating: 3.75,
    stock: 0,
    delta: 2.5,
    brand: 'lumen',
    sku: 'B-204',
    code: '7',
    note: 'solid',
    inStock: false,
    releasedOn: '2025-12-31',
    updatedAt: '2025-12-31T23:30:00.000Z',
    tags: [],
    scores: [],
    dims: { width: 120, height: 75 },
    maker: makers.harbor,
  },
  {
    id: 'i03',
    tier: 'c',
    title: 'Copper "Kettle"',
    price: 120,
    rating: 4.25,
    stock: 7,
    delta: -0.5,
    brand: 'NORTH',
    sku: 'C-003',
    code: '003',
    note: ' two  words ',
    inStock: true,
    releasedOn: '2024-02-29',
    updatedAt: '2024-03-01T00:30:00.000Z',
    tags: ['kitchen'],
    scores: [10],
    dims: { width: 22.5, height: 18 },
    maker: null,
  },
  {
    id: 'i04',
    tier: 'a',
    title: 'LINEN THROW',
    price: 0,
    rating: 2.5,
    stock: 40,
    delta: 0.5,
    brand: 'North',
    sku: 'D-110',
    code: '4.5',
    note: null,
    inStock: null,
    releasedOn: '2025-06-30',
    updatedAt: '2025-07-04T12:00:00.000Z',
    tags: ['home', 'soft', 'gift'],
    scores: [2.5, 2.5],
    dims: { width: 150 },
    maker: makers.northwind,
  },
  {
    id: 'i05',
    tier: 'b',
    title: 'Glass Vase',
    price: null,
    rating: 5,
    stock: 3,
    delta: 1.5,
    brand: null,
    sku: 'E-055',
    code: 'n/a',
    note: 'fragile',
    inStock: true,
    releasedOn: null,
    updatedAt: '2026-05-05T05:05:05.000Z',
    tags: ['gift'],
    scores: [0, -2, 7],
    dims: null,
    maker: makers.atelier,
  },
  {
    id: 'i06',
    tier: 'c',
    title: 'brass hook',
    price: 64.5,
    rating: null,
    stock: 25,
    delta: -2.5,
    brand: 'Lumen',
    sku: null,
    code: null,
    note: '',
    inStock: false,
    releasedOn: '2026-02-10',
    updatedAt: null,
    tags: ['home'],
    scores: [1, 2, 3, 4],
    dims: { width: 3, height: 3 },
    maker: makers.harbor,
  },
  {
    id: 'i07',
    tier: 'a',
    title: 'Wool Rug',
    price: 8.25,
    rating: 1.25,
    stock: -4,
    delta: 3.5,
    brand: 'Tidewater',
    sku: 'G-900',
    code: '250',
    note: 'hand  made',
    inStock: true,
    releasedOn: '2023-11-05',
    updatedAt: '2025-01-01T00:00:00.000Z',
    tags: ['home', 'soft'],
    scores: [-3.5],
    dims: { width: 200, height: 300 },
    maker: makers.tidewater,
  },
  {
    id: 'i08',
    tier: 'b',
    title: 'Desk Clock',
    price: 250.75,
    rating: 4.75,
    stock: 1,
    delta: -7,
    brand: 'tidewater',
    sku: 'H-071',
    code: '19',
    note: null,
    inStock: false,
    releasedOn: '2026-04-01',
    updatedAt: '2026-04-01T18:45:00.000Z',
    tags: ['office', 'gift'],
    scores: [5, 5, 5],
    dims: { width: 12, height: 12 },
    maker: null,
  },
  {
    id: 'i09',
    tier: 'c',
    title: 'steel tray',
    price: 33,
    rating: 0,
    stock: 18,
    delta: 0,
    brand: 'NORTH',
    sku: 'I-318',
    code: '0',
    note: ' x ',
    inStock: true,
    releasedOn: '2025-09-09',
    updatedAt: '2025-10-10T10:10:10.000Z',
    tags: ['kitchen', 'office'],
    scores: [8, 0.5],
    dims: { height: 2 },
    maker: makers.northwind,
  },
  {
    id: 'i10',
    tier: 'a',
    title: 'Paper Lantern',
    price: 15.5,
    rating: 3.25,
    stock: null,
    delta: 4,
    brand: 'Lumen',
    sku: 'J-642',
    code: '88',
    note: 'light',
    inStock: null,
    releasedOn: '2026-06-20',
    updatedAt: '2026-06-21T09:00:00.000Z',
    tags: ['light', 'gift', 'home'],
    scores: [6],
    dims: { width: 30, height: 30 },
    maker: makers.atelier,
  },
  {
    id: 'i11',
    tier: 'b',
    title: 'cork coaster',
    price: 0.5,
    rating: 2.75,
    stock: 60,
    delta: -1.5,
    brand: null,
    sku: 'K-005',
    code: '5',
    note: 'set of 4',
    inStock: true,
    releasedOn: '2024-12-25',
    updatedAt: '2025-12-25T06:00:00.000Z',
    tags: ['kitchen', 'gift'],
    scores: [1.5, 2.5, 3.5],
    dims: { width: 9.5, height: 0.5 },
    maker: makers.harbor,
  },
  {
    id: 'i12',
    tier: 'c',
    title: 'Marble Table',
    price: 999,
    rating: 3.5,
    stock: 2,
    delta: 6,
    brand: 'Stonefield',
    sku: 'L-999',
    code: '1e2',
    note: 'heavy',
    inStock: false,
    releasedOn: '2022-07-07',
    updatedAt: '2026-07-07T07:07:07.000Z',
    tags: [],
    scores: [100, -50],
    dims: { width: 180, height: 76 },
    maker: makers.stonefield,
  },
  // a card with almost nothing filled in: its fields are absent, not null
  { id: 'i13', tier: 'a', title: 'Mystery Box', stock: 9, delta: -4.5 },
  {
    id: 'i14',
    tier: 'b',
    title: 'Ceramic Bowl',
    price: 72.25,
    rating: 4,
    stock: null,
    delta: 7.5,
    brand: 'Atelier',
    sku: 'N-430',
    code: '31',
    note: 'glazed',
    inStock: true,
    releasedOn: '2025-03-15',
    updatedAt: '2025-03-15T00:00:00.000Z',
    tags: ['kitchen'],
    scores: [4, 4.25],
    dims: { width: 16, height: 7 },
    maker: makers.atelier,
  },
  {
    id: 'i15',
    tier: 'c',
    title: 'pine peg',
    price: 2.25,
    rating: 0.5,
    stock: 100,
    delta: -6,
    brand: 'lumen',
    sku: 'O-012',
    code: '64',
    note: 'small',
    inStock: true,
    releasedOn: '2026-08-01',
    updatedAt: '2026-08-31T23:59:59.000Z',
    tags: ['home', 'office'],
    scores: [0.25],
    dims: { width: 1.5, height: 6 },
    maker: makers.northwind,
  },
  {
    id: 'i16',
    tier: 'a',
    title: 'Rattan Chair',
    price: 45,
    rating: 2.25,
    stock: 5,
    delta: null,
    brand: 'Tidewater',
    sku: 'P-777',
    code: '15',
    note: 'woven',
    inStock: false,
    releasedOn: '2025-05-05',
    updatedAt: '2025-05-06T12:00:00.000Z',
    tags: ['home'],
    scores: [9, 1],
    dims: { width: 60, height: 90 },
    maker: makers.tidewater,
  },
  {
    id: 'i17',
    tier: 'b',
    title: 'Iron Lamp',
    price: 310.5,
    rating: 1.75,
    stock: 33,
    delta: 8,
    brand: 'Stonefield',
    sku: 'Q-101',
    code: '2',
    note: '  dim',
    inStock: true,
    releasedOn: '2024-01-01',
    updatedAt: '2024-01-01T00:00:01.000Z',
    tags: ['light'],
    scores: [2, 2, 9.5],
    dims: { width: 14, height: 48 },
    maker: makers.stonefield,
  },
  {
    id: 'i18',
    tier: 'c',
    title: 'felt pad',
    price: 27.75,
    rating: 3,
    stock: 14,
    delta: -9,
    brand: 'North',
    sku: 'R-256',
    code: '-8',
    note: 'pad (grey)',
    inStock: false,
    releasedOn: '2026-09-30',
    updatedAt: '2026-10-01T03:00:00.000Z',
    tags: ['office'],
    scores: [-1, -2],
    dims: { width: 5, height: 5.5 },
    maker: makers.harbor,
  },
  {
    id: 'i19',
    tier: 'a',
    title: 'Bamboo Blind',
    price: 5,
    rating: 1.5,
    stock: 21,
    delta: 9.5,
    brand: 'Harbor',
    sku: 'S-640',
    code: '41',
    note: 'roll up',
    inStock: null,
    releasedOn: '2025-02-14',
    updatedAt: '2025-02-20T20:20:20.000Z',
    tags: ['home', 'light'],
    scores: [7.5, 7.5, 1],
    dims: { width: 90, height: 160 },
    maker: makers.harbor,
  },
  {
    id: 'i20',
    tier: 'b',
    title: 'velvet cushion',
    price: 88.5,
    rating: 0.75,
    stock: 6,
    delta: -10,
    brand: 'Atelier',
    sku: 'T-808',
    code: '9.5',
    note: 'plush  soft',
    inStock: true,
    releasedOn: '2026-10-10',
    updatedAt: '2026-11-01T01:01:01.000Z',
    tags: ['soft', 'gift'],
    scores: [3, 3.5, 4, 4.5, 5],
    dims: { width: 45, height: 45 },
    maker: makers.atelier,
  },
];

const urlOf = (item: Item) => `${realm}Item/${item.id}`;

const SCALARS: Record<string, 'string' | 'number'> = {
  tier: 'string',
  title: 'string',
  price: 'number',
  rating: 'number',
  stock: 'number',
  delta: 'number',
  brand: 'string',
  sku: 'string',
  code: 'string',
  note: 'string',
};

const itemDefinition = {
  type: 'card-def',
  codeRef: itemRef,
  displayName: 'Item',
  fields: Object.fromEntries(
    [...Object.keys(SCALARS), 'tags', 'scores'].map((n, i) => [n, `f${i}`]),
  ),
  fieldDefs: Object.fromEntries(
    [...Object.keys(SCALARS), 'tags', 'scores'].map((n, i) => {
      let numeric = SCALARS[n] === 'number' || n === 'scores';
      return [
        `f${i}`,
        {
          type: n === 'tags' || n === 'scores' ? 'containsMany' : 'contains',
          isPrimitive: true,
          isComputed: false,
          fieldOrCard: numeric ? numberRef : stringRef,
          ...(numeric ? { serializerName: 'number' } : {}),
        },
      ];
    }),
  ),
} as Definition;

function refsEqual(a: CodeRef, b: CodeRef): boolean {
  return (
    'module' in a && 'module' in b && a.module === b.module && a.name === b.name
  );
}

function makeDefinitionLookup(): DefinitionLookup {
  let definitions = [
    itemDefinition,
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

async function seed(dbAdapter: PgAdapter, vn: VirtualNetwork, item: Item) {
  let typeKey = internalKeyFor(itemRef, undefined, vn);
  let { id: _id, ...doc } = item;
  let url = urlOf(item);
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

// --- the plain evaluation ----------------------------------------------------
//
// Each expression is written a second time below as JavaScript over a fixture
// row, with the rules the docs give for a spreadsheet expression: a blank (a
// missing field) is 0 in arithmetic and in a comparison and '' as text, an
// error propagates until IFERROR catches it, and an expression that ends
// blank or as an error has no value.

class ExcelError extends Error {}
function fail(): never {
  throw new ExcelError('an Excel error');
}
const isBlank = (v: unknown): v is null | undefined =>
  v === null || v === undefined;
// A value as a number: a blank is 0, a boolean 1 or 0, text that spells a
// number that number, any other text an error.
function num(v: unknown): number {
  if (isBlank(v)) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return fail();
}
const text = (v: unknown): string => (isBlank(v) ? '' : String(v));
const div = (a: number, b: number) => (b === 0 ? fail() : a / b);
const ln = (x: number) => (x > 0 ? Math.log(x) : fail());
const sqrt = (x: number) => (x >= 0 ? Math.sqrt(x) : fail());
// Half away from zero, as Excel rounds.
function roundAway(x: number, digits = 0): number {
  let abs = Math.abs(x);
  let rounded =
    digits >= 0
      ? Math.round(abs * 10 ** digits) / 10 ** digits
      : Math.round(abs / 10 ** -digits) * 10 ** -digits;
  return Math.sign(x) * rounded;
}
// Text compares without regard to case, as in Excel.
const sameText = (a: unknown, b: string) =>
  text(a).toLowerCase() === b.toLowerCase();
// 1-based position, or an error when absent.
const position = (index: number) => (index < 0 ? fail() : index + 1);
const DAY_MS = 86_400_000;
const instant = (v: string) => Date.parse(v);
// Whole and fractional days from `start` to `end`; blank when either is.
const days = (end: unknown, start: unknown): number | null =>
  isBlank(end) || isBlank(start)
    ? null
    : (instant(end as string) - instant(start as string)) / DAY_MS;
const numbers = (list: unknown): number[] =>
  Array.isArray(list) ? list.filter((x) => typeof x === 'number') : [];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
// MIN and MAX skip blanks and are 0 with nothing to read; AVERAGE of nothing
// is an error.
const least = (xs: (number | null | undefined)[]) => {
  let present = xs.filter((x): x is number => !isBlank(x));
  return present.length ? Math.min(...present) : 0;
};
const greatest = (xs: (number | null | undefined)[]) => {
  let present = xs.filter((x): x is number => !isBlank(x));
  return present.length ? Math.max(...present) : 0;
};
const average = (xs: (number | null | undefined)[]) => {
  let present = xs.filter((x): x is number => !isBlank(x));
  return div(sum(present), present.length);
};
const firstChar = (s: string) => (s === '' ? fail() : s.charCodeAt(0));

type Placement = 'sql' | 'unsupported';
interface Case {
  // the BXL expression, as a query writes it
  expr: string;
  // where the engine is expected to place it
  where: Placement;
  // the same expression over a fixture row
  js: (r: Item) => unknown;
}
const sql = (expr: string, js: Case['js']): Case => ({
  expr,
  where: 'sql',
  js,
});
// refused with `expression-unsupported`; `js` is what it would compute
const unsupported = (expr: string, js: Case['js']): Case => ({
  expr,
  where: 'unsupported',
  js,
});

const CASES: Record<string, Case[]> = {
  'arithmetic and precedence': [
    sql('price + rating', (r) => num(r.price) + num(r.rating)),
    sql('price - stock', (r) => num(r.price) - num(r.stock)),
    sql('price * rating', (r) => num(r.price) * num(r.rating)),
    sql('price / stock', (r) => div(num(r.price), num(r.stock))),
    // a quotient of whole numbers keeps its fraction
    sql('stock / 4', (r) => num(r.stock) / 4),
    sql('2 + 3 * stock', (r) => 2 + 3 * num(r.stock)),
    sql('(2 + 3) * stock', (r) => (2 + 3) * num(r.stock)),
    sql('10 - 4 - stock', (r) => 10 - 4 - num(r.stock)),
    sql('-delta', (r) => -num(r.delta)),
    sql('-(price - 100)', (r) => -(num(r.price) - 100)),
    sql('delta ^ 2', (r) => num(r.delta) ** 2),
    sql(
      'price + delta / 2 - rating * 3',
      (r) => num(r.price) + num(r.delta) / 2 - num(r.rating) * 3,
    ),
    // pins current behavior; rule not yet decided: a leading minus applies
    // after the power (Excel reads -x^2 as (-x)^2)
    sql('-delta ^ 2', (r) => -(num(r.delta) ** 2)),
    // pins current behavior; rule not yet decided: powers group from the
    // right, 2^(3^2) (Excel groups them from the left, 64)
    sql('2 ^ 3 ^ 2 + stock', (r) => 2 ** (3 ** 2) + num(r.stock)),
    // pins current behavior; rule not yet decided: `%` is a remainder with
    // the sign of the left side (Excel has no such operator; its MOD takes
    // the sign of the divisor, see MOD below)
    sql('delta % 3', (r) => num(r.delta) % 3),
  ],
  'comparison and logic': [
    sql('price > 20', (r) => num(r.price) > 20),
    // a blank is 0 in a comparison
    sql('price = 0', (r) => num(r.price) === 0),
    sql('rating <> 5', (r) => num(r.rating) !== 5),
    sql('stock <= 7', (r) => num(r.stock) <= 7),
    sql('stock >= 7', (r) => num(r.stock) >= 7),
    sql('delta < 0', (r) => num(r.delta) < 0),
    sql(
      'AND(price > 10, rating >= 3)',
      (r) => num(r.price) > 10 && num(r.rating) >= 3,
    ),
    sql(
      'OR(stock = 0, delta > 5)',
      (r) => num(r.stock) === 0 || num(r.delta) > 5,
    ),
    sql(
      'delta < 0 or stock > 20',
      (r) => num(r.delta) < 0 || num(r.stock) > 20,
    ),
    // NOT of a blank is true
    sql('NOT(inStock)', (r) => !r.inStock),
    // IF on a blank takes the else branch; a branch that is blank stays blank
    sql('IF(inStock, price, -1)', (r) => (r.inStock ? r.price : -1)),
    sql('IF(price > 50, 3, IF(price > 10, 2, 1))', (r) =>
      num(r.price) > 50 ? 3 : num(r.price) > 10 ? 2 : 1,
    ),
    unsupported('IFS(rating >= 4, 3, rating >= 2, 2, TRUE, 1)', (r) =>
      num(r.rating) >= 4 ? 3 : num(r.rating) >= 2 ? 2 : 1,
    ),
    unsupported('SWITCH(tier, "a", 3, "b", 2, 1)', (r) =>
      r.tier === 'a' ? 3 : r.tier === 'b' ? 2 : 1,
    ),
    // text compares without regard to case
    unsupported('IF(brand = "LUMEN", 1, 0)', (r) =>
      sameText(r.brand, 'lumen') ? 1 : 0,
    ),
    unsupported('IF(title < "d", 1, 0)', (r) =>
      r.title.toLowerCase() < 'd' ? 1 : 0,
    ),
    // a boolean field reads as 1 or 0, in arithmetic and in a comparison
    sql('inStock + 1', (r) => num(r.inStock) + 1),
    sql('inStock * price', (r) => num(r.inStock) * num(r.price)),
    sql('IF(inStock = TRUE, 2, 1)', (r) => (num(r.inStock) === 1 ? 2 : 1)),
    // text that spells a number is that number in arithmetic
    sql('code * 2', (r) => num(r.code) * 2),
    // in a comparison, text ranks above every number
    sql('IF(code > 5, 1, 0)', (r) => (isBlank(r.code) ? 0 : 1)),
  ],
  math: [
    sql('ABS(delta)', (r) => Math.abs(num(r.delta))),
    // halves round away from zero: -2.5 is -3, not the even -2
    sql('ROUND(delta)', (r) => roundAway(num(r.delta))),
    sql('ROUND(price, 1)', (r) => roundAway(num(r.price), 1)),
    sql('ROUND(price, -1)', (r) => roundAway(num(r.price), -1)),
    sql(
      'ROUNDUP(price, 1)',
      (r) => Math.ceil(Math.abs(num(r.price)) * 10) / 10,
    ),
    sql('ROUNDDOWN(delta)', (r) => Math.trunc(num(r.delta))),
    sql('FLOOR(delta)', (r) => Math.floor(num(r.delta))),
    sql('CEILING(delta)', (r) => Math.ceil(num(r.delta))),
    sql('FLOOR(price, 5)', (r) => Math.floor(num(r.price) / 5) * 5),
    sql('CEILING(price, 5)', (r) => Math.ceil(num(r.price) / 5) * 5),
    // Excel's MOD takes the sign of the divisor: MOD(-7, 3) is 2
    unsupported(
      'MOD(delta, 3)',
      (r) => num(r.delta) - 3 * Math.floor(num(r.delta) / 3),
    ),
    sql('POWER(rating, 2)', (r) => num(r.rating) ** 2),
    sql('SQRT(stock)', (r) => sqrt(num(r.stock))),
    sql('LN(price)', (r) => ln(num(r.price))),
    sql('LOG(price)', (r) => ln(num(r.price)) / Math.LN10),
    sql('LOG(stock, 2)', (r) => ln(num(r.stock)) / Math.LN2),
    sql('LOG10(price)', (r) => ln(num(r.price)) / Math.LN10),
    sql('EXP(rating)', (r) => Math.exp(num(r.rating))),
    sql('MIN(price, 50)', (r) => least([r.price, 50])),
    sql('MAX(delta, 0)', (r) => greatest([r.delta, 0])),
    sql('SIGN(delta)', (r) => Math.sign(num(r.delta))),
    unsupported('INT(delta)', (r) => Math.floor(num(r.delta))),
    unsupported('TRUNC(delta)', (r) => Math.trunc(num(r.delta))),
    sql('AVERAGE(price, rating, stock)', (r) =>
      average([r.price, r.rating, r.stock]),
    ),
    sql('PI() * rating', (r) => Math.PI * num(r.rating)),
    // the docs' own example
    sql('rating / LN(price + 1)', (r) =>
      div(num(r.rating), ln(num(r.price) + 1)),
    ),
  ],
  'blanks and errors': [
    sql('IFERROR(price / stock, -1)', (r) => {
      try {
        return div(num(r.price), num(r.stock));
      } catch {
        return -1;
      }
    }),
    // IFERROR catches errors only: a blank passes through and has no value
    sql('IFERROR(rating, -1)', (r) => r.rating),
    sql('IFERROR(SQRT(delta), -1)', (r) =>
      num(r.delta) >= 0 ? Math.sqrt(num(r.delta)) : -1,
    ),
    sql('ISBLANK(price)', (r) => isBlank(r.price)),
    sql('IF(ISBLANK(rating), -1, rating)', (r) =>
      isBlank(r.rating) ? -1 : r.rating,
    ),
    unsupported('ISNUMBER(price)', (r) => typeof r.price === 'number'),
    // a number kept as text is not a number
    unsupported('ISNUMBER(code)', () => false),
    unsupported('ISTEXT(brand)', (r) => typeof r.brand === 'string'),
    unsupported('N(inStock)', (r) => num(r.inStock)),
    unsupported('ISERROR(price / stock)', (r) => num(r.stock) === 0),
  ],
  text: [
    unsupported('LEN(title)', (r) => r.title.length),
    // TRIM drops the ends and keeps one space between words
    unsupported(
      'LEN(TRIM(note))',
      (r) => text(r.note).trim().replace(/ +/g, ' ').length,
    ),
    unsupported('IF(EXACT(LOWER(brand), brand), 1, 0)', (r) =>
      text(r.brand).toLowerCase() === text(r.brand) ? 1 : 0,
    ),
    unsupported('IF(EXACT(UPPER(title), title), 1, 0)', (r) =>
      r.title.toUpperCase() === r.title ? 1 : 0,
    ),
    unsupported('CODE(LEFT(title, 1))', (r) => firstChar(r.title.slice(0, 1))),
    unsupported('CODE(RIGHT(sku, 1))', (r) => firstChar(text(r.sku).slice(-1))),
    unsupported('IF(ISBLANK(sku), -1, VALUE(MID(sku, 3, 3)))', (r) =>
      isBlank(r.sku) ? -1 : num(r.sku.slice(2, 5)),
    ),
    // SEARCH ignores case and is an error when the text is absent
    unsupported('SEARCH("a", title)', (r) =>
      position(r.title.toLowerCase().indexOf('a')),
    ),
    // FIND respects case
    unsupported(
      'IFERROR(FIND("L", title), 0)',
      (r) => r.title.indexOf('L') + 1,
    ),
    unsupported(
      'LEN(CONCAT(title, brand))',
      (r) => (r.title + text(r.brand)).length,
    ),
    // a missing value joins as empty text
    unsupported(
      'LEN(title & "-" & brand)',
      (r) => `${r.title}-${text(r.brand)}`.length,
    ),
    unsupported('VALUE(code)', (r) => num(r.code)),
    // TEXT rounds halves away from zero, as ROUND does
    unsupported('VALUE(TEXT(rating, "0.0"))', (r) =>
      roundAway(num(r.rating), 1),
    ),
    unsupported(
      'IF(ISNUMBER(SEARCH("lamp", title)), 2, 1) * rating',
      (r) => (r.title.toLowerCase().includes('lamp') ? 2 : 1) * num(r.rating),
    ),
    // a text literal holding quotes
    unsupported('IF(title = "Copper \\"Kettle\\"", 1, 0)', (r) =>
      sameText(r.title, 'Copper "Kettle"') ? 1 : 0,
    ),
    unsupported('LEN("it\'s") + stock', (r) => 4 + num(r.stock)),
  ],
  dates: [
    // date parts are read in UTC, as the stored values are
    unsupported('IF(ISBLANK(releasedOn), 0, YEAR(releasedOn))', (r) =>
      isBlank(r.releasedOn) ? 0 : new Date(r.releasedOn).getUTCFullYear(),
    ),
    unsupported('IF(ISBLANK(releasedOn), 0, MONTH(releasedOn))', (r) =>
      isBlank(r.releasedOn) ? 0 : new Date(r.releasedOn).getUTCMonth() + 1,
    ),
    unsupported('IF(ISBLANK(releasedOn), 0, DAY(releasedOn))', (r) =>
      isBlank(r.releasedOn) ? 0 : new Date(r.releasedOn).getUTCDate(),
    ),
    unsupported('IF(ISBLANK(updatedAt), 0, DAY(updatedAt))', (r) =>
      isBlank(r.updatedAt) ? 0 : new Date(r.updatedAt).getUTCDate(),
    ),
    unsupported('IF(ISBLANK(updatedAt), -1, HOUR(updatedAt))', (r) =>
      isBlank(r.updatedAt) ? -1 : new Date(r.updatedAt).getUTCHours(),
    ),
    // DAYS keeps the fraction of a day, and is blank without both dates
    sql('DAYS(updatedAt, releasedOn)', (r) => days(r.updatedAt, r.releasedOn)),
    // the same age in hours; a blank is 0 in the product
    sql(
      'DAYS(updatedAt, releasedOn) * 24',
      (r) => num(days(r.updatedAt, r.releasedOn)) * 24,
    ),
    sql('MAX(DAYS(updatedAt, releasedOn), 7)', (r) =>
      greatest([days(r.updatedAt, r.releasedOn), 7]),
    ),
    // DATEDIF counts whole days
    unsupported(
      'IF(OR(ISBLANK(releasedOn), ISBLANK(updatedAt)), -1, DATEDIF(releasedOn, updatedAt, "D"))',
      (r) =>
        isBlank(r.releasedOn) || isBlank(r.updatedAt)
          ? -1
          : Math.floor(days(r.updatedAt, r.releasedOn)!),
    ),
    // date arithmetic on serial numbers is in days
    unsupported(
      'IF(ISBLANK(releasedOn), -1, DATEVALUE(releasedOn) - DATEVALUE("2026-01-01"))',
      (r) => (isBlank(r.releasedOn) ? -1 : days(r.releasedOn, '2026-01-01')),
    ),
    // a stored date is text, so subtracting two is an error (DAYS is the way)
    sql('updatedAt - releasedOn', (r) => num(r.updatedAt) - num(r.releasedOn)),
  ],
  "a card's own lists": [
    sql('COUNT(scores)', (r) => numbers(r.scores).length),
    sql('SUM(scores)', (r) => sum(numbers(r.scores))),
    sql('AVERAGE(scores)', (r) => average(numbers(r.scores))),
    sql('MIN(scores)', (r) => least(numbers(r.scores))),
    sql('MAX(scores)', (r) => greatest(numbers(r.scores))),
    sql('MAX(scores, 4)', (r) => greatest([...numbers(r.scores), 4])),
    sql(
      'COUNTIF(scores, ">3")',
      (r) => numbers(r.scores).filter((x) => x > 3).length,
    ),
    // a text criterion counts text equal ignoring case (decided 2026-11-10)
    sql(
      'COUNTIF(tags, "home")',
      (r) =>
        (r.tags ?? []).filter(
          (t) => typeof t === 'string' && t.toLowerCase() === 'home',
        ).length,
    ),
    unsupported('COUNTA(tags)', (r) => (r.tags ?? []).length),
    // membership
    unsupported('IF(ISNUMBER(MATCH("gift", tags, 0)), 1, 0)', (r) =>
      (r.tags ?? []).includes('gift') ? 1 : 0,
    ),
    sql('SUM(scores) / COUNT(scores)', (r) =>
      div(sum(numbers(r.scores)), numbers(r.scores).length),
    ),
  ],
  'field paths and literals': [
    sql(
      'dims.width * dims.height',
      (r) => num(r.dims?.width) * num(r.dims?.height),
    ),
    // through a link, as the search doc carries it
    sql('maker.founded', (r) => r.maker?.founded),
    sql('2026 - maker.founded', (r) => 2026 - num(r.maker?.founded)),
    unsupported('LEN(maker.name)', (r) => text(r.maker?.name).length),
    sql('.price * 2', (r) => num(r.price) * 2),
    sql('stock + 1.5', (r) => num(r.stock) + 1.5),
    sql('stock * 1e2', (r) => num(r.stock) * 100),
    sql('IF(TRUE, stock, 0)', (r) => r.stock),
    sql('IF(FALSE, 1, stock + 0.25)', (r) => num(r.stock) + 0.25),
  ],
};

const ALL_CASES = Object.values(CASES).flat();

// The value an expression gives a row: a number, or null when it ends blank,
// as an error, or as anything that is not a number. TRUE and FALSE are 1, 0.
function valueOf(c: Case, item: Item): number | null {
  let v: unknown;
  try {
    v = c.js(item);
  } catch (e) {
    if (e instanceof ExcelError) return null;
    throw e;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const within = (x: number, low: number, high: number) => x >= low && x <= high;

const close = (a: number | null, b: number | null) =>
  a === null || b === null
    ? a === b
    : a === b ||
      Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// Rows with a value in the direction asked for, ties in url order; then the
// rows without one, in url order.
function orderOf(
  values: Map<string, number | null>,
  direction: 'asc' | 'desc',
): string[] {
  let ids = [...values.keys()].sort();
  let valued = ids.filter((id) => values.get(id) !== null);
  let sign = direction === 'asc' ? 1 : -1;
  valued.sort(
    (a, b) =>
      (values.get(a)! - values.get(b)!) * sign || (a < b ? -1 : a > b ? 1 : 0),
  );
  return [...valued, ...ids.filter((id) => values.get(id) === null)];
}

interface Ranked {
  ids: string[];
  values: Map<string, number | null>;
  rows: Record<string, any>[];
  meta: Record<string, any>;
}

// The rows where two sets of values differ, for a message that names them.
function differences(
  actual: Map<string, number | null>,
  expected: Map<string, number | null>,
) {
  let out: { row: string; expected: number | null; actual: number | null }[] =
    [];
  for (let [id, want] of expected) {
    let got = actual.get(id) ?? null;
    if (!close(got, want)) out.push({ row: id, expected: want, actual: got });
  }
  return out;
}

module(basename(import.meta.filename), function () {
  module('BXL in queries (Postgres integration)', function (hooks) {
    let engine: IndexQueryEngine;
    let adapter: PgAdapter;
    // every SQL statement the engine sent, for the quoting tests
    let statements: string[] = [];

    setupDB(hooks, {
      before: async (dbAdapter) => {
        adapter = dbAdapter;
        let vn = new VirtualNetwork();
        let recording = new Proxy(dbAdapter, {
          get(target, key) {
            let value = (target as any)[key];
            if (key === 'execute') {
              return (statement: string, ...rest: unknown[]) => {
                statements.push(String(statement));
                return value.call(target, statement, ...rest);
              };
            }
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        engine = new IndexQueryEngine(recording, makeDefinitionLookup(), vn);
        for (let item of ITEMS) {
          await seed(dbAdapter, vn, item);
        }
      },
    });

    const everything = { size: 100 };
    const byUrl = { by: 'cardURL' };

    async function run(q: Record<string, any>, key = '_expression') {
      let { results, meta } = await engine.search(
        new URL(realm),
        {
          filter: { type: itemRef },
          page: everything,
          ...q,
        } as unknown as Query,
        {},
        { kind: 'dataOnly' },
      );
      let rows = results as Record<string, any>[];
      let idOf = (r: Record<string, any>) => String(r.url).split('/').pop()!;
      return {
        ids: rows.map(idOf),
        values: new Map(
          rows.map((r) => [idOf(r), r[key] == null ? null : Number(r[key])]),
        ),
        rows,
        meta: meta as Record<string, any>,
      } satisfies Ranked;
    }

    // A window over every row: the expression re-orders the first 500 rows
    // of the url order, so its values ride `_window`.
    const windowOf = (
      expression: unknown,
      extra: Record<string, any> = {},
    ) => ({
      sort: [{ expression, top: 500, ...extra }, byUrl],
    });

    async function refusal(attempt: () => unknown): Promise<unknown> {
      try {
        await attempt();
      } catch (e) {
        return e;
      }
      return undefined;
    }

    // --- 1 and 2: the subset, each expression against the plain evaluation --

    for (let [category, cases] of Object.entries(CASES)) {
      for (let c of cases.filter((c) => c.where === 'sql')) {
        test(`${category}: ${c.expr} gives each row the value a plain evaluation gives, and ranks by it`, async function (assert) {
          let expected = new Map(
            ITEMS.map((item) => [item.id, valueOf(c, item)]),
          );
          let desc = await run({ sort: [{ expression: c.expr }, byUrl] });
          assert.deepEqual(
            differences(desc.values, expected),
            [],
            'each row carries the value in meta._expression',
          );
          assert.deepEqual(
            desc.ids,
            orderOf(expected, 'desc'),
            'highest first, rows with no value last',
          );
          let asc = await run({
            sort: [{ expression: c.expr, direction: 'asc' }, byUrl],
          });
          assert.deepEqual(
            asc.ids,
            orderOf(expected, 'asc'),
            'asc: lowest first, rows with no value still last',
          );
          assert.deepEqual(
            differences(asc.values, expected),
            [],
            'the direction does not change a value',
          );
        });
      }
      // What the score profile cannot express is refused, as an expression
      // sort and as a window alike: nothing runs it anywhere else.
      for (let c of cases.filter((c) => c.where === 'unsupported')) {
        test(`${category}: ${c.expr} is refused with expression-unsupported`, async function (assert) {
          for (let [where, q] of [
            ['an expression sort', { sort: [{ expression: c.expr }, byUrl] }],
            ['a window', windowOf(c.expr)],
          ] as [string, Record<string, unknown>][]) {
            let error: any = await refusal(() => run(q));
            assert.strictEqual(
              error?.code,
              'expression-unsupported',
              `${where}: ${error?.message}`,
            );
          }
        });
      }
    }

    // --- 3: the same value over every match and over a window ----------------
    //
    // An `expression` sort computes over every match, and a window over its
    // first rows, each in its own statement: they must give a row the same
    // value and, with the window covering every row, the same order.

    for (let c of ALL_CASES.filter((c) => c.where === 'sql')) {
      test(`window: ${c.expr} gives the same values and order as the expression sort`, async function (assert) {
        let asSort = await run({ sort: [{ expression: c.expr }, byUrl] });
        let asWindow = await run(windowOf(c.expr), '_window');
        assert.strictEqual(
          asWindow.meta.window?.rows,
          ITEMS.length,
          'the window covers every row',
        );
        assert.deepEqual(
          differences(asWindow.values, asSort.values),
          [],
          'a window gives the values the sort gives',
        );
        assert.deepEqual(asWindow.ids, asSort.ids, 'and the same order');
      });
    }

    // --- 4: every place a query takes an expression --------------------------

    const product = ALL_CASES.find((c) => c.expr === 'price * rating')!;
    const productValues = new Map(
      ITEMS.map((item) => [item.id, valueOf(product, item)]),
    );

    test('an expression is the second sort key after a field', async function (assert) {
      let { ids } = await run({
        sort: [
          { by: 'tier', on: itemRef },
          { expression: 'price * rating' },
          byUrl,
        ],
      });
      let expected = [...ITEMS]
        .sort(
          (a, b) =>
            (a.tier < b.tier ? -1 : a.tier > b.tier ? 1 : 0) ||
            productValues.get(b.id)! - productValues.get(a.id)! ||
            (a.id < b.id ? -1 : 1),
        )
        .map((item) => item.id);
      assert.deepEqual(ids, expected, 'by tier, then highest product first');
    });

    test('an expression that cannot run as SQL is refused as a second sort key', async function (assert) {
      let error = await refusal(() =>
        run({
          sort: [{ by: 'tier', on: itemRef }, { expression: 'LEN(title)' }],
        }),
      );
      assert.ok(error instanceof InvalidQueryError, 'the query is refused');
      assert.strictEqual(
        (error as InvalidQueryError).code,
        'expression-unsupported',
      );
    });

    test('the older spelling of an expression sort ranks the same', async function (assert) {
      let newer = await run({
        sort: [{ expression: 'price * rating' }, byUrl],
      });
      let older = await run({
        sort: [{ by: '_expr', expr: 'price * rating' }, byUrl],
      });
      assert.deepEqual(older.ids, orderOf(productValues, 'desc'));
      assert.deepEqual(older.ids, newer.ids);
      assert.deepEqual(differences(older.values, productValues), []);
    });

    // Reciprocal rank fusion over the fixture: each signal ranks the rows it
    // has a value for (1 is best), and a row scores weight / (k + rank) from
    // each, with k = 60. `stock` and `delta` hold no repeated value, so no
    // rule for ties is involved.
    const K = 60;
    function ranksOf(field: 'stock' | 'delta', best: 'highest' | 'lowest') {
      let valued = ITEMS.filter((item) => !isBlank(item[field]));
      return new Map(
        valued.map((item) => [
          item.id,
          1 +
            valued.filter((other) =>
              best === 'highest'
                ? other[field]! > item[field]!
                : other[field]! < item[field]!,
            ).length,
        ]),
      );
    }

    test('an expression is a blend signal: its weight over k plus its rank', async function (assert) {
      let stockRank = ranksOf('stock', 'highest');
      let deltaRank = ranksOf('delta', 'highest');
      let expected = new Map<string, number | null>(
        ITEMS.map((item) => [
          item.id,
          (stockRank.has(item.id) ? 2 / (K + stockRank.get(item.id)!) : 0) +
            (deltaRank.has(item.id) ? 0.5 / (K + deltaRank.get(item.id)!) : 0),
        ]),
      );
      let { ids, values, rows, meta } = await run(
        {
          sort: [
            {
              blend: [
                { expression: 'stock', weight: 2 },
                { expression: 'delta', weight: 0.5 },
              ],
            },
            byUrl,
          ],
          explain: true,
        },
        '_blendScore',
      );
      assert.deepEqual(differences(values, expected), [], 'fused scores');
      assert.deepEqual(ids, orderOf(expected, 'desc'), 'ordered by them');
      assert.strictEqual(
        meta.expression,
        undefined,
        'a blend signal is not the query expression',
      );
      let explained = rows.find((r) =>
        String(r.url).endsWith('/i01'),
      )!._explain;
      assert.deepEqual(
        explained.signals.map((s: any) => [
          s.signal,
          s.weight,
          s.value,
          s.rank,
        ]),
        [
          ['stock', 2, 12, stockRank.get('i01')],
          ['delta', 0.5, -3, deltaRank.get('i01')],
        ],
        'explain names each expression by its text, with its value and rank',
      );
      assert.ok(
        close(
          explained.signals[0].contribution,
          2 / (K + stockRank.get('i01')!),
        ),
        'and its part of the score',
      );
      let unstocked = rows.find((r) =>
        String(r.url).endsWith('/i10'),
      )!._explain;
      assert.deepEqual(
        [unstocked.signals[0].value, unstocked.signals[0].rank],
        [null, null],
        'a row whose expression is blank has no rank in that signal',
      );
      assert.strictEqual(unstocked.signals[0].contribution, 0);
    });

    test('a negative weight ranks an expression signal the other way around', async function (assert) {
      let stockRank = ranksOf('stock', 'highest');
      let deltaRank = ranksOf('delta', 'lowest');
      let expected = new Map<string, number | null>(
        ITEMS.map((item) => [
          item.id,
          (stockRank.has(item.id) ? 1 / (K + stockRank.get(item.id)!) : 0) +
            (deltaRank.has(item.id) ? 3 / (K + deltaRank.get(item.id)!) : 0),
        ]),
      );
      let { ids, values, rows } = await run(
        {
          sort: [
            {
              blend: [
                { expression: 'stock' },
                { expression: 'delta', weight: -3 },
              ],
            },
            byUrl,
          ],
          explain: true,
        },
        '_blendScore',
      );
      assert.deepEqual(differences(values, expected), [], 'fused scores');
      assert.deepEqual(ids, orderOf(expected, 'desc'), 'ordered by them');
      // i20 has the lowest delta of all
      let lowest = rows.find((r) => String(r.url).endsWith('/i20'))!._explain;
      assert.strictEqual(
        lowest.signals[1].rank,
        1,
        'the lowest value ranks first',
      );
      assert.true(lowest.signals[1].inverted, 'and explain marks it inverted');
    });

    test('an expression that cannot run as SQL is refused as a blend signal', async function (assert) {
      let error = await refusal(() =>
        run({
          sort: [
            { blend: [{ expression: 'LEN(title)' }, { expression: 'stock' }] },
          ],
        }),
      );
      assert.ok(error instanceof InvalidQueryError, 'the query is refused');
      assert.strictEqual(
        (error as InvalidQueryError).code,
        'expression-unsupported',
      );
    });

    test('a window re-orders the rows an expression sort ranked, and both values ride along', async function (assert) {
      let { ids, rows } = await run({
        sort: [
          { expression: 'stock', top: 500 },
          { expression: 'price * rating' },
          byUrl,
        ],
      });
      let stocks = new Map<string, number | null>(
        ITEMS.map((item) => [
          item.id,
          isBlank(item.stock) ? null : item.stock!,
        ]),
      );
      // ties in the window keep the order the expression sort gave; a row
      // with no stock follows the ones with one
      let sorted = orderOf(productValues, 'desc');
      let rank = (id: string) => stocks.get(id) ?? null;
      let expected = [...sorted].sort(
        (a, b) =>
          (rank(a) === null ? 1 : 0) - (rank(b) === null ? 1 : 0) ||
          (rank(b) ?? 0) - (rank(a) ?? 0) ||
          sorted.indexOf(a) - sorted.indexOf(b),
      );
      assert.deepEqual(ids, expected);
      let first = rows[0];
      assert.strictEqual(Number(first._window), stocks.get(ids[0]));
      assert.ok(
        close(Number(first._expression), productValues.get(ids[0])!),
        'the sort value stays in meta._expression',
      );
    });

    // --- 5: what a query expression may not do -------------------------------

    test('a function BXL does not have is refused when the query is checked, naming it', async function (assert) {
      for (let expression of [
        'fetch("https://example.test/")',
        'readFile("notes.txt")',
        'price * NOPE(rating)',
      ]) {
        let name = /([A-Za-z]+)\(/.exec(expression)![1].toUpperCase();
        let error: unknown;
        try {
          assertQuery({ type: itemRef, sort: [{ expression }] });
        } catch (e) {
          error = e;
        }
        assert.ok(
          error instanceof InvalidQueryError,
          `${expression} is refused`,
        );
        assert.strictEqual(
          (error as InvalidQueryError).code,
          'unknown-function',
        );
        assert.ok(
          (error as Error).message.includes(name),
          `the message names ${name}`,
        );
        let ran = await refusal(() => run({ sort: [{ expression }] }));
        assert.strictEqual(
          (ran as InvalidQueryError)?.code,
          'unknown-function',
          'and the engine refuses to run it',
        );
      }
    });

    for (let placement of ['sql', 'top', 'gpu']) {
      test(`placement "${placement}" is refused with unknown-key: every expression runs in SQL`, async function (assert) {
        let error = await refusal(() =>
          run({ sort: [{ expression: 'price * rating', placement }, byUrl] }),
        );
        assert.strictEqual((error as InvalidQueryError)?.code, 'unknown-key');
        assert.true(
          /top/.test(String((error as Error)?.message)),
          'the message points to top',
        );
      });
    }

    test('a word before a parenthesis inside a text literal is not a function call', async function (assert) {
      // read as text, not a call of `pad`; SEARCH itself is outside the
      // score profile, so the expression is refused for SEARCH alone
      let error: any = await refusal(() =>
        run({
          sort: [
            { expression: 'IF(ISNUMBER(SEARCH("pad (grey)", note)), 1, 0)' },
            byUrl,
          ],
        }),
      );
      assert.strictEqual(error?.code, 'expression-unsupported');
      assert.false(
        /\bpad is not/i.test(String(error?.message)),
        `the message does not name pad as a function: ${error?.message}`,
      );
      assert.true(
        /ISNUMBER|SEARCH/.test(String(error?.message)),
        `it names a function the profile lacks: ${error?.message}`,
      );
    });

    // An expression in a query runs under BXL's query profile: spreadsheet
    // functions, arithmetic, comparisons, logic, field paths and the names
    // it binds itself. Anything else is refused with invalid-expression, in
    // a sort expression and in a window alike, and the message names it.
    const REFUSED: [string, string, RegExp][] = [
      ['a jq pipe', '[.scores[]] | length', /pipe/],
      ['a jq stream', '.scores[]', /stream/],
      ['text interpolation', '"\\(price)"', /interpolation/],
      [
        'a helper defined in the expression',
        'def twice: . * 2; stock | twice',
        /helper/,
      ],
      ['an update', '.price |= 3', /assignment operator \|=/],
      [
        'an update piped on',
        '(.price |= 3) | .price',
        /assignment operator \|=/,
      ],
      ['a request-context path', '@User.ID', /@User/],
      ['an environment read', 'env | keys | length', /env/],
      ['the environment variable', '$ENV | keys | length', /\$ENV/],
      ['a field of the environment variable', '$ENV.PATH | length', /\$ENV/],
      ['an environment call', 'env()', /ENV/],
      ['an input read', 'input()', /INPUT/],
      ['a module directive', 'import "x" as y; 1', /import/],
    ];
    for (let [label, expression, names] of REFUSED) {
      test(`the query profile refuses ${label} (${expression})`, async function (assert) {
        for (let [where, q] of [
          ['a sort expression', { sort: [{ expression }, byUrl] }],
          ['a window', windowOf(expression)],
        ] as [string, Record<string, unknown>][]) {
          let error: any = await refusal(() => run(q));
          assert.strictEqual(
            error?.code,
            'invalid-expression',
            `${where}: refused (${error?.message})`,
          );
          assert.true(
            names.test(String(error?.message)),
            `${where}: the message names the construct: ${error?.message}`,
          );
        }
      });
    }

    // A binding the expression makes itself (`LET`) is held to the query
    // profile, and the score profile does not compute it: refused.
    test('an expression that binds its own name (LET) is refused with expression-unsupported', async function (assert) {
      let error: any = await refusal(() =>
        run({ sort: [{ expression: 'LET(x, 2, x * stock)' }, byUrl] }),
      );
      assert.strictEqual(error?.code, 'expression-unsupported', error?.message);
    });

    test('a blend signal outside the query profile is refused with invalid-expression', async function (assert) {
      let error: any = await refusal(() =>
        run({
          sort: [
            {
              blend: [{ expression: 'price | . * 2' }, { by: 'rating' }],
            },
            byUrl,
          ],
        }),
      );
      assert.strictEqual(error?.code, 'invalid-expression', error?.message);
      assert.true(/pipe/.test(String(error?.message)), error?.message);
    });

    // Text crafted to break out of SQL quoting. In a text literal it is data:
    // its length is the answer. As or in a field name it is refused, or names
    // a field no card has. Either way it never becomes part of a statement.
    const MARK = 'DROP TABLE boxel_index';
    const HOSTILE_TEXT = [
      `'; ${MARK}; --`,
      `x' OR '1'='1'); ${MARK}; /*`,
      `$1 $2 ${MARK}`,
      `back\\\\slash ${MARK}`,
      `nul\\u0000byte ${MARK}`,
      `"}'::text[]); ${MARK}; --`.replace(/"/g, '\\"'),
    ];
    async function tableIsIntact(assert: Assert) {
      let rows = await query(adapter, [
        `SELECT COUNT(*) AS n FROM boxel_index WHERE realm_url =`,
        param(realm),
      ]);
      assert.strictEqual(
        Number(rows[0].n),
        ITEMS.length,
        'every row is still there',
      );
    }

    for (let literal of HOSTILE_TEXT) {
      test(`quoting: a text literal is data, never SQL: ${JSON.stringify(literal)}`, async function (assert) {
        statements = [];
        // text is outside the score profile: the expression is refused
        // before any statement is built, so the text never reaches one
        let expression = `LEN("${literal}") + stock`;
        for (let q of [
          { sort: [{ expression }, byUrl] },
          windowOf(expression),
        ]) {
          let error: any = await refusal(() => run(q));
          assert.ok(
            error instanceof InvalidQueryError,
            `refused with a code: ${error?.code}`,
          );
        }
        assert.deepEqual(
          statements.filter((s) => s.includes(MARK)),
          [],
          'no statement carries the text',
        );
        await tableIsIntact(assert);
      });
    }

    const HOSTILE_NAMES = [
      `price'); ${MARK}; --`,
      `price; ${MARK}`,
      `price -- '; ${MARK}`,
      `price /* */ + 1; ${MARK}`,
      `price + $1`,
      `price\u0000 + 1`,
      `."price'); ${MARK}; --" + 1`,
      `.["price}'::text[]); ${MARK}; --"] + 1`,
      `dims."width'); ${MARK}; --" + 1`,
      `1e400 + price`,
    ];
    for (let expression of HOSTILE_NAMES) {
      test(`quoting: a crafted field name is refused or reads nothing, never SQL: ${JSON.stringify(expression)}`, async function (assert) {
        statements = [];
        for (let q of [
          { sort: [{ expression }, byUrl] },
          { sort: [{ by: '_expr', expr: expression }, byUrl] },
          {
            sort: [{ blend: [{ expression }, { expression: 'stock' }] }, byUrl],
          },
          windowOf(expression),
        ]) {
          let outcome: Ranked | undefined;
          let error = await refusal(async () => {
            outcome = await run(q);
          });
          if (error) {
            assert.ok(
              error instanceof InvalidQueryError,
              `refused: ${(error as Error).message}`,
            );
            assert.strictEqual(
              typeof (error as InvalidQueryError).code,
              'string',
              `with a code: ${(error as InvalidQueryError).code}`,
            );
          } else {
            assert.strictEqual(
              outcome!.ids.length,
              ITEMS.length,
              'the query ran over every row',
            );
          }
        }
        assert.deepEqual(
          statements.filter((s) => s.includes(MARK) || s.includes('\u0000')),
          [],
          'no statement carries the text',
        );
        await tableIsIntact(assert);
      });
    }

    // --- 6: NOW() and TODAY() ------------------------------------------------

    const dated = ITEMS.filter((item) => !isBlank(item.updatedAt));

    // SQL takes NOW() and TODAY() only inside DAYS (a date is no number):
    // alone, each is refused.
    for (let expression of ['NOW()', 'TODAY()']) {
      test(`${expression} alone is refused with expression-unsupported: use it inside DAYS`, async function (assert) {
        let error: any = await refusal(() =>
          run({ sort: [{ expression }, byUrl] }),
        );
        assert.strictEqual(error?.code, 'expression-unsupported');
        assert.true(/DAYS/.test(String(error?.message)), error?.message);
      });
    }

    // Each row's age gives back the instant NOW() stood for: its stored time
    // plus the age. Every row must give the same instant, one that falls
    // while the query ran. A millisecond of slack covers the arithmetic.
    async function instantsSeen(
      expression: string,
      perDay: number,
      how: Record<string, any>,
    ) {
      let before = Date.now();
      let windowed = how.sort?.[0]?.top !== undefined;
      let { values, meta } = await run(
        how,
        windowed ? '_window' : '_expression',
      );
      let after = Date.now();
      let instants = dated.map(
        (item) =>
          instant(item.updatedAt!) + (values.get(item.id)! / perDay) * DAY_MS,
      );
      return { before, after, instants, values, meta, expression };
    }

    for (let [label, expression, perDay] of [
      ['days', 'DAYS(NOW(), updatedAt)', 1],
      ['hours', 'DAYS(NOW(), updatedAt) * 24', 24],
    ] as [string, string, number][]) {
      test(`age in fractional ${label} from a stored time, in SQL: one instant for every row`, async function (assert) {
        let { before, after, instants, meta } = await instantsSeen(
          expression,
          perDay,
          {
            sort: [{ expression }, byUrl],
          },
        );
        assert.strictEqual(meta.window, undefined, 'over every match');
        assert.ok(
          Math.max(...instants) - Math.min(...instants) <= 1,
          'every row sees the same instant',
        );
        assert.ok(
          within(instants[0], before - 1, after + 1),
          `the instant falls while the query ran: ${new Date(instants[0]).toISOString()}`,
        );
      });

      test(`age in fractional ${label} from a stored time, in a window: one instant for every row`, async function (assert) {
        let { before, after, instants, meta } = await instantsSeen(
          expression,
          perDay,
          windowOf(expression),
        );
        assert.strictEqual(meta.window?.rows, ITEMS.length);
        assert.ok(
          Math.max(...instants) - Math.min(...instants) <= 1,
          'every row sees the same instant',
        );
        assert.ok(
          within(instants[0], before - 1, after + 1),
          `the instant falls while the query ran: ${new Date(instants[0]).toISOString()}`,
        );
      });
    }

    test('a row with no stored time has no age and ranks last', async function (assert) {
      let { ids, values } = await run({
        sort: [{ expression: 'DAYS(NOW(), updatedAt)' }, byUrl],
      });
      let undated = ITEMS.filter((item) => isBlank(item.updatedAt)).map(
        (item) => item.id,
      );
      assert.deepEqual(ids.slice(-undated.length), undated);
      assert.deepEqual(
        undated.map((id) => values.get(id)),
        undated.map(() => null),
      );
      // the oldest stored time has the greatest age, so it comes first
      let oldest = [...dated].sort(
        (a, b) => instant(a.updatedAt!) - instant(b.updatedAt!),
      )[0];
      assert.strictEqual(ids[0], oldest.id);
    });

    // TODAY() is midnight UTC, wherever the server or the database sits: the
    // part of the UTC day gone by is DAYS(NOW(), TODAY()).
    const dayFraction = (ms: number) => (ms % DAY_MS) / DAY_MS;
    for (let [label, how] of [
      ['in SQL', { sort: [{ expression: 'DAYS(NOW(), TODAY())' }, byUrl] }],
      ['in a window', windowOf('DAYS(NOW(), TODAY())')],
    ] as [string, Record<string, any>][]) {
      test(`TODAY() inside DAYS is midnight UTC ${label}`, async function (assert) {
        let before = Date.now();
        let windowed = how.sort?.[0]?.top !== undefined;
        let { values, meta } = await run(
          how,
          windowed ? '_window' : '_expression',
        );
        let after = Date.now();
        assert.strictEqual(
          meta.window?.rows,
          windowed ? ITEMS.length : undefined,
        );
        let seen = [...new Set(values.values())];
        assert.strictEqual(seen.length, 1, 'every row sees the same value');
        let slack = 1 / DAY_MS;
        // a run that crosses midnight UTC is not checked
        let crossedMidnight = dayFraction(after) < dayFraction(before);
        assert.ok(
          crossedMidnight
            ? true
            : within(
                seen[0]!,
                dayFraction(before) - slack,
                dayFraction(after) + slack,
              ),
          `${seen[0]} of a day, between ${dayFraction(before)} and ${dayFraction(after)}`,
        );
      });
    }
  });
});
