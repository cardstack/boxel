import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  InvalidQueryError,
  SEARCH_TEXT_KEY,
  VirtualNetwork,
  baseCardRef,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
  type SearchText,
} from '@cardstack/runtime-common';
import { lowerQuery } from '@cardstack/runtime-common/query-syntax';
import {
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common/search-entry';

import { setupDB } from './helpers/index.ts';

// Text search, case by case, against a real index: full-text `matches` and
// its options, typo tolerance, type-ahead, glob and regex filters, and
// relative dates in a range (docs/search.md and docs/search-intent.md).
//
// The rows go in through the index writer, with the grouped text a render
// would stamp for the declarations below, so the full-text vectors, the
// realm's word list and the pattern text are the writer's own. No card is
// rendered and no server runs.
//
// Each expectation is a plain reading of the fixture under the documented
// rule, and the comment beside it says which rule. Where the docs leave a
// behavior open, the case says "pins current behavior; rule not yet decided".
//
// A case is asked in every spelling it has: as a query saved in a realm
// writes it (an `on` on every operator), that query over the search wire
// (written out and read back, as a client and a server do), in the newer
// spelling (one top-level `type`), and the newer spelling over the wire. All
// must answer alike.
//
// Left to other suites: `within` (passages are seeded by hand in
// matches-filter-integration-test.ts), text relevance order, and `near`.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const realm = 'http://text-search-cases/';
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const booleanRef = ref('@cardstack/base/boolean', 'default');
const datetimeRef = ref('@cardstack/base/datetime', 'default');
const dateRef = ref('@cardstack/base/date', 'default');

const itemRef = ref(`${realm}item`, 'Item');
const brandRef = ref(`${realm}directory`, 'Brand');
const shopRef = ref(`${realm}directory`, 'Shop');
const guideRef = ref(`${realm}directory`, 'Guide');
const memoRef = ref(`${realm}directory`, 'Memo');
const cardInfoRef = ref(`${realm}directory`, 'Info');
const metricsRef = ref(`${realm}directory`, 'Metrics');
// The base card type as a saved query names it: by its URL.
const cardRef = ref('https://cardstack.com/base/card-api', 'CardDef');

const text = (search?: Record<string, unknown>) => ({
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: stringRef,
  ...(search ? { search } : {}),
});
const texts = (search?: Record<string, unknown>) => ({
  ...text(search),
  type: 'containsMany',
});
const number = {
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: numberRef,
  serializerName: 'number',
};
const compound = (of: ResolvedCodeRef) => ({
  type: 'contains',
  isPrimitive: false,
  isComputed: false,
  fieldOrCard: of,
});

// A shop listing: a title, prose, a list of tags, a maker's name (typo
// tolerant), a stock code and a list of shelf codes (both searched by
// pattern), and two dates.
const itemDef = {
  type: 'card-def',
  codeRef: itemRef,
  displayName: 'Item',
  fields: {
    title: 'title',
    blurb: 'blurb',
    tags: 'tags',
    maker: 'maker',
    sku: 'sku',
    codes: 'codes',
    kind: 'kind',
    price: 'price',
    listedAt: 'listedAt',
    shipsOn: 'shipsOn',
  },
  fieldDefs: {
    title: text({ role: 'title' }),
    blurb: text({ role: 'body' }),
    tags: texts(),
    maker: text({ role: 'name', typos: true }),
    sku: text({ role: 'identifier', patterns: true }),
    codes: texts({ role: 'identifier', patterns: true }),
    kind: text(),
    price: number,
    listedAt: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: datetimeRef,
      serializerName: 'datetime',
    },
    shipsOn: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: dateRef,
      serializerName: 'date',
    },
  },
} as unknown as Definition;

// The directory: several card types a search box suggests from at once. Each
// has a name (its title), a nickname, and a score kept under a compound field
// every card has, which is what the suggestions sort by.
const metricsDef = {
  type: 'field-def',
  codeRef: metricsRef,
  displayName: 'Metrics',
  fields: { score: 'score' },
  fieldDefs: { score: number },
} as unknown as Definition;
const cardInfoDef = {
  type: 'field-def',
  codeRef: cardInfoRef,
  displayName: 'Info',
  fields: { metrics: 'metrics' },
  fieldDefs: { metrics: compound(metricsRef) },
} as unknown as Definition;
const directoryDef = (codeRef: ResolvedCodeRef) =>
  ({
    type: 'card-def',
    codeRef,
    displayName: codeRef.name,
    fields: {
      name: 'name',
      nick: 'nick',
      retired: 'retired',
      cardInfo: 'cardInfo',
    },
    fieldDefs: {
      name: text({ role: 'title' }),
      nick: text(),
      retired: {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: booleanRef,
        serializerName: 'boolean',
      },
      cardInfo: compound(cardInfoRef),
    },
  }) as unknown as Definition;
const cardDefFor = (codeRef: ResolvedCodeRef) =>
  ({
    type: 'card-def',
    codeRef,
    displayName: 'Card',
    fields: { cardInfo: 'cardInfo' },
    fieldDefs: { cardInfo: compound(cardInfoRef) },
  }) as unknown as Definition;

const DEFINITIONS = [
  itemDef,
  metricsDef,
  cardInfoDef,
  cardDefFor(baseCardRef),
  cardDefFor(cardRef),
  ...[brandRef, shopRef, guideRef, memoRef].map(directoryDef),
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

// --- the listings -----------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Fixture times are reckoned from the clock, far from every boundary a test
// draws (hours from a six-hour line, weeks from a thirty-day one).
const ago = (ms: number) => new Date(Date.now() - ms);
// A date-time as the index holds it, zoneless, which a query reads as UTC.
const asDatetime = (d: Date) => d.toISOString().slice(0, 16);
const asDate = (d: Date) => d.toISOString().slice(0, 10);

interface Item {
  title?: string;
  blurb?: string;
  tags?: string[];
  maker?: string;
  sku?: string;
  codes?: string[];
  kind: string;
  price: number;
  listedAt?: string;
  shipsOn?: string;
}

const ITEMS: Record<string, Item> = {
  lamp: {
    title: 'Brass desk lamp',
    blurb: 'Warm light for reading late',
    tags: ['lighting', 'vintage'],
    maker: 'Halvorsen',
    sku: 'LMP-0001-BR',
    codes: ['A-100', 'B-200'],
    kind: 'home',
    price: 64,
    listedAt: asDatetime(ago(2 * HOUR)),
    shipsOn: asDate(ago(3 * DAY)),
  },
  lamps: {
    title: 'Lamps and shades',
    blurb: 'Linen shades sold in pairs',
    tags: ['lighting'],
    maker: 'Okonkwo',
    sku: 'LMP-0002-GL',
    codes: ['A-101'],
    kind: 'home',
    price: 48,
    listedAt: asDatetime(ago(3 * DAY)),
    shipsOn: asDate(ago(20 * DAY)),
  },
  floor: {
    title: 'Lamp for a standing desk',
    blurb: 'Clamps on without tools',
    tags: ['office'],
    maker: 'Okonkwo',
    sku: 'LMP-0003-ST',
    codes: [],
    kind: 'office',
    price: 90,
    listedAt: asDatetime(ago(20 * DAY)),
    shipsOn: asDate(ago(45 * DAY)),
  },
  knocker: {
    title: 'Brass door knocker',
    blurb: 'Cast by hand',
    tags: ['hardware'],
    maker: 'Halvorsen',
    sku: 'KNK-0007-BR',
    codes: ['C-300'],
    kind: 'home',
    price: 30,
    listedAt: asDatetime(ago(45 * DAY)),
    shipsOn: asDate(ago(400 * DAY)),
  },
  // "brass" only in its prose, never in its title
  hook: {
    title: 'Coat hook',
    blurb: 'Solid brass, sold singly',
    tags: ['hardware'],
    maker: 'Lindqvist',
    sku: 'HOK-0010-BR',
    codes: [],
    kind: 'home',
    price: 12,
    listedAt: asDatetime(ago(400 * DAY)),
  },
  shoes: {
    title: 'Trail running shoes',
    blurb: 'Grippy soles for wet rock',
    tags: ['footwear'],
    maker: 'Lindkvist',
    sku: 'SHO-0100-TR',
    codes: ['B-250'],
    kind: 'sport',
    price: 110,
    // listed for the day after tomorrow
    listedAt: asDatetime(ago(-2 * DAY)),
  },
  journal: {
    title: 'Morning runs journal',
    blurb: 'A page a day',
    tags: ['paper'],
    maker: 'Abernathy',
    sku: 'JRN-0001-PA',
    codes: [],
    kind: 'office',
    price: 18,
  },
  cafe: {
    title: 'Café table',
    blurb: 'Round, seats two',
    tags: ['furniture'],
    maker: 'Abernathy',
    sku: 'TBL-0042-CF',
    codes: [],
    kind: 'garden',
    price: 150,
  },
  torch: {
    title: 'Creme brulee torch',
    blurb: 'Refillable',
    tags: ['kitchen'],
    maker: 'Okonkwo',
    sku: 'TRC-0005-KT',
    codes: [],
    kind: 'kitchen',
    price: 25,
  },
  bench: {
    title: 'Garden bench',
    blurb: 'Teak slats',
    tags: ['furniture', 'outdoor'],
    maker: 'Halvorsen',
    sku: 'BNC-0001-TK',
    codes: [],
    kind: 'garden',
    price: 120,
  },
  theater: {
    title: 'Theater binoculars',
    blurb: 'Folding',
    tags: ['optics'],
    maker: 'Abernathy',
    sku: 'BIN-0001-FD',
    codes: [],
    kind: 'travel',
    price: 75,
  },
  planner: {
    title: 'Model 2024 planner',
    blurb: 'Week to a spread',
    tags: ['paper'],
    maker: 'Okonkwo',
    sku: 'PLN-2024-WK',
    codes: [],
    kind: 'office',
    price: 22,
  },
  poster: {
    title: '東京 タワー poster 🎉',
    blurb: 'Printed on heavy stock',
    tags: ['wall'],
    maker: 'Okonkwo',
    sku: 'PST-0001-TK',
    codes: [],
    kind: 'wall',
    price: 15,
  },
  // Stock codes that hold the characters a glob, a LIKE pattern or a regular
  // expression gives a meaning to, each beside a look-alike that differs only
  // where that character sits.
  pct: {
    title: 'Swatch one',
    sku: '100%-wool',
    codes: [],
    kind: 'odd',
    price: 1,
  },
  pctx: {
    title: 'Swatch two',
    sku: '100X-wool',
    codes: [],
    kind: 'odd',
    price: 1,
  },
  under: {
    title: 'Swatch three',
    sku: 'a_b%c\\d',
    codes: [],
    kind: 'odd',
    price: 1,
  },
  underx: {
    title: 'Swatch four',
    sku: 'aXb-plain',
    codes: [],
    kind: 'odd',
    price: 1,
  },
  bracket: {
    title: 'Swatch five',
    sku: '[x]y',
    codes: [],
    kind: 'odd',
    price: 1,
  },
  plain: { title: 'Swatch six', sku: 'xy', codes: [], kind: 'odd', price: 1 },
  // No text at all: no title, no rendered page, no stock code, no shelf codes.
  bare: { kind: 'misc', price: 1 },
};

const ALL = Object.keys(ITEMS).sort();
const except = (...names: string[]) => ALL.filter((n) => !names.includes(n));
const where = (keep: (item: Item) => boolean) =>
  ALL.filter((name) => keep(ITEMS[name]));

// What a render stamps for the Item declarations: title and maker at the top
// tier, the tags as plain text, the blurb as body text, the maker's words
// for the typo word list, and the stock and shelf codes as pattern values,
// one a line. The stock code has an identifier role, so it is in no tier.
function itemSearchText(item: Item): SearchText | undefined {
  let groups: SearchText = {};
  let top = [item.title, item.maker].filter(Boolean).join('\n');
  if (top) groups.A = top;
  if (item.tags?.length) groups.C = item.tags.join('\n');
  if (item.blurb) groups.D = item.blurb;
  if (item.maker) groups.typos = item.maker;
  let patterns = [item.sku, ...(item.codes ?? [])].filter(Boolean).join('\n');
  if (patterns) groups.patterns = patterns;
  return Object.keys(groups).length ? groups : undefined;
}

// --- the directory ----------------------------------------------------------

interface Entry {
  type: ResolvedCodeRef;
  name?: string;
  nick?: string;
  retired?: boolean;
  score?: number;
}

const ENTRIES: Record<string, Entry> = {
  lampworks: {
    type: brandRef,
    name: 'Lampworks Studio',
    nick: 'glassware',
    score: 50,
  },
  lamport: {
    type: brandRef,
    name: 'Lamport & Sons',
    nick: 'ironmongers',
    score: 80,
  },
  // "lam" only inside a longer word of its name
  clamp: { type: brandRef, name: 'Clamp Co', nick: 'bench vises', score: 99 },
  // "lam" nowhere in its name, inside a word of its nickname
  forge: {
    type: brandRef,
    name: 'Forge & Flint',
    nick: 'the clam shack',
    score: 10,
  },
  lumiere: {
    type: brandRef,
    name: 'Café Lumière',
    nick: 'bistro',
    score: 40,
  },
  // a brand with no name: no title, so nothing to suggest it by
  nameless: { type: brandRef, nick: 'lamé fabrics', score: 100 },
  lamplight: {
    type: shopRef,
    name: 'The Lamplight Café',
    retired: false,
    score: 70,
  },
  nine: { type: shopRef, name: 'Studio Nine', retired: false, score: 65 },
  // a closed shop: the suggestions leave it out
  closed: { type: shopRef, name: 'Old Lamp Shop', retired: true, score: 95 },
  choosing: { type: guideRef, name: 'Choosing lamps', score: 60 },
  // a guide nobody has scored yet
  care: { type: guideRef, name: 'Lamp care' },
  // a type the search box does not suggest from
  memo: { type: memoRef, name: 'Lamp memo', score: 100 },
};

const urlOf = (type: ResolvedCodeRef, name: string) =>
  `${realm}${type.name}/${name}.json`;

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let engine: IndexQueryEngine;

  setupDB(hooks, {
    before: async (dbAdapter) => {
      adapter = dbAdapter;
      let vn = new VirtualNetwork();
      engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
      let cardKey = internalKeyFor(cardRef, undefined, vn);
      let batch = await new IndexWriter(dbAdapter).createBatch(
        new URL(realm),
        vn,
        undefined,
        { splitPrerenderHtml: false },
      );
      let write = async (
        type: ResolvedCodeRef,
        name: string,
        searchData: Record<string, unknown>,
        markdown: string | undefined,
      ) => {
        let cardURL = new URL(urlOf(type, name));
        await batch.updateEntry(cardURL, {
          type: 'instance',
          resource: {
            id: rri(cardURL.href),
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: { module: rri(type.module), name: type.name },
            },
          },
          lastModified: Date.now(),
          resourceCreatedAt: Date.now(),
          searchData,
          ...(markdown ? { markdown } : {}),
          deps: new Set(),
          displayNames: [type.name],
          types: [internalKeyFor(type, undefined, vn), cardKey],
          isolatedHtml: `<div>${name}</div>`,
        });
      };
      for (let [name, item] of Object.entries(ITEMS)) {
        let searchText = itemSearchText(item);
        await write(
          itemRef,
          name,
          {
            ...item,
            ...(searchText ? { [SEARCH_TEXT_KEY]: searchText } : {}),
            // type-ahead reads the card's title
            ...(item.title ? { _typeahead: item.title } : {}),
          },
          // the page shows the title and the blurb, not the tags
          item.title
            ? `# ${item.title}\n\n${item.blurb ?? ''}`.trim()
            : undefined,
        );
      }
      for (let [name, entry] of Object.entries(ENTRIES)) {
        let { type, score, ...fields } = entry;
        await write(
          type,
          name,
          {
            ...fields,
            ...(score === undefined
              ? {}
              : { cardInfo: { metrics: { score } } }),
            ...(entry.name
              ? {
                  [SEARCH_TEXT_KEY]: { A: entry.name },
                  _typeahead: entry.name,
                }
              : {}),
          },
          entry.name ? `# ${entry.name}` : undefined,
        );
      }
      await batch.done();
    },
  });

  const on = itemRef;
  const realmURL = new URL(realm);

  async function names(query: Record<string, any>): Promise<string[]> {
    let { cards } = await engine.searchCards(realmURL, query as Query);
    return cards.map((card) =>
      String(card.id)
        .split('/')
        .pop()!
        .replace(/\.json$/, ''),
    );
  }

  // A saved filter with its anchors taken off, for the newer spelling.
  function unanchored(node: any): any {
    if (node == null || typeof node !== 'object' || Array.isArray(node)) {
      return node;
    }
    let out: Record<string, any> = {};
    for (let [key, value] of Object.entries(node)) {
      if (key === 'on') continue;
      if (key === 'every' || key === 'any') {
        out[key] = (value as any[]).map(unanchored);
      } else if (key === 'not') {
        out[key] = unanchored(value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  const overTheWire = (payload: unknown) =>
    parseSearchEntryQueryFromPayload(JSON.parse(JSON.stringify(payload)))
      .itemQuery;

  // Every spelling of a query on Item, as the query the engine is handed.
  // `typed` is the newer spelling when taking the anchors off is not it.
  function forms(
    saved: Record<string, any>,
    typed?: Record<string, any> | false,
  ): [string, Record<string, any>][] {
    let out: [string, Record<string, any>][] = [
      ['as saved', saved],
      ['over the wire', overTheWire(searchEntryWireQueryFromQuery(saved))],
    ];
    if (typed === false) {
      return out;
    }
    let newer = typed ?? {
      type: itemRef,
      ...(saved.filter ? { filter: unanchored(saved.filter) } : {}),
      ...(saved.sort
        ? { sort: saved.sort.map(({ on: _on, ...rest }: any) => rest) }
        : {}),
      ...(saved.page ? { page: saved.page } : {}),
    };
    out.push(['newer spelling', lowerQuery(newer).query]);
    out.push(['newer spelling over the wire', overTheWire(newer)]);
    return out;
  }

  // The rows a filter keeps, in every spelling, as a set.
  async function keeps(
    assert: Assert,
    filter: Record<string, any>,
    expected: string[],
    why: string,
  ) {
    for (let [form, query] of forms({ filter })) {
      assert.deepEqual(
        (await names(query)).sort(),
        [...expected].sort(),
        `${why} (${form})`,
      );
    }
  }

  // The rows a query returns, in every spelling, in order.
  async function returns(
    assert: Assert,
    saved: Record<string, any>,
    expected: string[],
    why: string,
    typed?: Record<string, any> | false,
  ) {
    for (let [form, query] of forms(saved, typed)) {
      assert.deepEqual(await names(query), expected, `${why} (${form})`);
    }
  }

  // The error a search ends in, if it does.
  async function failure(query: Record<string, any>): Promise<unknown> {
    try {
      await engine.searchCards(realmURL, query as Query);
    } catch (e) {
      return e;
    }
    return undefined;
  }

  const matches = (term: string, more: Record<string, any> = {}) => ({
    on,
    matches: term,
    ...more,
  });

  const LAMPS = ['floor', 'lamp', 'lamps'];
  const BRASS = ['hook', 'knocker', 'lamp'];
  const HALVORSEN = ['bench', 'knocker', 'lamp'];

  test('the fixture is in the index', async function (assert) {
    assert.deepEqual((await names({ filter: { type: on } })).sort(), ALL);
    let words = (
      (await adapter.execute(
        `SELECT word FROM boxel_index_words WHERE realm_url = $1`,
        { bind: [realm] },
      )) as { word: string }[]
    ).map((r) => r.word);
    for (let word of ['halvorsen', 'lindqvist', 'lamp', 'knocker', '2024']) {
      assert.true(words.includes(word), `the word list holds "${word}"`);
    }
  });

  // ---- matches ------------------------------------------------------------

  test('matches: a word finds its singular, its plural and its -ing form', async function (assert) {
    // Words are stemmed in English: lamp and lamps share a stem, as do run,
    // runs and running, and shade and shades.
    for (let term of ['lamp', 'lamps']) {
      await keeps(assert, matches(term), LAMPS, `"${term}"`);
    }
    for (let term of ['run', 'runs', 'running']) {
      await keeps(assert, matches(term), ['journal', 'shoes'], `"${term}"`);
    }
    for (let term of ['shade', 'shades']) {
      await keeps(assert, matches(term), ['lamps'], `"${term}"`);
    }
    for (let term of ['read', 'reading']) {
      await keeps(assert, matches(term), ['lamp'], `"${term}"`);
    }
  });

  test('matches: case and accents fold, in the term and in the card', async function (assert) {
    // "Accents fold everywhere words are matched": the card says Café and
    // the term says cafe, or the card says Creme and the term says crème.
    for (let term of ['cafe', 'café', 'CAFE', 'CAFÉ', 'Café']) {
      await keeps(assert, matches(term), ['cafe'], `"${term}"`);
    }
    for (let term of ['creme brulee', 'crème brûlée', 'CRÈME BRÛLÉE']) {
      await keeps(assert, matches(term), ['torch'], `"${term}"`);
    }
    await keeps(assert, matches('LAMP'), LAMPS, 'upper case');
    await keeps(assert, matches('bRaSs'), BRASS, 'mixed case');
  });

  test('matches: several words must all be there, in any order', async function (assert) {
    // websearch syntax: bare words are ANDed.
    await keeps(assert, matches('brass lamp'), ['lamp'], 'both words');
    await keeps(assert, matches('lamp brass'), ['lamp'], 'either order');
    await keeps(
      assert,
      matches('desk lamp'),
      ['floor', 'lamp'],
      'the words need not be adjacent',
    );
    await keeps(
      assert,
      matches('brass lamp zeppelin'),
      [],
      'one word no card holds leaves nothing',
    );
    // A word in the title and a word in the prose still add up to the card.
    await keeps(assert, matches('hook singly'), ['hook'], 'across fields');
  });

  test('matches: "or" between words takes either', async function (assert) {
    await keeps(
      assert,
      matches('brass or lamp'),
      [...new Set([...BRASS, ...LAMPS])],
      'brass or lamp',
    );
    await keeps(
      assert,
      matches('knocker or zeppelin'),
      ['knocker'],
      'an unknown alternative adds nothing',
    );
  });

  test('matches: a quoted phrase needs its words side by side, in order', async function (assert) {
    await keeps(assert, matches('"desk lamp"'), ['lamp'], 'adjacent');
    await keeps(assert, matches('"lamp desk"'), [], 'the other order');
    await keeps(
      assert,
      matches('"door knocker" brass'),
      ['knocker'],
      'a phrase beside a word',
    );
  });

  test('matches: a word after a dash is excluded', async function (assert) {
    await keeps(assert, matches('lamp -brass'), ['floor', 'lamps'], 'lamp');
    await keeps(
      assert,
      matches('brass -"desk lamp"'),
      ['hook', 'knocker'],
      'an excluded phrase',
    );
    await keeps(
      assert,
      matches('lamp -lamp'),
      [],
      'a word and its own exclusion',
    );
    // An exclusion on its own keeps every card with text that lacks the word.
    await keeps(
      assert,
      matches('-lamp'),
      where((item) => Boolean(item.title)).filter((n) => !LAMPS.includes(n)),
      'an exclusion alone',
    );
  });

  test('matches: an excluded word counts wherever the card holds it', async function (assert) {
    // "A card matches by its rendered markdown or by its fields' words, so
    // a field the card doesn't render still matches": the lamp's tags hold
    // "vintage" though its page does not show them, and `matches: 'vintage'`
    // finds it (see the list-field test). Excluding that word must then
    // leave the lamp out.
    await keeps(
      assert,
      matches('lamp -vintage'),
      ['floor', 'lamps'],
      'the excluded word is only in an unrendered field',
    );
  });

  test('matches: a dash on its own', async function (assert) {
    await keeps(assert, matches('lamp -'), LAMPS, 'a trailing dash');
    // pins current behavior; rule not yet decided: the docs give `-excluded`,
    // a dash against its word. A dash set off by a space still excludes the
    // word after it, as the Postgres syntax the docs name reads it.
    await keeps(
      assert,
      matches('- lamp'),
      where((item) => Boolean(item.title)).filter((n) => !LAMPS.includes(n)),
      'a dash, a space, a word',
    );
    await keeps(
      assert,
      matches('lamp - brass'),
      ['floor', 'lamps'],
      'a dash between two words',
    );
    // A term with no word in it matches nothing.
    await keeps(assert, matches('-'), [], 'a dash alone');
    await keeps(assert, matches('--'), [], 'two dashes');
  });

  test('matches: punctuation in a term is not syntax, and never an error', async function (assert) {
    // Only quotes, `or` and a leading dash mean anything; every other mark
    // separates words. So a mark beside a word leaves the word, a mark
    // between two words leaves both required, and a mark alone is a term
    // with no word in it, which matches nothing.
    for (let mark of ["'", '"', '\\', '%', ':', '&', '|', '!', '(', ')', '*']) {
      await keeps(assert, matches(`lamp${mark}`), LAMPS, `lamp${mark}`);
      await keeps(assert, matches(`${mark}lamp`), LAMPS, `${mark}lamp`);
      await keeps(
        assert,
        matches(`lamp ${mark} brass`),
        ['lamp'],
        `lamp ${mark} brass`,
      );
      await keeps(assert, matches(mark), [], `${mark} alone`);
    }
    await keeps(assert, matches('(lamp)'), LAMPS, 'parentheses');
    await keeps(assert, matches("lamp's"), LAMPS, 'a possessive');
    await keeps(assert, matches('lamp & (brass | door)'), [], 'not a formula');
    await keeps(
      assert,
      matches(`'; DROP TABLE boxel_index; --`),
      [],
      'a statement in a term is words',
    );
  });

  test('matches: * and % are not wildcards', async function (assert) {
    // A word matches whole (by its stem) unless `prefix` says otherwise.
    await keeps(assert, matches('lam*'), [], 'lam*');
    await keeps(assert, matches('lam%'), [], 'lam%');
    await keeps(assert, matches('l_mp'), [], 'l_mp');
    await keeps(assert, matches('lam'), [], 'a bare fragment');
  });

  test('matches: an empty or blank term matches nothing', async function (assert) {
    // "A `matches` term with no word in it matches nothing."
    for (let term of ['', ' ', '   ', '\t\n']) {
      await keeps(assert, matches(term), [], JSON.stringify(term));
    }
  });

  test('matches: a term of stop words and single characters matches nothing', async function (assert) {
    for (let term of ['the', 'the ', 'the of', 'a', 'x y', '2', 'THE']) {
      await keeps(assert, matches(term), [], JSON.stringify(term));
    }
    // "Beside a real word, a stop word is dropped."
    await keeps(assert, matches('the brass'), BRASS, 'the brass');
    await keeps(assert, matches('brass the'), BRASS, 'brass the');
    // "A single letter beside a real word stays part of the query", and no
    // card holds the word "q".
    await keeps(assert, matches('q brass'), [], 'q brass');
  });

  test('matches: a stop word still being typed', async function (assert) {
    // A term ending in a space has no unfinished word, so "the " is a stop
    // word and nothing else.
    await keeps(
      assert,
      matches('the ', { prefix: true }),
      [],
      'finished, a stop word',
    );
    // pins current behavior; rule not yet decided: the docs say both that a
    // term made only of stop words matches no card, and that with `prefix`
    // the last word matches any word that starts with it ("the" starts
    // "Theater"). The first rule wins today.
    await keeps(
      assert,
      matches('the', { prefix: true }),
      [],
      'unfinished, and it could be the start of "theater"',
    );
    await keeps(
      assert,
      matches('thea', { prefix: true }),
      ['theater'],
      'one more letter and it is no stop word',
    );
  });

  test('matches: a very long term is a search, not an error', async function (assert) {
    await keeps(assert, matches('z'.repeat(3000)), [], 'one 3,000-letter word');
    await keeps(
      assert,
      matches(Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ')),
      [],
      '300 words no card holds',
    );
    await keeps(
      assert,
      matches(`lamp ${'brass '.repeat(200)}`),
      ['lamp'],
      'a word repeated 200 times',
    );
  });

  test('matches: emoji and numbers', async function (assert) {
    // An emoji is not a letter or a digit, so alone it is a term with no
    // word in it.
    await keeps(assert, matches('🎉'), [], 'an emoji alone');
    await keeps(assert, matches('poster 🎉'), ['poster'], 'beside a word');
    // A number of two digits or more is a word.
    await keeps(assert, matches('2024'), ['planner'], 'a year');
    await keeps(assert, matches('model 2024'), ['planner'], 'a word, a year');
    await keeps(assert, matches('2023'), [], 'another year');
  });

  test('matches: text in a script without spaces between words', async function (assert) {
    // pins current behavior; rule not yet decided: the docs describe English
    // stemming and say nothing of scripts the English configuration does not
    // segment. A run of such characters set off by spaces is matched as one
    // word.
    await keeps(assert, matches('東京'), ['poster'], 'a whole run');
    await keeps(assert, matches('タワー'), ['poster'], 'another run');
    await keeps(assert, matches('東京 タワー'), ['poster'], 'both runs');
    await keeps(assert, matches('京'), [], 'one character is no word');
  });

  test("matches: a word found only in a list field's values", async function (assert) {
    // The tags are not on the page; the card's field words hold them.
    await keeps(assert, matches('vintage'), ['lamp'], 'a first value');
    await keeps(assert, matches('outdoor'), ['bench'], 'a later value');
    await keeps(assert, matches('furniture'), ['bench', 'cafe'], 'two cards');
    await keeps(
      assert,
      matches('brass vintage'),
      ['lamp'],
      'a title word and a tag',
    );
  });

  test("matches with fields: only those fields' values count", async function (assert) {
    let within = (term: string, fields: string[]) => matches(term, { fields });
    await keeps(
      assert,
      within('brass', ['title']),
      ['knocker', 'lamp'],
      'the hook says brass only in its blurb',
    );
    await keeps(assert, within('brass', ['blurb']), ['hook'], 'the blurb');
    await keeps(assert, within('brass', ['title', 'blurb']), BRASS, 'either');
    await keeps(assert, within('vintage', ['title']), [], 'a tag is no title');
    // "The same stemmed, case-insensitive word match", accents folded as
    // everywhere.
    await keeps(assert, within('LAMPS', ['title']), LAMPS, 'stem and case');
    await keeps(assert, within('cafe', ['title']), ['cafe'], 'accents');
    // "A list field's values all count."
    await keeps(assert, within('vintage', ['tags']), ['lamp'], 'a tag');
    await keeps(assert, within('outdoor', ['tags']), ['bench'], 'a later tag');
    await keeps(
      assert,
      within('furniture', ['tags']),
      ['bench', 'cafe'],
      'a tag two cards share',
    );
    await keeps(
      assert,
      within('brass lighting', ['title', 'tags']),
      ['lamp'],
      'a word from each field',
    );
    await keeps(
      assert,
      within('brass -lamp', ['title']),
      ['knocker'],
      'an exclusion reads the same fields',
    );
    await keeps(
      assert,
      within('"door knocker"', ['title']),
      ['knocker'],
      'a phrase',
    );
    await keeps(assert, within('the', ['title']), [], 'a stop word');
  });

  test('matches with fields: a field the type does not have', async function (assert) {
    // pins current behavior; rule not yet decided: a `fields` path the type
    // lacks is not refused (a filter or a sort on one is, `unknown-field`);
    // it has no values, so nothing matches.
    await keeps(assert, matches('brass', { fields: ['nope'] }), [], 'no field');
    await keeps(
      assert,
      matches('brass', { fields: ['nope', 'title'] }),
      ['knocker', 'lamp'],
      'beside a real one',
    );
  });

  test("matches with scope 'title': title, name and alias words only", async function (assert) {
    let titled = (term: string) => matches(term, { scope: 'title' });
    await keeps(assert, titled('brass'), ['knocker', 'lamp'], 'a title word');
    await keeps(assert, titled('singly'), [], 'a blurb word');
    await keeps(assert, titled('vintage'), [], 'a tag');
    // The maker has the name role, which the title scope reads.
    await keeps(assert, titled('halvorsen'), HALVORSEN, 'a name');
    await keeps(assert, titled('LAMPS'), LAMPS, 'stem and case');
    await keeps(assert, titled('cafe'), ['cafe'], 'accents');
    await keeps(assert, titled('brass halvorsen'), ['knocker', 'lamp'], 'both');
  });

  // ---- not, any -----------------------------------------------------------

  test('not over matches is every other card', async function (assert) {
    // A card with no text does not hold the word either.
    await keeps(
      assert,
      { on, not: { matches: 'lamp' } },
      except(...LAMPS),
      'not lamp',
    );
    await keeps(
      assert,
      {
        on,
        every: [
          { on, not: { matches: 'brass' } },
          { on, eq: { kind: 'home' } },
        ],
      },
      ['lamps'],
      'home, not brass',
    );
    await keeps(
      assert,
      { on, not: { matches: 'lamp -brass' } },
      except('floor', 'lamps'),
      'not (lamp without brass)',
    );
    await keeps(
      assert,
      { on, not: { matches: 'brass', fields: ['title'] } },
      except('knocker', 'lamp'),
      'not brass in the title',
    );
  });

  test('matches inside any, beside a structured filter', async function (assert) {
    await keeps(
      assert,
      { any: [matches('lamp'), { on, eq: { kind: 'garden' } }] },
      [...LAMPS, 'bench', 'cafe'],
      'lamp, or in the garden',
    );
    await keeps(
      assert,
      { any: [matches('lamp'), { on, range: { price: { gte: 110 } } }] },
      [...LAMPS, 'bench', 'cafe', 'shoes'],
      'lamp, or 110 and up',
    );
    await keeps(
      assert,
      {
        on,
        every: [
          { any: [matches('lamp'), matches('brass')] },
          { on, not: { eq: { kind: 'home' } } },
        ],
      },
      ['floor'],
      'lamp or brass, away from home',
    );
    await keeps(
      assert,
      { any: [matches('zeppelin'), { on, eq: { kind: 'travel' } }] },
      ['theater'],
      'a branch that finds nothing',
    );
  });

  // ---- typos --------------------------------------------------------------

  const typo = (term: string) => matches(term, { typos: true });

  test('typos: a word one edit away matches, and only with the flag', async function (assert) {
    await keeps(assert, matches('halvorsn'), [], 'without the flag');
    // eight letters typed: two edits allowed, one needed
    await keeps(assert, typo('halvorsn'), HALVORSEN, 'a letter dropped');
    await keeps(
      assert,
      typo('abernthy'),
      ['cafe', 'journal', 'theater'],
      'another maker',
    );
    // six letters typed: one edit allowed, one needed
    await keeps(assert, typo('knockr'), ['knocker'], 'a title word');
    // "a swapped pair of letters is one edit"
    await keeps(assert, typo('knokcer'), ['knocker'], 'a swap');
    await keeps(assert, typo('halvorsen'), HALVORSEN, 'spelled right');
  });

  test('typos: the edit budget follows the length of the word typed', async function (assert) {
    // "None under four letters, one edit up to seven, two from eight."
    await keeps(assert, typo('lmp'), [], 'three letters: none');
    await keeps(assert, typo('lamb'), LAMPS, 'four letters: one (lamp)');
    await keeps(
      assert,
      typo('halvosn'),
      [],
      'seven letters, two edits from halvorsen: over budget',
    );
    await keeps(
      assert,
      typo('hallvorsenn'),
      HALVORSEN,
      'eleven letters, two edits: within budget',
    );
    await keeps(
      assert,
      typo('hallvorssenn'),
      [],
      'twelve letters, three edits: over budget',
    );
    await keeps(assert, typo('xyzzyq'), [], 'nothing close');
  });

  test('typos: a word the realm holds is matched as typed', async function (assert) {
    // Two makers one letter apart. Typed exactly, each finds only its own.
    await keeps(assert, typo('lindqvist'), ['hook'], 'one maker');
    await keeps(assert, typo('lindkvist'), ['shoes'], 'the other');
    // A misspelling one edit from both finds both.
    await keeps(assert, typo('lindvist'), ['hook', 'shoes'], 'near both');
  });

  test('typos: every word must still match', async function (assert) {
    await keeps(assert, typo('halvorsn knockr'), ['knocker'], 'both misspelt');
    await keeps(assert, typo('halvorsn brass'), ['knocker', 'lamp'], 'one');
    await keeps(assert, typo('halvorsn zeppelin'), [], 'one has no match');
  });

  test('typos: a typo in the first letter', async function (assert) {
    // pins current behavior; rule not yet decided: the docs give a budget by
    // length and say nothing of where in the word the edit is. A first
    // letter is corrected like any other.
    await keeps(assert, typo('xalvorsen'), HALVORSEN, 'a wrong first letter');
    await keeps(assert, typo('alvorsen'), HALVORSEN, 'a dropped first letter');
  });

  test('typos: numbers', async function (assert) {
    // pins current behavior; rule not yet decided: a number is a word of
    // the word list like any other, so a year one digit off is corrected to
    // the year a title holds.
    await keeps(assert, typo('2025'), ['planner'], 'one digit off');
    await keeps(assert, typo('2024'), ['planner'], 'the year itself');
  });

  test('typos keeps the syntax of the term', async function (assert) {
    // `typos` widens words; the docs give it no other effect, so an
    // exclusion, a phrase and an `or` mean what they mean without it.
    await keeps(
      assert,
      typo('halvorsn -brass'),
      ['bench'],
      'an excluded word stays excluded',
    );
    await keeps(
      assert,
      typo('knockr or bench'),
      ['bench', 'knocker'],
      'or stays or',
    );
    await keeps(
      assert,
      typo('"desk lamp"'),
      ['lamp'],
      'a phrase stays a phrase',
    );
  });

  test('typos with a structured filter', async function (assert) {
    await keeps(
      assert,
      { on, every: [typo('halvorsn'), { on, eq: { kind: 'home' } }] },
      ['knocker', 'lamp'],
      'the maker, at home',
    );
    await keeps(
      assert,
      { on, every: [typo('halvorsn'), { on, range: { price: { gt: 100 } } }] },
      ['bench'],
      'the maker, over 100',
    );
    await keeps(
      assert,
      { any: [typo('knockr'), { on, eq: { kind: 'travel' } }] },
      ['knocker', 'theater'],
      'inside any',
    );
    await keeps(
      assert,
      {
        on,
        every: [
          { on, eq: { kind: 'home' } },
          { on, not: typo('halvorsn') },
        ],
      },
      ['hook', 'lamps'],
      'under not',
    );
  });

  test('typos with a sort and pages: the order is the sort', async function (assert) {
    // The three Halvorsen listings cost 30, 64 and 120. The docs define no
    // order among corrected matches, so the query asks for one.
    let sort = [{ on, by: 'price', direction: 'asc' }];
    let filter = typo('halvorsn');
    await returns(
      assert,
      { filter, sort },
      ['knocker', 'lamp', 'bench'],
      'cheapest first',
    );
    await returns(
      assert,
      { filter, sort, page: { size: 2, number: 0 } },
      ['knocker', 'lamp'],
      'the first page of two',
    );
    await returns(
      assert,
      { filter, sort, page: { size: 2, number: 1 } },
      ['bench'],
      'the second page',
    );
    await returns(
      assert,
      { filter, sort, page: { size: 2, number: 2 } },
      [],
      'a page past the end',
    );
    await returns(
      assert,
      {
        filter,
        sort: [{ on, by: 'price', direction: 'desc' }],
        page: { size: 1 },
      },
      ['bench'],
      'dearest first, one row',
    );
    for (let [form, query] of forms({ filter, sort, page: { size: 2 } })) {
      let { meta } = await engine.searchCards(realmURL, query as Query);
      assert.strictEqual(meta.page.total, 3, `the total counts all (${form})`);
    }
  });

  // ---- type-ahead ---------------------------------------------------------

  const typing = (term: string) => matches(term, { prefix: true });

  test('prefix: the last word matches as the start of a word', async function (assert) {
    await keeps(assert, typing('bra'), BRASS, 'the start of brass');
    await keeps(assert, typing('lam'), LAMPS, 'the start of lamp');
    await keeps(assert, typing('knock'), ['knocker'], 'most of a word');
    // "Every earlier word still has to match whole."
    await keeps(assert, typing('desk la'), ['floor', 'lamp'], 'desk, then la');
    await keeps(assert, typing('des lamp'), [], 'an earlier word cut short');
    // "A query that ends in a space has no unfinished word."
    await keeps(assert, typing('bra '), [], 'a finished fragment');
    await keeps(assert, typing('brass '), BRASS, 'a finished word');
  });

  test('prefix: a fragment from the middle of a word does not match', async function (assert) {
    await keeps(assert, typing('ras'), [], 'the middle of brass');
    await keeps(assert, typing('amp'), [], 'the end of lamp');
    await keeps(assert, typing('desk amp'), [], 'after a whole word');
  });

  test('prefix: case and accents fold in the word being typed', async function (assert) {
    await keeps(assert, typing('BRA'), BRASS, 'upper case');
    for (let term of ['caf', 'café', 'CAF', 'cafe']) {
      await keeps(assert, typing(term), ['cafe'], `"${term}"`);
    }
    for (let term of ['cre', 'crè', 'brul', 'brû']) {
      await keeps(assert, typing(term), ['torch'], `"${term}"`);
    }
  });

  test('prefix: a word shorter than three letters matches whole', async function (assert) {
    // "An unfinished word shorter than three letters matches as a whole
    // word." No card holds the word "la" or "br".
    await keeps(assert, typing('la'), [], 'two letters');
    await keeps(assert, typing('b'), [], 'one letter');
  });

  test('prefix with a structured filter', async function (assert) {
    await keeps(
      assert,
      { on, every: [typing('lam'), { on, eq: { kind: 'home' } }] },
      ['lamp', 'lamps'],
      'at home',
    );
    await keeps(
      assert,
      { any: [typing('knock'), { on, eq: { kind: 'travel' } }] },
      ['knocker', 'theater'],
      'inside any',
    );
    await keeps(
      assert,
      {
        on,
        every: [
          { on, eq: { kind: 'home' } },
          { on, not: typing('bra') },
        ],
      },
      ['lamps'],
      'under not',
    );
  });

  const suggest = (term: string, more: Record<string, any> = {}) => ({
    on,
    prefix: true,
    scope: 'title',
    matches: term,
    ...more,
  });

  test('type-ahead: every word starts a word of the title, in any order', async function (assert) {
    await keeps(assert, suggest('lam'), LAMPS, 'one word');
    await keeps(assert, suggest('desk lam'), ['floor', 'lamp'], 'two words');
    await keeps(assert, suggest('lam des'), ['floor', 'lamp'], 'either order');
    await keeps(assert, suggest('bra kno'), ['knocker'], 'both cut short');
    await keeps(assert, suggest('lam zep'), [], 'one word starts nothing');
    // The title only: not the blurb, not the tags.
    await keeps(assert, suggest('solid'), [], 'a blurb word');
    await keeps(assert, suggest('vintage'), [], 'a tag');
    // "Never stemmed": the letters typed must start the word as written.
    await keeps(assert, suggest('lamps'), ['lamps'], 'the plural as written');
  });

  test('type-ahead: mid-word fragments, case and accents', async function (assert) {
    await keeps(assert, suggest('amp'), [], 'the end of lamp');
    await keeps(assert, suggest('nocker'), [], 'knocker less its first letter');
    await keeps(assert, suggest('LAM'), LAMPS, 'upper case');
    for (let term of ['caf', 'cafe', 'café', 'CAFÉ']) {
      await keeps(assert, suggest(term), ['cafe'], `"${term}"`);
    }
    for (let term of ['brule', 'brûl', 'crème bru']) {
      await keeps(assert, suggest(term), ['torch'], `"${term}"`);
    }
  });

  test('type-ahead with a structured filter', async function (assert) {
    await keeps(
      assert,
      { on, every: [suggest('lam'), { on, eq: { kind: 'office' } }] },
      ['floor'],
      'in the office',
    );
    await keeps(
      assert,
      { on, every: [suggest('lam'), { on, range: { price: { lt: 60 } } }] },
      ['lamps'],
      'under 60',
    );
    await keeps(
      assert,
      {
        on,
        every: [
          { on, eq: { kind: 'home' } },
          { on, not: suggest('lam') },
        ],
      },
      ['hook', 'knocker'],
      'under not',
    );
  });

  // The three shapes below are what a search box and a chip picker send
  // while someone types, distilled.

  test('type-ahead or a substring of another field, sorted by a field, one large page', async function (assert) {
    // A picker over one type: suggest by the name being typed, or by a
    // nickname that contains the text, alphabetically by name, 120 at once.
    let picker = (typed: string) => ({
      filter: {
        every: [
          { type: brandRef },
          {
            any: [
              { prefix: true, scope: 'title', matches: typed },
              { on: brandRef, contains: { nick: typed } },
            ],
          },
        ],
      },
      sort: [{ on: brandRef, by: 'name', direction: 'asc' }],
      page: { size: 120 },
    });
    let newer = (typed: string) => ({
      type: brandRef,
      filter: {
        any: [
          { prefix: true, scope: 'title', matches: typed },
          { contains: { nick: typed } },
        ],
      },
      sort: [{ by: 'name', direction: 'asc' }],
      page: { size: 120 },
    });
    // "lam" starts a word of two brand names (Lamport, Lampworks) and sits
    // inside two nicknames ("the clam shack", "lamé fabrics"). It is inside
    // "Clamp", which starts no word with it. By name: Forge & Flint, Lamport
    // & Sons, Lampworks Studio, then the brand with no name (a missing value
    // sorts last). The shops, guides and memos that also start with "lam"
    // are other types.
    await returns(
      assert,
      picker('lam'),
      ['forge', 'lamport', 'lampworks', 'nameless'],
      '"lam"',
      newer('lam'),
    );
    // Two letters typed: the type-ahead matches only the whole word "la"
    // (no name has it), and the substring is in "glassware", "the clam
    // shack" and "lamé fabrics".
    await returns(
      assert,
      picker('la'),
      ['forge', 'lampworks', 'nameless'],
      '"la"',
      newer('la'),
    );
    // Accents fold in the type-ahead: Café Lumière, by either spelling.
    await returns(
      assert,
      picker('lumie'),
      ['lumiere'],
      '"lumie"',
      newer('lumie'),
    );
    await returns(
      assert,
      picker('café lum'),
      ['lumiere'],
      '"café lum"',
      newer('café lum'),
    );
    await returns(assert, picker('zep'), [], 'nothing', newer('zep'));
  });

  test('type-ahead over several types, less some cards of one type, sorted by a nested number on the base type', async function (assert) {
    // A search box suggests brands, shops and guides, never a closed shop,
    // highest score first. The score is three levels down a field every
    // card has, so the sort is anchored on the base card type.
    let box = (typed: string, more: Record<string, any> = {}) => ({
      filter: {
        every: [
          { any: [{ type: brandRef }, { type: shopRef }, { type: guideRef }] },
          { not: { on: shopRef, eq: { retired: true } } },
          { prefix: true, scope: 'title', matches: typed, ...more },
        ],
      },
      sort: [{ on: cardRef, by: 'cardInfo.metrics.score', direction: 'desc' }],
      page: { size: 30 },
    });
    // "lam" starts a word of: Lamport & Sons (80), The Lamplight Café (70),
    // Choosing lamps (60), Lampworks Studio (50) and Lamp care (no score,
    // so last). Left out: Old Lamp Shop (closed), Lamp memo (a type not
    // asked for), Clamp Co (mid-word), and the brand with no name.
    let lam = ['lamport', 'lamplight', 'choosing', 'lampworks', 'care'];
    await returns(assert, box('lam'), lam, '"lam"', false);
    await returns(assert, box('LAM'), lam, 'upper case', false);
    await returns(assert, box('amp'), [], 'a mid-word fragment', false);
    // The last word is a prefix, and so is every other.
    await returns(
      assert,
      box('lamplight ca'),
      ['lamplight'],
      'two words',
      false,
    );
    await returns(assert, box('stud'), ['nine', 'lampworks'], '"stud"', false);
    // Accents: Café in a shop's name (70) and a brand's (40).
    for (let typed of ['cafe', 'café', 'CAF']) {
      await returns(assert, box(typed), ['lamplight', 'lumiere'], typed, false);
    }
    // "old la" is the closed shop alone.
    await returns(assert, box('old la'), [], 'only a closed shop', false);
    await returns(
      assert,
      {
        ...box('lam'),
        sort: [{ on: cardRef, by: 'cardInfo.metrics.score', direction: 'asc' }],
      },
      ['lampworks', 'choosing', 'lamplight', 'lamport', 'care'],
      'lowest score first; no score still last',
      false,
    );
    await returns(
      assert,
      { ...box('lam'), page: { size: 2, number: 1 } },
      ['choosing', 'lampworks'],
      'the second page of two',
      false,
    );
  });

  test('type-ahead with typos over several types, sorted by the nested number', async function (assert) {
    let box = (typed: string, typos: boolean) => ({
      filter: {
        every: [
          { any: [{ type: brandRef }, { type: shopRef }, { type: guideRef }] },
          {
            prefix: true,
            scope: 'title',
            matches: typed,
            ...(typos ? { typos: true } : {}),
          },
        ],
      },
      sort: [{ on: cardRef, by: 'cardInfo.metrics.score', direction: 'desc' }],
      page: { size: 12 },
    });
    // A fully typed misspelling: "studoi" is one swap from "studio", which
    // is in Studio Nine (65) and Lampworks Studio (50).
    await returns(assert, box('studoi', false), [], 'without typos', false);
    await returns(
      assert,
      box('studoi', true),
      ['nine', 'lampworks'],
      'a swap, corrected',
      false,
    );
    await returns(
      assert,
      box('lampwroks', true),
      ['lampworks'],
      'another swap',
      false,
    );
    // "Each word keeps its prefix match": with the flag, a prefix finds
    // what it finds without it. No closed-shop exclusion here, so Old Lamp
    // Shop (95) leads.
    let lam = [
      'closed',
      'lamport',
      'lamplight',
      'choosing',
      'lampworks',
      'care',
    ];
    await returns(assert, box('lam', false), lam, 'a prefix', false);
    await returns(assert, box('lam', true), lam, 'the same prefix', false);
    // A corrected word and a prefix together.
    await returns(
      assert,
      box('studoi lam', true),
      ['lampworks'],
      'a misspelling, then a prefix',
      false,
    );
    await returns(assert, box('xyzzyq', true), [], 'nothing close', false);
    // A memo is never suggested, and neither is the brand with no name.
    await returns(assert, box('memo', true), [], 'another type', false);
  });

  // ---- pattern ------------------------------------------------------------

  const glob = (pattern: Record<string, string>) => ({ on, pattern });
  const HAS_SKU = where((item) => item.sku !== undefined);
  const STRUCTURED = where((item) =>
    /^[A-Z]{3}-\d{4}-[A-Z]{2}$/.test(item.sku ?? ''),
  );

  test('pattern: a glob is over the whole value', async function (assert) {
    await keeps(assert, glob({ sku: 'LMP' }), [], 'a fragment');
    await keeps(assert, glob({ sku: 'LMP-0001' }), [], 'a start');
    await keeps(assert, glob({ sku: '0001-BR' }), [], 'an end');
    await keeps(assert, glob({ sku: 'LMP-0001-BR' }), ['lamp'], 'the value');
    await keeps(assert, glob({ sku: 'LMP-*' }), LAMPS, 'a start, then any');
    await keeps(assert, glob({ sku: '*-BR' }), BRASS, 'any, then an end');
    await keeps(
      assert,
      glob({ sku: '*-0001-*' }),
      where((item) => /-0001-/.test(item.sku ?? '')),
      'any on both sides',
    );
  });

  test('pattern: * is any run, ? is exactly one character', async function (assert) {
    await keeps(assert, glob({ sku: '*' }), HAS_SKU, 'any value at all');
    await keeps(assert, glob({ sku: 'LMP-000?-??' }), LAMPS, 'three ?');
    await keeps(assert, glob({ sku: 'LMP-000?-BR' }), ['lamp'], 'one ?');
    await keeps(assert, glob({ sku: 'LMP-000?' }), [], '? is not a run');
    await keeps(assert, glob({ sku: 'x?' }), ['plain'], 'x and one more');
    await keeps(assert, glob({ sku: '??' }), ['plain'], 'any two characters');
    await keeps(assert, glob({ sku: 'LMP*BR' }), ['lamp'], '* in the middle');
    await keeps(
      assert,
      glob({ sku: 'LMP-0001-BR*' }),
      ['lamp'],
      '* may be empty',
    );
    await keeps(
      assert,
      glob({ sku: '???-????-??' }),
      STRUCTURED,
      'a shape in ? alone',
    );
  });

  test('pattern: ignores case', async function (assert) {
    await keeps(assert, glob({ sku: 'lmp-*' }), LAMPS, 'lower case');
    await keeps(assert, glob({ sku: 'Lmp-0001-br' }), ['lamp'], 'mixed case');
    await keeps(assert, glob({ sku: 'AXB-*' }), ['underx'], 'upper for lower');
  });

  test('pattern: every character but * and ? is itself', async function (assert) {
    // The values hold the wildcards of SQL's LIKE (% and _), its escape (\)
    // and a regular expression's class brackets; in a glob none of them
    // means anything.
    await keeps(assert, glob({ sku: '100%-wool' }), ['pct'], '% is a percent');
    await keeps(assert, glob({ sku: '100%*' }), ['pct'], '% before a *');
    await keeps(assert, glob({ sku: 'a_b*' }), ['under'], '_ is an underscore');
    await keeps(assert, glob({ sku: 'a?b*' }), ['under', 'underx'], '? is one');
    await keeps(assert, glob({ sku: '*c\\d' }), ['under'], 'a backslash');
    await keeps(assert, glob({ sku: '[x]y' }), ['bracket'], 'brackets');
    await keeps(assert, glob({ sku: '[a-z]y' }), [], 'not a character class');
    await keeps(assert, glob({ sku: 'x.' }), [], 'a dot is a dot');
    await keeps(assert, glob({ sku: '(xy)' }), [], 'parentheses');
    await keeps(assert, glob({ sku: 'xy|100X-wool' }), [], 'no alternation');
  });

  test('pattern on a list field: some element matches, whole', async function (assert) {
    await keeps(assert, glob({ codes: 'B-2*' }), ['lamp', 'shoes'], 'a start');
    await keeps(assert, glob({ codes: 'A-100' }), ['lamp'], 'a first element');
    await keeps(assert, glob({ codes: 'B-200' }), ['lamp'], 'a later element');
    await keeps(assert, glob({ codes: 'a-10?' }), ['lamp', 'lamps'], 'case, ?');
    // The elements are values of their own, not one joined string.
    await keeps(assert, glob({ codes: 'A-100*B-200' }), [], 'across elements');
    await keeps(assert, glob({ codes: 'A-100?B-200' }), [], 'one between');
    await keeps(
      assert,
      glob({ codes: '*' }),
      ['knocker', 'lamp', 'lamps', 'shoes'],
      'any element',
    );
    await keeps(assert, glob({ codes: 'LMP-*' }), [], 'another field’s value');
  });

  test('pattern under not', async function (assert) {
    let valued = async (filter: Record<string, any>) =>
      Promise.all(
        forms({ filter }).map(async ([form, query]) => ({
          form,
          got: (await names(query)).sort(),
        })),
      );
    for (let { form, got } of await valued({
      on,
      not: { pattern: { sku: 'LMP-*' } },
    })) {
      assert.deepEqual(
        got.filter((n) => n !== 'bare'),
        HAS_SKU.filter((n) => !LAMPS.includes(n)),
        `every card whose stock code is something else (${form})`,
      );
      // pins current behavior; rule not yet decided: a card with no value is
      // returned neither by the pattern nor by its `not`, as a comparison
      // with a missing value is everywhere else.
      assert.false(
        got.includes('bare'),
        `no stock code, not returned (${form})`,
      );
    }
    for (let { form, got } of await valued({
      on,
      not: { pattern: { codes: 'A-*' } },
    })) {
      // "`not` … finds the cards with no [matching element], a card with no
      // [elements] among them": every card less the two with an A code,
      // whether its list is empty or it has none.
      assert.deepEqual(got, except('lamp', 'lamps'), `no A code (${form})`);
    }
  });

  test('pattern with another filter, in every and in any', async function (assert) {
    await keeps(
      assert,
      { on, every: [glob({ sku: '*-TK' }), { on, eq: { kind: 'garden' } }] },
      ['bench'],
      'ends in TK, in the garden',
    );
    await keeps(
      assert,
      { on, every: [glob({ sku: 'LMP-*' }), glob({ codes: 'A-*' })] },
      ['lamp', 'lamps'],
      'two patterns',
    );
    await keeps(
      assert,
      { on, pattern: { sku: 'LMP-*', codes: 'B-*' } },
      ['lamp'],
      'two fields in one pattern: both',
    );
    await keeps(
      assert,
      { any: [glob({ sku: 'LMP-*' }), matches('brass')] },
      [...new Set([...LAMPS, ...BRASS])],
      'a pattern or a word',
    );
    await keeps(
      assert,
      { any: [glob({ sku: 'zzz*' }), { on, eq: { kind: 'travel' } }] },
      ['theater'],
      'a pattern that finds nothing, or a kind',
    );
  });

  // ---- regex --------------------------------------------------------------

  const regex = (pattern: Record<string, string>) => ({ on, regex: pattern });

  test('regex: anchors, and a match anywhere without them', async function (assert) {
    await keeps(assert, regex({ sku: '^LMP' }), LAMPS, 'a start');
    await keeps(assert, regex({ sku: 'BR$' }), BRASS, 'an end');
    await keeps(assert, regex({ sku: 'MP-000' }), LAMPS, 'unanchored');
    await keeps(assert, regex({ sku: '^LMP-0001-BR$' }), ['lamp'], 'both ends');
    await keeps(assert, regex({ sku: '^MP' }), [], 'not at the start');
    await keeps(assert, regex({ sku: '^xy$' }), ['plain'], 'a whole value');
  });

  test('regex: classes, counts and alternatives', async function (assert) {
    await keeps(
      assert,
      regex({ sku: '^LMP-000[12]-' }),
      ['lamp', 'lamps'],
      'a class',
    );
    await keeps(
      assert,
      regex({ sku: '-(BR|TK)$' }),
      [...BRASS, 'bench', 'poster'],
      'alternatives',
    );
    await keeps(
      assert,
      regex({ sku: '^[A-Z]{3}-\\d{4}-[A-Z]{2}$' }),
      STRUCTURED,
      'a whole shape',
    );
    await keeps(
      assert,
      regex({ sku: '^[^A-Z]' }),
      ['bracket', 'pct', 'pctx', 'plain', 'under', 'underx'],
      'a negated class',
    );
    await keeps(assert, regex({ sku: '^.y$' }), ['plain'], 'a dot is any one');
  });

  test('regex: case-sensitive', async function (assert) {
    await keeps(assert, regex({ sku: '^lmp' }), [], 'lower for upper');
    await keeps(assert, regex({ sku: '^axb' }), [], 'lower for mixed');
    await keeps(assert, regex({ sku: '^aXb' }), ['underx'], 'as written');
    // Postgres's own embedded option turns it off.
    await keeps(assert, regex({ sku: '(?i)^lmp' }), LAMPS, 'asked to ignore');
  });

  test('regex: literal characters', async function (assert) {
    await keeps(assert, regex({ sku: '%' }), ['pct', 'under'], 'a percent');
    await keeps(assert, regex({ sku: '_' }), ['under'], 'an underscore');
    await keeps(assert, regex({ sku: '^\\[x\\]y$' }), ['bracket'], 'brackets');
    await keeps(assert, regex({ sku: 'c\\\\d$' }), ['under'], 'a backslash');
    await keeps(
      assert,
      regex({ sku: '^100.-wool$' }),
      ['pct', 'pctx'],
      'a dot',
    );
  });

  test('regex on a list field: some element matches', async function (assert) {
    await keeps(assert, regex({ codes: '^B-2' }), ['lamp', 'shoes'], 'a start');
    await keeps(
      assert,
      regex({ codes: '^A-100$' }),
      ['lamp'],
      'a whole element',
    );
    await keeps(
      assert,
      regex({ codes: '0$' }),
      ['knocker', 'lamp', 'shoes'],
      'an end',
    );
    await keeps(assert, regex({ codes: 'A-100.B-200' }), [], 'across elements');
    await keeps(
      assert,
      regex({ codes: '^A-100.*B-200$' }),
      [],
      'across, anchored',
    );
  });

  test('regex under not, and with another filter', async function (assert) {
    for (let [form, query] of forms({
      filter: { on, not: { regex: { sku: '^[A-Z]{3}-' } } },
    })) {
      let got = (await names(query)).sort();
      assert.deepEqual(
        got.filter((n) => n !== 'bare'),
        ['bracket', 'pct', 'pctx', 'plain', 'under', 'underx'],
        `every stock code of another shape (${form})`,
      );
      // pins current behavior; rule not yet decided (see pattern under not)
      assert.false(
        got.includes('bare'),
        `no stock code, not returned (${form})`,
      );
    }
    await keeps(
      assert,
      {
        on,
        every: [regex({ sku: 'BR$' }), { on, range: { price: { lt: 40 } } }],
      },
      ['hook', 'knocker'],
      'in every',
    );
    await keeps(
      assert,
      { any: [regex({ sku: '^TBL' }), matches('knocker')] },
      ['cafe', 'knocker'],
      'in any',
    );
    await keeps(
      assert,
      { on, every: [regex({ sku: '^LMP' }), glob({ sku: '*-ST' })] },
      ['floor'],
      'a regex and a glob',
    );
  });

  test('regex: a malformed expression is refused with a code', async function (assert) {
    // A refusal carries a code a caller can act on; a database error does
    // not, and reads to the caller as a server fault.
    for (let bad of ['(', '[a-', 'a{2,1}', '*abc', '\\']) {
      for (let field of ['sku', 'codes']) {
        let error = await failure({ filter: regex({ [field]: bad }) });
        assert.true(
          error instanceof InvalidQueryError,
          `${field} ~ ${JSON.stringify(bad)} is refused as an invalid query: ${String(
            (error as Error | undefined)?.message ?? 'no error at all',
          ).slice(0, 160)}`,
        );
        assert.strictEqual(
          (error as InvalidQueryError | undefined)?.code,
          'invalid-value',
          `${field} ~ ${JSON.stringify(bad)} has a code`,
        );
      }
    }
    // The index is still answering.
    assert.deepEqual(
      (await names({ filter: regex({ sku: '^LMP' }) })).sort(),
      LAMPS,
    );
  });

  // ---- relative dates -----------------------------------------------------

  const listed = (bounds: Record<string, string>) => ({
    on,
    range: { listedAt: bounds },
  });
  const ships = (bounds: Record<string, string>) => ({
    on,
    range: { shipsOn: bounds },
  });

  test('a range reads now-<n>d on each side of the line', async function (assert) {
    // Listed 2 hours, 3 days, 20 days, 45 days and 400 days ago, and one
    // two days from now.
    await keeps(
      assert,
      listed({ gte: 'now-30d' }),
      ['floor', 'lamp', 'lamps', 'shoes'],
      'in the last thirty days, or later',
    );
    await keeps(
      assert,
      listed({ lt: 'now-30d' }),
      ['hook', 'knocker'],
      'before that',
    );
    await keeps(
      assert,
      listed({ gte: 'now-30d', lte: 'now' }),
      ['floor', 'lamp', 'lamps'],
      'in the last thirty days, up to now',
    );
    await keeps(
      assert,
      listed({ gte: 'now-1y', lt: 'now-1w' }),
      ['floor', 'knocker'],
      'a week to a year ago',
    );
    await keeps(assert, listed({ lt: 'now-2y' }), [], 'before any listing');
  });

  test('a range reads hours, now alone, and a time ahead', async function (assert) {
    await keeps(
      assert,
      listed({ gte: 'now-6h' }),
      ['lamp', 'shoes'],
      'in the last six hours, or later',
    );
    await keeps(
      assert,
      listed({ gte: 'now-6h', lte: 'now' }),
      ['lamp'],
      'in the last six hours',
    );
    await keeps(
      assert,
      listed({ lte: 'now' }),
      ['floor', 'hook', 'knocker', 'lamp', 'lamps'],
      'up to now',
    );
    await keeps(assert, listed({ gt: 'now' }), ['shoes'], 'after now');
    await keeps(assert, listed({ gt: 'now+1w' }), [], 'more than a week ahead');
    await keeps(
      assert,
      listed({ gt: 'now', lt: 'now+1w' }),
      ['shoes'],
      'in the coming week',
    );
    await keeps(
      assert,
      listed({ gte: 'now-90m' }),
      ['shoes'],
      'in the last ninety minutes, or later',
    );
  });

  test('a relative bound on a date field compares calendar days', async function (assert) {
    // Ships 3, 20, 45 and 400 days ago.
    await keeps(assert, ships({ gte: 'now-30d' }), ['lamp', 'lamps'], 'recent');
    await keeps(
      assert,
      ships({ lt: 'now-30d' }),
      ['floor', 'knocker'],
      'older',
    );
    await keeps(assert, ships({ gte: 'now-1w' }), ['lamp'], 'this past week');
    await keeps(
      assert,
      ships({ gte: 'now-2M', lt: 'now-1w' }),
      ['floor', 'lamps'],
      'a week to two months ago',
    );
  });

  test('a relative date beside other filters', async function (assert) {
    await keeps(
      assert,
      {
        on,
        every: [listed({ gte: 'now-30d' }), { on, eq: { kind: 'home' } }],
      },
      ['lamp', 'lamps'],
      'recent, at home',
    );
    await keeps(
      assert,
      { any: [listed({ lt: 'now-1y' }), matches('knocker')] },
      ['hook', 'knocker'],
      'over a year old, or a knocker',
    );
    await keeps(
      assert,
      { on, every: [matches('lamp'), { on, not: listed({ gte: 'now-1w' }) }] },
      ['floor'],
      'a lamp not listed this week',
    );
  });

  test('a malformed relative date on a date-time field is refused', async function (assert) {
    // A bound that starts like a relative date but is not one (cut short, an
    // unknown unit, no amount, upper case) is refused with invalid-value,
    // naming the field and the bound, rather than compared as text.
    for (let bound of ['now-', 'now+3x', 'now-d', 'NOW-30d']) {
      for (let [form, query] of forms({ filter: listed({ gte: bound }) })) {
        let error: any = await failure(query);
        assert.strictEqual(
          error?.code,
          'invalid-value',
          `"${bound}" is refused (${form})`,
        );
        let message = String(error?.message);
        let named = message.includes('listedAt') && message.includes(bound);
        assert.true(
          named,
          `the message names the field and the bound (${form}): ${message}`,
        );
      }
    }
  });

  test('a bound that does not start like a relative date is a literal', async function (assert) {
    // A word is compared as text, and is not refused. Every stored time
    // starts with a digit, which sorts before a letter, so none is at or
    // after such a bound.
    for (let bound of ['yesterday']) {
      for (let [form, query] of forms({ filter: listed({ gte: bound }) })) {
        let error = await failure(query);
        assert.strictEqual(error, undefined, `"${bound}" runs (${form})`);
        if (!error) {
          assert.deepEqual(
            await names(query),
            [],
            `"${bound}" is after every time, as text (${form})`,
          );
        }
      }
    }
  });
});
