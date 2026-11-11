import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  SEARCH_TEXT_KEY,
  VectorSerializer,
  VirtualNetwork,
  applyServerSearchPageBound,
  hasVectorIndex,
  internalKeyFor,
  parseSearchEntryQueryFromPayload,
  rri,
  searchEntryWireQueryFromQuery,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { usesNewSyntax } from '@cardstack/runtime-common/query-syntax';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './index.ts';
import { withFacetFields } from './facet-fields.ts';

// The shop every query-by-example file searches: twelve products, four
// brands, two wish lists and one file. The table below is printed at the top
// of each of those files, so a reader never has to open this one.
//
// Everything is written through the real index writer, which is what fills
// the full-text vectors, the word list (typos), the pattern text, the passage
// rows and the vector table. What a card render would stamp into the search
// doc is supplied by hand: the words of each field by role (`_searchText`),
// the type-ahead text (`_typeahead`), the title (`_title`) and the names of
// the passage lists (`_passages`).

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

export const Product = ref(`${testRealm}shop`, 'Product');
export const Brand = ref(`${testRealm}shop`, 'Brand');
export const WishList = ref(`${testRealm}shop`, 'WishList');
const Review = ref(`${testRealm}shop`, 'Review');

// The three directions a product's `look` vector can point in.
export const WARM = [1, 0, 0];
export const COOL = [0, 1, 0];
export const NEUTRAL = [0, 0, 1];

const base = (name: string) => ref(`@cardstack/base/${name}`, 'default');
const text = (search?: object) => ({
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: base('string'),
  ...(search ? { search } : {}),
});
const number = (search?: object) => ({
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: base('number'),
  serializerName: 'number',
  ...(search ? { search } : {}),
});
const names = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(fields).map((name) => [name, name]));

// What the shop's card types declare (docs/search-intent.md).
const productFields = {
  id: text(),
  name: text({ role: 'title' }),
  kind: text({ role: 'label', facet: true }),
  blurb: text({ role: 'body' }),
  material: text({ facet: true }),
  color: text({ facet: true }),
  sku: text({ role: 'identifier', patterns: true }),
  price: number({ facet: true }),
  rating: number(),
  sold: number({ rank: 'popularity' }),
  inStock: {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard: base('boolean'),
    serializerName: 'boolean',
  },
  tags: {
    type: 'containsMany',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard: base('string'),
    search: { facet: true },
  },
  listed: {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard: base('date'),
    serializerName: 'date',
    search: { facet: true },
  },
  restocked: {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard: base('date'),
    serializerName: 'date',
  },
  brand: {
    type: 'linksTo',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: Brand,
    // The brand's own fields ride in the product's search doc.
    searchable: true,
    search: { facet: true },
  },
  look: {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard: base('vector'),
    serializerName: 'vector',
    search: { neighbors: true },
  },
  reviews: {
    type: 'containsMany',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: Review,
  },
};
const brandFields = {
  id: text(),
  name: text({ role: 'title', facet: true }),
  founded: number(),
};
const wishListFields = {
  id: text(),
  owner: text({ role: 'title' }),
  items: {
    type: 'linksToMany',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: Product,
  },
};
const reviewFields = { text: text({ role: 'body' }) };

const definitions = [
  { type: 'card-def', codeRef: Product, fieldDefs: productFields },
  { type: 'card-def', codeRef: Brand, fieldDefs: brandFields },
  { type: 'card-def', codeRef: WishList, fieldDefs: wishListFields },
  { type: 'field-def', codeRef: Review, fieldDefs: reviewFields },
  {
    type: 'card-def',
    codeRef: ref('@cardstack/base/card-api', 'CardDef'),
    fieldDefs: { id: text() },
  },
].map(
  (d) =>
    ({
      ...d,
      displayName: d.codeRef.name,
      fields: names(d.fieldDefs),
    }) as unknown as Definition,
);

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
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
  } as unknown as DefinitionLookup;
  return lookup;
}

// --- the shop ---------------------------------------------------------------

type BrandName = 'Lumen' | 'Oakline' | 'Hearth' | 'Tidewater';

const BRANDS: Record<BrandName, { founded: number }> = {
  Lumen: { founded: 1998 },
  Oakline: { founded: 1975 },
  Hearth: { founded: 2011 },
  Tidewater: { founded: 2019 },
};

interface ProductRow {
  name: string;
  kind: string;
  brand: BrandName | null;
  price: number;
  rating: number;
  sold: number;
  inStock: boolean | null;
  color: string | null;
  material: string;
  tags: string[];
  sku: string;
  listed: string;
  look: number[] | null;
  blurb: string;
}

const product = (
  name: string,
  kind: string,
  brand: BrandName | null,
  price: number,
  rating: number,
  sold: number,
  inStock: boolean | null,
  color: string | null,
  material: string,
  tags: string[],
  sku: string,
  listed: string,
  look: number[] | null,
  blurb: string,
): ProductRow => ({
  name,
  kind,
  brand,
  price,
  rating,
  sold,
  inStock,
  color,
  material,
  tags,
  sku,
  listed,
  look,
  blurb,
});

// Prices, ratings and units sold are all different, so no sort on one of them
// ties.
// prettier-ignore
const PRODUCTS: Record<string, ProductRow> = {
  brass:   product('Brass Desk Lamp',      'lamp',    'Lumen',      80, 4.5, 120, true,  'gold',   'brass',   ['office', 'gift'],     'LMP-100', '2026-01-05', [1, 0, 0],     'A weighted brass lamp for late-night reading at a desk.'),
  paper:   product('Paper Floor Lamp',     'lamp',    'Lumen',      60, 4.0,  90, true,  'white',  'paper',   ['living'],             'LMP-200', '2026-01-20', [0, 0, 1],     'A tall paper shade on a solid oak tripod.'),
  clamp:   product('Clamp Reading Lamp',   'lamp',    'Tidewater',  35, 3.5, 300, false, 'blue',   'steel',   ['office', 'bedroom'],  'LMP-300', '2026-02-03', [0, 1, 0],     'Clamps to a shelf or a headboard.'),
  salt:    product('Salt Rock Lamp',       'lamp',    null,         25, 4.8,  40, true,  'orange', 'salt',    ['gift'],               'LMP-40X', '2026-02-14', [0.8, 0.6, 0], 'Carved from pink salt; glows a warm amber.'),
  oak:     product('Oak Dining Chair',     'chair',   'Oakline',   150, 4.6,  70, true,  null,     'oak',     ['dining'],             'CHR-100', '2026-01-05', [0.8, 0, 0.6], 'Oak, solid build, with a woven seat.'),
  velvet:  product('Velvet Reading Chair', 'chair',   'Oakline',   300, 4.9,  30, false, 'red',    'velvet',  ['living', 'bedroom'],  'CHR-200', '2026-03-09', [1, 0, 0],     'A deep velvet armchair for long evenings with a book.'),
  folding: product('Steel Folding Chair',  'chair',   'Tidewater',  45, 3.0, 500, true,  null,     'steel',   [],                     'CHR-300', '2026-02-03', [0, 0, 1],     'Folds flat; stacks six to a closet.'),
  wool:    product('Wool Area Rug',        'rug',     'Hearth',    200, 4.2,  60, true,  'red',    'wool',    ['living'],             'RUG-100', '2026-01-20', [0.8, 0.6, 0], 'Hand-tufted wool in a deep red; soft underfoot.'),
  jute:    product('Jute Hallway Rug',     'rug',     'Hearth',     90, 3.8,  80, null,  'brown',  'jute',    ['living'],             'RUG-200', '2026-03-21', [0.6, 0, 0.8], 'Braided jute that hides hallway dirt.'),
  striped: product('Striped Outdoor Rug',  'rug',     'Tidewater', 100, 4.1, 150, false, 'blue',   'plastic', ['outdoor'],            'RUG-12B', '2026-02-14', [0, 1, 0],     'Woven from recycled plastic; hose it clean.'),
  sofa:    product('Linen Sleeper Sofa',   'sofa',    'Oakline',   900, 4.4,  20, true,  'white',  'linen',   ['living', 'bedroom'],  'SOF-100', '2026-03-09', null,          'A linen sofa that unfolds into a guest bed.'),
  throw:   product('Wool Throw Blanket',   'blanket', 'Hearth',     55, 4.3, 200, true,  'blue',   'wool',    ['gift', 'bedroom'],    'BLK-100', '2026-02-03', [0.6, 0.8, 0], 'A woven wool throw for the sofa or the foot of a bed.'),
};

// How many days ago a product was last restocked; the rest never were.
const RESTOCKED_DAYS_AGO: Record<string, number> = {
  brass: 3,
  throw: 10,
  clamp: 45,
};

// What shoppers wrote; each review is one passage of the product.
const REVIEWS: Record<string, string[]> = {
  brass: ['Heavy base, never tips over.', 'The switch is stiff at first.'],
  folding: ['Wobbles on a tiled floor.'],
};

const WISH_LISTS: Record<string, { owner: string; items: string[] }> = {
  ada: { owner: 'Ada', items: ['brass', 'salt', 'velvet', 'throw'] },
  ben: { owner: 'Ben', items: ['clamp', 'throw'] },
};

// The one file in the realm, for `scope`.
const FILE_NAME = 'wool-care.md';
const FILE_TEXT = 'How to wash wool: cold water, and dry it flat.';

// --- ids --------------------------------------------------------------------

// A card's id, as a query names it: productId('brass'), brandId('Lumen'),
// wishListId('ada').
export const productId = (key: string) => `${testRealm}Product/${key}`;
export const brandId = (name: string) =>
  `${testRealm}Brand/${name.toLowerCase()}`;
export const wishListId = (key: string) => `${testRealm}WishList/${key}`;

const NAMES = new Map<string, string>([
  ...Object.entries(PRODUCTS).map(
    ([key, p]) => [productId(key), p.name] as [string, string],
  ),
  ...Object.keys(BRANDS).map(
    (name) => [brandId(name), name] as [string, string],
  ),
  ...Object.entries(WISH_LISTS).map(
    ([key, list]) =>
      [wishListId(key), `${list.owner}'s wish list`] as [string, string],
  ),
  [`${testRealm}${FILE_NAME}`, FILE_NAME],
]);

// --- seeding ----------------------------------------------------------------

const vector = (components: number[]) =>
  VectorSerializer.queryableValue(
    VectorSerializer.encodeVector(components, { encoding: 'float32' }),
  );

function daysAgo(days: number): string {
  let date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function productSearchDoc(key: string, p: ProductRow) {
  let reviews = REVIEWS[key];
  return {
    name: p.name,
    kind: p.kind,
    blurb: p.blurb,
    material: p.material,
    sku: p.sku,
    price: p.price,
    rating: p.rating,
    sold: p.sold,
    tags: p.tags,
    listed: p.listed,
    ...(p.color == null ? {} : { color: p.color }),
    ...(p.inStock == null ? {} : { inStock: p.inStock }),
    ...(key in RESTOCKED_DAYS_AGO
      ? { restocked: daysAgo(RESTOCKED_DAYS_AGO[key]) }
      : {}),
    // a `searchable` link carries the brand's own fields beside its id
    brand: p.brand
      ? {
          id: brandId(p.brand),
          name: p.brand,
          founded: BRANDS[p.brand].founded,
        }
      : null,
    ...(p.look ? { look: vector(p.look) } : {}),
    ...(reviews
      ? { reviews: reviews.map((text) => ({ text })), _passages: ['reviews'] }
      : {}),
    // what a render stamps
    _title: p.name,
    _typeahead: p.name,
    [SEARCH_TEXT_KEY]: {
      A: p.name,
      B: p.kind,
      C: p.material,
      D: p.blurb,
      patterns: p.sku,
    },
  };
}

interface Shop {
  adapter: PgAdapter;
  engine: IndexQueryEngine;
}
let shop: Shop | undefined;

async function openShop(): Promise<Shop> {
  prepareTestDB();
  let adapter = await createTestPgAdapter();
  if (!(await hasVectorIndex(adapter))) {
    await closeTestPgAdapter(adapter);
    throw new Error(
      'The query-by-example tests need the pgvector extension in the test Postgres, and this database does not have it. Install pgvector in the test database image; these tests do not skip.',
    );
  }
  let virtualNetwork = new VirtualNetwork();
  let engine = new IndexQueryEngine(
    adapter,
    makeDefinitionLookup(),
    virtualNetwork,
  );
  let key = (type: ResolvedCodeRef) =>
    internalKeyFor(type, undefined, virtualNetwork);
  let batch = await new IndexWriter(adapter).createBatch(
    new URL(testRealm),
    virtualNetwork,
    undefined,
    { splitPrerenderHtml: false },
  );
  let card = async (
    id: string,
    type: ResolvedCodeRef,
    searchData: Record<string, unknown>,
    markdown: string,
  ) => {
    let url = new URL(`${id}.json`);
    await batch.updateEntry(url, {
      type: 'instance',
      resource: {
        id: rri(url.href),
        type: 'card',
        attributes: {},
        meta: { adoptsFrom: { module: rri(type.module), name: type.name } },
      },
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      // the declared facet fields, as a render stamps them
      searchData: await withFacetFields(
        { id, ...searchData },
        definitions.find(
          (d) => (d.codeRef as ResolvedCodeRef).name === type.name,
        )!,
        makeDefinitionLookup(),
      ),
      markdown,
      deps: new Set(),
      displayNames: [type.name],
      types: [key(type)],
      isolatedHtml: `<div>${markdown}</div>`,
    });
  };
  for (let [name, { founded }] of Object.entries(BRANDS)) {
    await card(
      brandId(name),
      Brand,
      {
        name,
        founded,
        cardTitle: name,
        _title: name,
        _typeahead: name,
        [SEARCH_TEXT_KEY]: { A: name },
      },
      `# ${name}`,
    );
  }
  for (let [k, p] of Object.entries(PRODUCTS)) {
    await card(
      productId(k),
      Product,
      productSearchDoc(k, p),
      `# ${p.name}\n\n${p.blurb}`,
    );
  }
  for (let [k, list] of Object.entries(WISH_LISTS)) {
    let title = `${list.owner}'s wish list`;
    await card(
      wishListId(k),
      WishList,
      {
        owner: list.owner,
        items: list.items.map((item) => ({ id: productId(item) })),
        _title: title,
        _typeahead: title,
        [SEARCH_TEXT_KEY]: { A: title },
      },
      `# ${title}`,
    );
  }
  await batch.updateEntry(new URL(`${testRealm}${FILE_NAME}`), {
    type: 'file',
    lastModified: Date.now(),
    resourceCreatedAt: Date.now(),
    searchData: { name: FILE_NAME, _title: FILE_NAME },
    markdown: FILE_TEXT,
    deps: new Set(),
    displayNames: ['Markdown'],
    types: [],
  });
  await batch.done();
  return { adapter, engine };
}

// Opens the shop before a file's tests and closes it after them. Nothing in
// these files writes, so one seeding serves the whole file.
export function setupShop(hooks: NestedHooks) {
  hooks.before(async function () {
    shop = await openShop();
  });
  hooks.after(async function () {
    if (shop) {
      await closeTestPgAdapter(shop.adapter);
      shop = undefined;
    }
  });
}

// --- asking -----------------------------------------------------------------

export interface AnswerRow {
  name: string;
  // The scores the query computed for this row, when it computed them.
  _matchRelevance?: number;
  _nearSimilarity?: number;
  _blendScore?: number;
  _collapseSize?: number;
  _expression?: number;
  _window?: number;
  _explain?: {
    score: number;
    k: number;
    signals: {
      signal: string;
      weight: number;
      value: number | null;
      rank: number | null;
      contribution: number;
    }[];
  };
}

export interface Answer {
  // The cards found, by name, in the query's order. A query with no `sort`
  // promises no order, so its names are listed A to Z.
  names: string[];
  rows: AnswerRow[];
  meta: any;
  // For a `select` query: the table it answers with.
  columns?: string[];
  table?: unknown[][];
}

const SCORES = [
  '_matchRelevance',
  '_nearSimilarity',
  '_blendScore',
  '_collapseSize',
  '_expression',
  '_window',
] as const;

const nameOf = (url: string) =>
  NAMES.get(url.replace(/\.json$/, '')) ?? url.slice(testRealm.length);

// Runs a query the way the realm's `_search` does: the request is parsed,
// then handed to the index. A query in the older spelling (an `on` in each
// clause) is put on the wire first, as a saved query is.
export async function ask(query: Record<string, unknown>): Promise<Answer> {
  if (!shop) {
    throw new Error('ask() needs setupShop(hooks) in the module');
  }
  let { scope, select, ...rest } = query;
  let payload = usesNewSyntax(query)
    ? query
    : {
        ...searchEntryWireQueryFromQuery(rest as Query),
        ...(scope ? { scope } : {}),
        ...(select ? { select } : {}),
      };
  let parsed = parseSearchEntryQueryFromPayload(
    JSON.parse(JSON.stringify(payload)),
  );
  // a request that names no page gets the server's default page
  let itemQuery = applyServerSearchPageBound(parsed.itemQuery);
  let opts = {};
  let realm = new URL(testRealm);
  if (parsed.columns) {
    let plans = await shop.engine.planColumns(
      parsed.typeAnchors![0],
      parsed.columns,
    );
    let { rows, meta } = await shop.engine.searchColumns(
      realm,
      itemQuery,
      opts,
      plans,
    );
    return {
      names: rows.map((row) => nameOf(String(row[0]))),
      rows: [],
      meta,
      columns: ['id', ...parsed.columns.map((column) => column.name)],
      table: rows,
    };
  }
  let { results, meta } = await shop.engine.search(
    realm,
    itemQuery,
    opts,
    { kind: 'renderSet' },
    scope === 'files' ? 'file' : scope === 'cards' ? 'instance' : 'all',
  );
  let rows = results.map((result) => {
    let raw = result as Record<string, unknown>;
    let row: AnswerRow = { name: nameOf(String(raw.url)) };
    for (let score of SCORES) {
      if (raw[score] != null) {
        row[score] = Number(raw[score]);
      }
    }
    if (raw._explain) {
      row._explain = raw._explain as AnswerRow['_explain'];
    }
    return row;
  });
  if (query.sort === undefined) {
    rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  return { names: rows.map((row) => row.name), rows, meta };
}

// A facet's counts as an object, for a facet whose order is not the point:
// { lamp: 4, chair: 3 }.
export function counts(
  facet: { value: string; count: number }[] | undefined,
): Record<string, number> {
  return Object.fromEntries((facet ?? []).map((f) => [f.value, f.count]));
}
