import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  backfillFacetValues,
  facetFieldSpecsOf,
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
import {
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common/search-entry';

import { setupDB } from './helpers/index.ts';

// What a shop and a social feed ask of search, one row per intent. The talk
// library's intents are in talk-search-intent-test.ts, which renders and
// indexes real cards; these two tables seed the index directly, so they cost
// one database and no render.
//
// An intent is written once the way a query saved in a realm writes it (an
// `on` anchor on every operator) and, where the newer spelling says it
// differently, once in that spelling. The runner asks each intent in every
// form it has: as saved, in the newer spelling, and over the search wire
// (derived from the saved form and read back, as a client and a server do).
// All of them must return the rows a plain reading of the intent picks from
// the fixture, in the order it gives when the intent has one.
//
// Ranking that fuses several signals has no saved spelling, so those intents
// are written in the newer one only, and say which row has to come first.
//
// Left to other suites: `near` (vector-search-test.ts), words and typos
// (talk-search-intent-test.ts), facet options (search-facets-integration-
// test.ts).

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const realm = 'http://app-queries-test/';
const refs = {
  string: ref('@cardstack/base/string', 'default'),
  number: ref('@cardstack/base/number', 'default'),
  boolean: ref('@cardstack/base/boolean', 'default'),
};

type Kind = 'string' | 'number' | 'boolean' | 'strings';
type Value = string | number | boolean | string[] | null;
type Doc = Record<string, Value>;

interface App {
  ref: ResolvedCodeRef;
  fields: Record<string, Kind>;
  rows: Record<string, Doc>;
}

function definitionOf(app: App): Definition {
  let names = Object.keys(app.fields);
  return {
    type: 'card-def',
    codeRef: app.ref,
    displayName: app.ref.name,
    fields: Object.fromEntries(names.map((n, i) => [n, `f${i}`])),
    fieldDefs: Object.fromEntries(
      names.map((n, i) => {
        let kind = app.fields[n];
        return [
          `f${i}`,
          {
            type: kind === 'strings' ? 'containsMany' : 'contains',
            isPrimitive: true,
            isComputed: false,
            fieldOrCard:
              kind === 'number'
                ? refs.number
                : kind === 'boolean'
                  ? refs.boolean
                  : refs.string,
            ...(kind === 'number' || kind === 'boolean'
              ? { serializerName: kind }
              : {}),
            // Every field of these apps is one their sidebars may count.
            search: { facet: true },
          },
        ];
      }),
    ),
  } as Definition;
}

// --- the shop ---------------------------------------------------------------

const DAY = 86_400;
const NOW = 1_780_000_000;

const product = (
  department: string,
  kind: string,
  brand: string | null,
  price: number,
  listPrice: number,
  rating: number | null,
  views30d: number,
  colors: string[],
  tags: string[],
  inStock: boolean,
): Doc => ({
  department,
  kind,
  brand,
  price,
  discount: Math.round((1 - price / listPrice) * 100),
  rating,
  views30d,
  colors,
  tags,
  inStock,
});

const Shop: App = {
  ref: ref(`${realm}product`, 'Product'),
  fields: {
    department: 'string',
    kind: 'string',
    brand: 'string',
    price: 'number',
    discount: 'number',
    rating: 'number',
    views30d: 'number',
    colors: 'strings',
    tags: 'strings',
    inStock: 'boolean',
  },
  // prettier-ignore
  rows: {
    sofa:      product('Living', 'Sofa',   'Arlo',  899, 1199, 4.6, 5200, ['grey', 'blue'],   ['bestseller'],             true),
    loveseat:  product('Living', 'Sofa',   'Arlo',  649,  649, 4.1, 1800, ['grey'],           [],                         true),
    armchair:  product('Living', 'Chair',  'Birch', 349,  499, 4.8, 3100, ['green', 'grey'],  ['bestseller', 'new'],      true),
    sideTable: product('Living', 'Table',  'Birch',  89,   99, 3.9,  900, ['oak'],            ['new'],                    false),
    floorLamp: product('Living', 'Lamp',   'Cinder', 45,   90, 4.3, 2400, ['black', 'brass'], ['clearance'],              true),
    rug:       product('Living', 'Rug',    null,    120,  150, null,  300, ['blue', 'white'], ['refurbished'],            true),
    desk:      product('Office', 'Table',  'Birch', 279,  279, 4.4, 2700, ['oak', 'white'],   [],                         true),
    taskChair: product('Office', 'Chair',  'Cinder',199,  329, 4.7, 4100, ['black'],          ['bestseller'],             true),
    monitorArm:product('Office', 'Mount',  'Dune',   49,   49, 3.2,  650, ['black'],          ['refurbished', 'clearance'], true),
    bookcase:  product('Office', 'Shelf',  'Arlo',  159,  199, 4.0, 1200, ['white', 'oak'],   [],                         false),
    deskLamp:  product('Office', 'Lamp',   'Cinder', 35,   35, 4.5, 1500, ['white'],          ['new'],                    true),
    footrest:  product('Office', 'Stool',  null,     29,   49, 2.8,  200, [],                 ['clearance'],              true),
  },
};

// --- the feed ---------------------------------------------------------------

const post = (
  author: string,
  ageDays: number,
  likes: number,
  reposts: number,
  topics: string[],
  kind: 'post' | 'reply' | 'repost',
  language: string | null,
): Doc => ({
  author,
  postedAt: NOW - Math.round(ageDays * DAY),
  likes,
  reposts,
  topics,
  kind,
  language,
});

const Feed: App = {
  ref: ref(`${realm}post`, 'Post'),
  fields: {
    author: 'string',
    postedAt: 'number',
    likes: 'number',
    reposts: 'number',
    topics: 'strings',
    kind: 'string',
    language: 'string',
  },
  // prettier-ignore
  rows: {
    p01: post('ada',   0.2,  40,  6, ['databases', 'postgres'], 'post',   'en'),
    p02: post('ada',   3,   310, 55, ['databases'],             'post',   'en'),
    p03: post('brook', 0.5,  12,  0, ['cooking'],               'post',   'en'),
    p04: post('brook', 1,     3,  0, ['cooking', 'postgres'],   'reply',  'en'),
    p05: post('cy',    0.1, 950, 210, ['ai', 'databases'],      'post',   'en'),
    p06: post('cy',    9,    80, 14, ['ai'],                    'post',   null),
    p07: post('dee',   2,    25,  2, [],                        'post',   'fr'),
    p08: post('dee',   0.3,   0,  0, ['ai', 'spam'],            'post',   'en'),
    p09: post('eli',   6,   140, 30, ['postgres'],              'repost', 'en'),
    p10: post('eli',   0.8,  64,  9, ['cooking', 'ai'],         'post',   'de'),
    p11: post('fay',   12,  520, 70, ['databases', 'ai'],       'post',   'en'),
    p12: post('fay',   0.05,  7,  1, ['postgres'],              'reply',  'en'),
  },
};

const APPS = [Shop, Feed];

// --- intents ----------------------------------------------------------------

interface Intent {
  name: string;
  // As a query saved in a realm writes it.
  saved?: Record<string, any>;
  // In the newer spelling: a top-level `type`, bare operators and paths.
  typed?: Record<string, any>;
  // The rows a plain reading of the intent keeps.
  keep: (doc: Doc) => boolean;
  // The order the intent gives, when it gives a whole one (ties by URL).
  order?: (a: Doc, b: Doc) => number;
  // The row that has to come first, for a fused ranking.
  first?: string;
  // Facets asked for, each counted over the rows `counted` keeps (the kept
  // rows unless the facet leaves its own selection out).
  facets?: Record<string, (doc: Doc) => boolean>;
}

const num = (v: Value) => v as number;
const list = (v: Value) => v as string[];
const by =
  (field: string, direction: 'asc' | 'desc') =>
  (a: Doc, b: Doc): number =>
    (num(a[field]) - num(b[field])) * (direction === 'asc' ? 1 : -1);

function shopIntents(): Intent[] {
  let on = Shop.ref;
  let type = Shop.ref;
  let url = { by: 'cardURL' };
  return [
    {
      name: 'a department, cheapest first',
      saved: {
        filter: { on, eq: { department: 'Living' } },
        sort: [{ on, by: 'price', direction: 'asc' }, url],
      },
      typed: {
        type,
        filter: { eq: { department: 'Living' } },
        sort: [{ by: 'price', direction: 'asc' }, url],
      },
      keep: (d) => d.department === 'Living',
      order: by('price', 'asc'),
    },
    {
      name: 'checklists: picked brands together, picked colors together',
      saved: {
        filter: {
          on,
          every: [
            {
              on,
              any: [
                { on, eq: { brand: 'Arlo' } },
                { on, eq: { brand: 'Birch' } },
              ],
            },
            { on, in: { colors: ['grey', 'oak'] } },
          ],
        },
      },
      typed: {
        type,
        filter: {
          every: [
            { in: { brand: ['Arlo', 'Birch'] } },
            { in: { colors: ['grey', 'oak'] } },
          ],
        },
      },
      keep: (d) =>
        ['Arlo', 'Birch'].includes(d.brand as string) &&
        list(d.colors).some((c) => ['grey', 'oak'].includes(c)),
    },
    {
      name: 'a shelf: under 300, four stars up, best rated first',
      saved: {
        filter: {
          on,
          every: [
            { on, range: { price: { lt: 300 } } },
            { on, range: { rating: { gte: 4 } } },
          ],
        },
        sort: [{ on, by: 'rating', direction: 'desc' }, url],
      },
      typed: {
        type,
        filter: { range: { price: { lt: 300 }, rating: { gte: 4 } } },
        sort: [{ by: 'rating', direction: 'desc' }, url],
      },
      keep: (d) => num(d.price) < 300 && d.rating != null && num(d.rating) >= 4,
      order: by('rating', 'desc'),
    },
    {
      name: 'on sale: a fifth off or more, in stock, deepest cut first',
      saved: {
        filter: {
          on,
          every: [
            { on, range: { discount: { gte: 20 } } },
            { on, eq: { inStock: true } },
          ],
        },
        sort: [{ on, by: 'discount', direction: 'desc' }, url],
      },
      typed: {
        type,
        filter: {
          every: [
            { range: { discount: { gte: 20 } } },
            { eq: { inStock: true } },
          ],
        },
        sort: [{ by: 'discount', direction: 'desc' }, url],
      },
      keep: (d) => num(d.discount) >= 20 && d.inStock === true,
      order: by('discount', 'desc'),
    },
    {
      name: 'nothing refurbished, the untagged included',
      saved: { filter: { on, not: { eq: { tags: 'refurbished' } } } },
      typed: { type, filter: { not: { eq: { tags: 'refurbished' } } } },
      keep: (d) => !list(d.tags).includes('refurbished'),
    },
    {
      name: 'no brand on the listing',
      saved: { filter: { on, eq: { brand: null } } },
      typed: { type, filter: { eq: { brand: null } } },
      keep: (d) => d.brand == null,
    },
    {
      name: 'goes with a sofa: same department, another kind of thing',
      saved: {
        filter: {
          on,
          every: [
            { on, eq: { department: 'Living' } },
            { on, not: { eq: { kind: 'Sofa' } } },
          ],
        },
        sort: [{ on, by: 'views30d', direction: 'desc' }, url],
        page: { size: 3 },
      },
      typed: {
        type,
        filter: {
          every: [
            { eq: { department: 'Living' } },
            { not: { eq: { kind: 'Sofa' } } },
          ],
        },
        sort: [{ by: 'views30d', direction: 'desc' }, url],
        page: { size: 3 },
      },
      keep: (d) => d.department === 'Living' && d.kind !== 'Sofa',
      order: by('views30d', 'desc'),
    },
    {
      name: 'the sidebar: a picked brand filters the grid, not its own list',
      saved: {
        filter: {
          every: [
            { type: on },
            { on, eq: { department: 'Office' } },
            { on, in: { brand: ['Cinder'] } },
          ],
        },
        facets: [{ by: 'brand', own: 'ignore' }, { by: 'colors' }],
      },
      typed: {
        type,
        filter: {
          every: [
            { eq: { department: 'Office' } },
            { in: { brand: ['Cinder'] } },
          ],
        },
        facets: [{ by: 'brand', own: 'ignore' }, { by: 'colors' }],
      },
      keep: (d) => d.department === 'Office' && d.brand === 'Cinder',
      facets: {
        brand: (d) => d.department === 'Office',
        colors: (d) => d.department === 'Office' && d.brand === 'Cinder',
      },
    },
    {
      name: 'best match with no words: views and rating fused',
      typed: {
        type,
        filter: { eq: { inStock: true } },
        sort: [
          {
            blend: [
              { by: 'views30d', direction: 'desc', weight: 2 },
              { by: 'rating', direction: 'desc' },
            ],
          },
        ],
      },
      keep: (d) => d.inStock === true,
      first: 'sofa',
    },
    {
      name: 'a promoted tag lifts its products and drops none',
      typed: {
        type,
        filter: { eq: { department: 'Office' } },
        sort: [
          {
            blend: [
              { by: 'price', direction: 'asc' },
              { boost: { eq: { tags: 'bestseller' } }, weight: 5 },
            ],
          },
        ],
      },
      keep: (d) => d.department === 'Office',
      first: 'taskChair',
    },
  ];
}

function feedIntents(): Intent[] {
  let on = Feed.ref;
  let type = Feed.ref;
  let url = { by: 'cardURL' };
  let following = ['ada', 'cy', 'eli'];
  let muted = ['dee'];
  let dayAgo = NOW - DAY;
  return [
    {
      name: 'following: their posts, newest first',
      saved: {
        filter: { on, in: { author: following } },
        sort: [{ on, by: 'postedAt', direction: 'desc' }, url],
      },
      typed: {
        type,
        filter: { in: { author: following } },
        sort: [{ by: 'postedAt', direction: 'desc' }, url],
      },
      keep: (d) => following.includes(d.author as string),
      order: by('postedAt', 'desc'),
    },
    {
      name: 'following, second page of four',
      saved: {
        filter: { on, in: { author: following } },
        sort: [{ on, by: 'postedAt', direction: 'desc' }, url],
        page: { size: 4, number: 1 },
      },
      typed: {
        type,
        filter: { in: { author: following } },
        sort: [{ by: 'postedAt', direction: 'desc' }, url],
        page: { size: 4, number: 1 },
      },
      keep: (d) => following.includes(d.author as string),
      order: by('postedAt', 'desc'),
    },
    {
      name: 'a topic, originals only, muted authors left out',
      saved: {
        filter: {
          on,
          every: [
            { on, eq: { topics: 'ai' } },
            { on, eq: { kind: 'post' } },
            { on, not: { in: { author: muted } } },
          ],
        },
      },
      typed: {
        type,
        filter: {
          every: [
            { eq: { topics: 'ai', kind: 'post' } },
            { not: { in: { author: muted } } },
          ],
        },
      },
      keep: (d) =>
        list(d.topics).includes('ai') &&
        d.kind === 'post' &&
        !muted.includes(d.author as string),
    },
    {
      name: 'either of two topics, none marked spam',
      saved: {
        filter: {
          on,
          every: [
            {
              on,
              any: [
                { on, eq: { topics: 'postgres' } },
                { on, eq: { topics: 'ai' } },
              ],
            },
            { on, not: { eq: { topics: 'spam' } } },
          ],
        },
      },
      typed: {
        type,
        filter: {
          every: [
            { in: { topics: ['postgres', 'ai'] } },
            { not: { eq: { topics: 'spam' } } },
          ],
        },
      },
      keep: (d) =>
        list(d.topics).some((t) => ['postgres', 'ai'].includes(t)) &&
        !list(d.topics).includes('spam'),
    },
    {
      name: 'both topics on one post',
      saved: {
        filter: {
          on,
          every: [
            { on, eq: { topics: 'ai' } },
            { on, eq: { topics: 'databases' } },
          ],
        },
      },
      typed: {
        type,
        filter: {
          every: [{ eq: { topics: 'ai' } }, { eq: { topics: 'databases' } }],
        },
      },
      keep: (d) =>
        list(d.topics).includes('ai') && list(d.topics).includes('databases'),
    },
    {
      name: 'trending: the last day, most liked first',
      saved: {
        filter: {
          on,
          every: [
            { on, range: { postedAt: { gte: dayAgo } } },
            { on, not: { eq: { kind: 'reply' } } },
          ],
        },
        sort: [{ on, by: 'likes', direction: 'desc' }, url],
      },
      typed: {
        type,
        filter: {
          every: [
            { range: { postedAt: { gte: dayAgo } } },
            { not: { eq: { kind: 'reply' } } },
          ],
        },
        sort: [{ by: 'likes', direction: 'desc' }, url],
      },
      keep: (d) => num(d.postedAt) >= dayAgo && d.kind !== 'reply',
      order: by('likes', 'desc'),
    },
    {
      name: 'an engagement floor on two counts',
      saved: {
        filter: {
          on,
          every: [
            { on, range: { likes: { gte: 50 } } },
            { on, range: { reposts: { gte: 10 } } },
          ],
        },
      },
      typed: {
        type,
        filter: { range: { likes: { gte: 50 }, reposts: { gte: 10 } } },
      },
      keep: (d) => num(d.likes) >= 50 && num(d.reposts) >= 10,
    },
    {
      name: 'a language, or none stated; a post in another is left out',
      saved: {
        filter: {
          on,
          any: [
            { on, eq: { language: 'en' } },
            { on, eq: { language: null } },
          ],
        },
      },
      typed: { type, filter: { in: { language: ['en', null] } } },
      keep: (d) => d.language === 'en' || d.language == null,
    },
    {
      name: 'what the feed is about: topics and authors counted over it',
      saved: {
        filter: { every: [{ type: on }, { on, eq: { kind: 'post' } }] },
        facets: [{ by: 'topics' }, { by: 'author' }],
      },
      typed: {
        type,
        filter: { eq: { kind: 'post' } },
        facets: [{ by: 'topics' }, { by: 'author' }],
      },
      keep: (d) => d.kind === 'post',
      facets: {
        topics: (d) => d.kind === 'post',
        author: (d) => d.kind === 'post',
      },
    },
    {
      name: 'for you: fresh and liked, lifted by a followed topic',
      typed: {
        type,
        filter: {
          every: [
            { eq: { kind: 'post' } },
            { not: { eq: { topics: 'spam' } } },
          ],
        },
        sort: [
          {
            blend: [
              { by: 'postedAt', direction: 'desc' },
              { by: 'likes', direction: 'desc' },
              { boost: { eq: { topics: 'databases' } }, weight: 2 },
            ],
          },
        ],
      },
      keep: (d) => d.kind === 'post' && !list(d.topics).includes('spam'),
      first: 'p05',
    },
  ];
}

// --- the runner -------------------------------------------------------------

function makeDefinitionLookup(): DefinitionLookup {
  let definitions = [
    ...APPS.map(definitionOf),
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

const urlOf = (app: App, name: string) => `${realm}${app.ref.name}/${name}`;

async function seed(dbAdapter: PgAdapter, vn: VirtualNetwork, app: App) {
  let typeKey = internalKeyFor(app.ref, undefined, vn);
  for (let [name, doc] of Object.entries(app.rows)) {
    let url = urlOf(app, name);
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
  // The rows went in by hand, so their facet rows are derived the way a
  // declaration-only change derives them: from the search docs.
  let definition = definitionOf(app);
  await backfillFacetValues(
    dbAdapter,
    realm,
    typeKey,
    await facetFieldSpecsOf(definition, async () => undefined),
  );
}

function expectedUrls(app: App, intent: Intent): string[] {
  let kept = Object.entries(app.rows)
    .filter(([, doc]) => intent.keep(doc))
    .map(([name, doc]) => ({ url: urlOf(app, name), doc }));
  if (intent.order) {
    let order = intent.order;
    kept.sort((a, b) => order(a.doc, b.doc) || (a.url < b.url ? -1 : 1));
  } else {
    kept.sort((a, b) => (a.url < b.url ? -1 : 1));
  }
  let urls = kept.map((k) => k.url);
  let page = (intent.saved ?? intent.typed)?.page as
    | { size?: number; number?: number }
    | undefined;
  if (intent.order && page?.size) {
    let start = (page.number ?? 0) * page.size;
    return urls.slice(start, start + page.size);
  }
  return urls;
}

function expectedCounts(
  app: App,
  field: string,
  counted: (doc: Doc) => boolean,
): Record<string, number> {
  let counts: Record<string, number> = {};
  for (let doc of Object.values(app.rows).filter(counted)) {
    let v = doc[field];
    for (let value of v == null ? [] : Array.isArray(v) ? v : [v]) {
      counts[String(value)] = (counts[String(value)] ?? 0) + 1;
    }
  }
  return counts;
}

module(basename(import.meta.filename), function () {
  module('app queries (Postgres integration)', function (hooks) {
    let engine: IndexQueryEngine;

    setupDB(hooks, {
      before: async (dbAdapter) => {
        let vn = new VirtualNetwork();
        engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
        for (let app of APPS) {
          await seed(dbAdapter, vn, app);
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

    // Every form the intent has, as the query the engine is handed.
    function forms(intent: Intent): [string, Record<string, any>][] {
      let out: [string, Record<string, any>][] = [];
      if (intent.saved) {
        out.push(['as saved', intent.saved]);
        out.push([
          'over the wire',
          parseSearchEntryQueryFromPayload(
            JSON.parse(
              JSON.stringify(
                searchEntryWireQueryFromQuery(intent.saved as Query),
              ),
            ),
          ).itemQuery,
        ]);
      }
      if (intent.typed) {
        out.push(['newer spelling', lowerQuery(intent.typed).query]);
        out.push([
          'newer spelling over the wire',
          parseSearchEntryQueryFromPayload(
            JSON.parse(JSON.stringify(intent.typed)),
          ).itemQuery,
        ]);
      }
      return out;
    }

    function table(app: App, intents: Intent[]) {
      for (let intent of intents) {
        test(`${app.ref.name}: ${intent.name}`, async function (assert) {
          let expected = expectedUrls(app, intent);
          assert.notStrictEqual(expected.length, 0, 'the fixture has matches');
          assert.notStrictEqual(
            expected.length,
            Object.keys(app.rows).length,
            'and rows that do not match',
          );
          for (let [form, q] of forms(intent)) {
            let { urls, meta } = await search(q);
            if (intent.order) {
              assert.deepEqual(urls, expected, `${form}: rows in order`);
            } else {
              assert.deepEqual([...urls].sort(), expected, `${form}: rows`);
            }
            if (intent.first) {
              assert.strictEqual(
                urls[0],
                urlOf(app, intent.first),
                `${form}: first row`,
              );
            }
            for (let [field, counted] of Object.entries(intent.facets ?? {})) {
              let got = Object.fromEntries(
                ((meta as any).facets?.[field] ?? []).map(
                  (f: { value: string; count: number }) => [f.value, f.count],
                ),
              );
              assert.deepEqual(
                got,
                expectedCounts(app, field, counted),
                `${form}: ${field} counts`,
              );
            }
          }
        });
      }
    }

    table(Shop, shopIntents());
    table(Feed, feedIntents());
  });
});
