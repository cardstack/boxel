import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  VectorSerializer,
  VirtualNetwork,
  collectSpillRefs,
  hasVectorIndex,
  internalKeyFor,
  isSpillMarker,
  rri,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';
import { withFacetFields } from './helpers/facet-fields.ts';

// Spilling end to end on Postgres: a large search doc is promoted with its
// large values spilled into `boxel_index_spill`, and every query answers
// exactly as it does over the whole doc.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const vectorRef = ref('@cardstack/base/vector', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const booleanRef = ref('@cardstack/base/boolean', 'default');
const talkRef = ref(`${testRealm}talk`, 'Talk');
const segmentRef = ref(`${testRealm}talk`, 'Segment');

const primitive = (
  fieldOrCard: ResolvedCodeRef,
  serializerName?: string,
  type: 'contains' | 'containsMany' = 'contains',
) => ({
  type,
  isPrimitive: true,
  isComputed: false,
  fieldOrCard,
  ...(serializerName ? { serializerName } : {}),
});

const segmentDef: Definition = {
  type: 'field-def',
  codeRef: segmentRef,
  displayName: 'Segment',
  fields: { text: 'f0', embedding: 'f1', start: 'f2' },
  fieldDefs: {
    f0: primitive(stringRef),
    f1: primitive(vectorRef, 'vector'),
    f2: primitive(numberRef, 'number'),
  },
} as Definition;

const talkDef: Definition = {
  type: 'card-def',
  codeRef: talkRef,
  displayName: 'Talk',
  fields: {
    title: 'f0',
    text: 'f0',
    summary: 'f6',
    hnScore: 'f1',
    isDuplicate: 'f2',
    tags: 'f3',
    segments: 'f4',
    embedding: 'f5',
  },
  fieldDefs: {
    f0: primitive(stringRef),
    f1: primitive(numberRef, 'number'),
    // The facets count `tags`, `isDuplicate` and `summary`, so they are
    // declared, as a facet must be.
    f2: { ...primitive(booleanRef, 'boolean'), search: { facet: true } },
    f3: {
      ...primitive(stringRef, undefined, 'containsMany'),
      search: { facet: true },
    },
    f4: {
      type: 'containsMany',
      isPrimitive: false,
      isComputed: false,
      fieldOrCard: segmentRef,
    },
    f5: primitive(vectorRef, 'vector'),
    f6: { ...primitive(stringRef), search: { facet: true } },
  },
} as Definition;

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      for (let def of [talkDef, segmentDef]) {
        let defRef = def.codeRef as ResolvedCodeRef;
        if (defRef.module === codeRef.module && defRef.name === codeRef.name) {
          return def;
        }
      }
      throw new Error(
        `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
      );
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

const { encodeVector, queryableValue } = VectorSerializer;
const vec = (components: number[]) => queryableValue(encodeVector(components));
const url = (name: string) => `${testRealm}Talk/${name}.json`;
const words = (seed: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${seed}${i % 7}`).join(' ');
const longText = (topic: string) =>
  `${topic} ${words('lorem', 120)} closing remarks on ${topic}`;

function talk(
  name: string,
  topic: string,
  hnScore: number,
  opts: { duplicate?: boolean; direction?: number[] } = {},
) {
  let direction = opts.direction ?? [1, 0, 0];
  return {
    title: `${name} talk`,
    text: longText(topic),
    summary: `about ${topic}`,
    hnScore,
    isDuplicate: opts.duplicate ?? false,
    tags: Array.from({ length: 70 }, (_, i) => `${topic}-tag-${i}`),
    embedding: vec(direction),
    segments: [
      {
        start: 0,
        text: `opening ${words(topic, 60)}`,
        embedding: vec(direction),
      },
      { start: 60, text: `a short ${topic} aside`, embedding: vec([0, 0, 1]) },
      {
        start: 120,
        text: `deep dive into ${topic} ${words('ipsum', 60)}`,
        embedding: vec([0, 1, 0]),
      },
    ],
  };
}

const corpus = {
  rust: talk('rust', 'ownership', 30, { direction: [1, 0, 0] }),
  go: talk('go', 'goroutines', 10, { direction: [0, 1, 0] }),
  zig: talk('zig', 'comptime', 20, { duplicate: true, direction: [1, 1, 0] }),
  tiny: { title: 'tiny talk', text: 'short', hnScore: 5, isDuplicate: false },
};

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;
  let engine: IndexQueryEngine;
  let talkKey: string;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    engine = new IndexQueryEngine(
      adapter,
      makeDefinitionLookup(),
      virtualNetwork,
    );
    talkKey = internalKeyFor(talkRef, undefined, virtualNetwork);
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  async function index(
    cards: Record<string, Record<string, unknown>>,
    opts: { spill: boolean; deleted?: string[] },
  ) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false, spillSearchDocs: opts.spill },
    );
    for (let [name, searchData] of Object.entries(cards)) {
      let cardURL = new URL(url(name));
      await batch.updateEntry(cardURL, {
        type: 'instance',
        resource: {
          id: rri(cardURL.href),
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: { module: rri(talkRef.module), name: 'Talk' } },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        // Stamped with the type's facet fields, as the render stamps them:
        // the writer builds the facet rows from this staged doc, before
        // its large values spill.
        searchData: await withFacetFields(
          searchData,
          talkDef,
          makeDefinitionLookup(),
        ),
        markdown: String(searchData.text ?? ''),
        deps: new Set(),
        displayNames: ['Talk'],
        types: [talkKey],
        isolatedHtml: `<div>${name}</div>`,
      });
    }
    if (opts.deleted?.length) {
      await batch.invalidate(opts.deleted.map((name) => new URL(url(name))));
    }
    await batch.done();
  }

  async function storedDoc(name: string) {
    let [row] = (await adapter.execute(
      `SELECT search_doc, pg_column_size(search_doc) AS size FROM boxel_index WHERE url = $1 AND type = 'instance'`,
      { bind: [url(name)], coerceTypes: { search_doc: 'JSON' } },
    )) as { search_doc: Record<string, unknown>; size: number }[];
    return row;
  }

  async function spillRows(name?: string) {
    return (await adapter.execute(
      `SELECT ref, url, field_path, ordinal, value FROM boxel_index_spill
       ${name ? 'WHERE url = $1' : ''} ORDER BY url, field_path, ordinal`,
      { bind: name ? [url(name)] : [], coerceTypes: { value: 'JSON' } },
    )) as {
      ref: string;
      url: string;
      field_path: string;
      ordinal: number;
      value: unknown;
    }[];
  }

  const on = talkRef;
  const queries: Record<string, Query> = {
    'contains on a spilled string': {
      filter: { on, contains: { text: 'goroutines' } },
    },
    'contains on a word only the spilled tail holds': {
      filter: { on, contains: { text: 'closing remarks on comptime' } },
    },
    'eq on a whole spilled string': {
      filter: { on, eq: { text: longText('ownership') } },
    },
    'eq on a short string': {
      filter: { on, eq: { summary: 'about ownership' } },
    },
    'in on short strings': {
      filter: { on, in: { summary: ['about goroutines', 'about comptime'] } },
    },
    'not eq on a boolean beside spilled values': {
      filter: { on, not: { eq: { isDuplicate: true } } },
    },
    'range on a number': { filter: { on, range: { hnScore: { gt: 15 } } } },
    'eq on a member of a spilled list': {
      filter: { on, eq: { tags: 'comptime-tag-69' } },
    },
    'contains through a containsMany into spilled text': {
      filter: {
        on,
        contains: { 'segments.text': 'deep dive into goroutines' },
      },
    },
    'eq through a containsMany on an inline value': {
      filter: { on, eq: { 'segments.text': 'a short ownership aside' } },
    },
    'null test does not match a spilled value': {
      filter: { on, eq: { text: null } },
    },
    'sort by a number': {
      filter: { type: on },
      sort: [{ on, by: 'hnScore', direction: 'desc' }],
    },
    'sort by a spilled string': {
      filter: { type: on },
      sort: [{ on, by: 'text', direction: 'asc' }],
    },
    'near on a spilled top-level vector': {
      filter: { type: on },
      sort: [{ on, by: 'embedding', near: [1, 0, 0] }],
    },
    'near on spilled vectors in a containsMany': {
      filter: { type: on },
      sort: [{ on, by: 'segments.embedding', near: [0, 1, 0] }],
    },
    'paged search with a total': {
      filter: { on, not: { eq: { isDuplicate: true } } },
      sort: [{ on, by: 'hnScore', direction: 'desc' }],
      page: { size: 1, number: 1 },
    },
  };

  async function answers(vectors: boolean) {
    let out: Record<string, unknown> = {};
    for (let [label, query] of Object.entries(queries)) {
      if (!vectors && label.startsWith('near')) {
        continue;
      }
      let { cards, meta } = await engine.searchCards(new URL(testRealm), query);
      out[label] = {
        ids: cards.map((c) => c.id),
        total: meta.page.total,
      };
    }
    let { meta } = await engine.searchCards(new URL(testRealm), {
      filter: { type: on },
      facets: [{ by: 'tags', size: 3 }],
    });
    out['facet over a spilled list'] = meta.facets;
    return out;
  }

  test('a large doc is promoted with its large values spilled', async function (assert) {
    await index(corpus, { spill: true });

    let rust = await storedDoc('rust');
    assert.true(isSpillMarker(rust.search_doc.text), 'the long text spilled');
    assert.true(isSpillMarker(rust.search_doc.tags), 'the long list spilled');
    assert.true(isSpillMarker(rust.search_doc.embedding), 'the vector spilled');
    assert.strictEqual(rust.search_doc.hnScore, 30, 'numbers stay inline');
    assert.strictEqual(rust.search_doc.summary, 'about ownership');
    let segments = rust.search_doc.segments as Record<string, unknown>[];
    assert.true(isSpillMarker(segments[0].text));
    assert.strictEqual(segments[1].text, 'a short ownership aside');
    assert.true(
      rust.size < 2000,
      `the promoted doc fits inline (${rust.size} bytes stored)`,
    );

    let tiny = await storedDoc('tiny');
    assert.deepEqual(
      collectSpillRefs(tiny.search_doc),
      [],
      'a small doc is whole',
    );

    let rows = await spillRows('rust');
    assert.deepEqual(
      rows.map((r) => r.ref).sort(),
      collectSpillRefs(rust.search_doc).sort(),
      'every marker has its row, and no row lacks a marker',
    );
    assert.deepEqual(
      rows.find((r) => r.field_path === 'text')?.value,
      corpus.rust.text,
      'a row holds the original value',
    );

    let [pending] = (await adapter.execute(
      `SELECT COUNT(*) AS n FROM boxel_index_pending`,
    )) as { n: string }[];
    assert.strictEqual(Number(pending.n), 0, 'staging is cleared');
  });

  test('every query answers the same over a spilled doc as over the whole doc', async function (assert) {
    let vectors = await hasVectorIndex(adapter);
    await index(corpus, { spill: false });
    assert.deepEqual(await spillRows(), [], 'nothing spills when it is off');
    let whole = await answers(vectors);

    await index(corpus, { spill: true });
    assert.ok((await spillRows()).length > 0, 'the reindex spilled');
    let spilled = await answers(vectors);

    for (let label of Object.keys(whole)) {
      assert.deepEqual(spilled[label], whole[label], label);
    }
    assert.ok(
      (whole['contains on a spilled string'] as { ids: string[] }).ids.length >
        0,
      'the battery matches something',
    );
  });

  test('a reindex replaces spill rows, and a delete removes them', async function (assert) {
    await index(corpus, { spill: true });
    let before = await spillRows('go');

    let changed = { ...corpus.go, text: longText('channels') };
    await index({ go: changed }, { spill: true });
    let after = await spillRows('go');
    assert.deepEqual(
      after.map((r) => r.ref),
      before.map((r) => r.ref),
      'the same positions keep their refs',
    );
    assert.deepEqual(
      after.find((r) => r.field_path === 'text')?.value,
      changed.text,
      'the value is the new one',
    );
    let { cards } = await engine.searchCards(new URL(testRealm), {
      filter: { on: talkRef, contains: { text: 'goroutines' } },
    });
    assert.deepEqual(
      cards.map((c) => c.id),
      [],
      'the old text no longer matches',
    );

    await index({}, { spill: true, deleted: ['go'] });
    assert.deepEqual(await spillRows('go'), [], 'a deleted card keeps none');
    assert.ok((await spillRows('rust')).length > 0, 'other cards keep theirs');
  });

  test('a paged search counts the same facets as an unpaged one, spilled values included', async function (assert) {
    await index(corpus, { spill: true });
    let realm = new URL(testRealm);
    let facets = [
      { by: 'tags', size: 4 },
      { by: 'isDuplicate' },
      { by: 'summary', size: 2 },
    ];
    for (let filter of [
      { type: talkRef },
      { on: talkRef, not: { eq: { isDuplicate: true } } },
      { on: talkRef, contains: { text: 'goroutines' } },
      { on: talkRef, eq: { summary: 'no such talk' } },
    ]) {
      // An unpaged search counts each facet in its own query.
      let unpaged = await engine.searchCards(realm, { filter, facets });
      for (let number of [0, 1, 5]) {
        let paged = await engine.searchCards(realm, {
          filter,
          facets,
          sort: [{ on: talkRef, by: 'hnScore', direction: 'desc' }],
          page: { size: 1, number },
        });
        let label = `${JSON.stringify(filter)} page ${number}`;
        assert.deepEqual(
          paged.meta.facets,
          unpaged.meta.facets,
          `${label}: facets`,
        );
        assert.strictEqual(
          paged.meta.page.total,
          unpaged.meta.page.total,
          `${label}: total`,
        );
      }
      assert.strictEqual(
        unpaged.meta.page.total,
        unpaged.cards.length,
        'an unpaged total is its row count',
      );
    }
    // docs/search.md (Refusals): a facet on a name the query's type lacks,
    // that no card of the type holds, is unknown-field, paged or not. (Only
    // a query anchored on no type, or on the base card type, reads any name.)
    for (let page of [undefined, { size: 1, number: 0 }]) {
      await assert.rejects(
        engine.searchCards(realm, {
          filter: { type: talkRef },
          facets: [{ by: 'nowhere' }],
          ...(page ? { page } : {}),
        }),
        (e: any) => e?.code === 'unknown-field',
        `a facet on a field Talk lacks is unknown-field (${page ? 'paged' : 'unpaged'})`,
      );
    }
    let { meta } = await engine.searchCards(realm, {
      filter: { type: talkRef },
      facets: [{ by: 'tags', size: 2 }],
      page: { size: 2 },
    });
    assert.strictEqual(
      meta.facets?.tags?.length,
      2,
      'a spilled list is counted, to the requested size',
    );
  });

  test('an error row carries the whole doc forward, not dangling markers', async function (assert) {
    await index(corpus, { spill: true });
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false, spillSearchDocs: true },
    );
    let brokenURL = new URL(url('rust'));
    await batch.updateEntry(brokenURL, {
      type: 'instance-error',
      error: {
        id: brokenURL.href,
        status: 500,
        title: 'broken',
        message: 'a render that failed',
        additionalErrors: null,
      },
    } as any);
    await batch.done();

    let rust = await storedDoc('rust');
    let refs = collectSpillRefs(rust.search_doc);
    assert.ok(refs.length > 0, 'the carried doc is spilled again');
    let rows = await spillRows('rust');
    assert.deepEqual(
      rows.map((r) => r.ref).sort(),
      refs.sort(),
      'every marker resolves',
    );
    assert.deepEqual(
      rows.find((r) => r.field_path === 'text')?.value,
      corpus.rust.text,
      'with the last good values',
    );
  });
});
