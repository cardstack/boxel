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
  assertQuery,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
  type SearchText,
} from '@cardstack/runtime-common';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// Search intent on Postgres (docs/search-intent.md): the render's
// role-tiered `_searchText` becomes the row's weighted `search_tsv`, relevance
// ranks a title word above the same word in body text, `scope: 'title'` reads
// the title tier alone, and `_relevance` blends text with the type's declared
// ranking signals.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const talkRef = ref(`${testRealm}talk`, 'Talk');

const talkDef: Definition = {
  type: 'card-def',
  codeRef: talkRef,
  displayName: 'Talk',
  fields: { title: 'f0', text: 'f1', hnScore: 'f2', lastDiscussed: 'f3' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
      search: { role: 'title' },
    },
    f1: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
      search: { role: 'body' },
    },
    f2: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: numberRef,
      serializerName: 'number',
      search: { rank: 'popularity' },
    },
    f3: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: numberRef,
      serializerName: 'number',
    },
  },
  search: { rank: { recency: 'lastDiscussed' } },
} as Definition;

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      if (codeRef.module === talkRef.module && codeRef.name === talkRef.name) {
        return talkDef;
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

const url = (name: string) => `${testRealm}Talk/${name}.json`;

interface TalkData {
  title: string;
  text: string;
  hnScore: number;
  lastDiscussed: number;
}

// What the render stamps for these roles: the title at A, the body at D.
function searchTextFor(data: TalkData): SearchText {
  return { A: data.title, D: data.text };
}

const corpus: Record<string, TalkData> = {
  // "compiler" only in the body, three times.
  parsing: {
    title: 'Parsing expression grammars',
    text: 'a compiler front end; the compiler reads tokens; every compiler parses',
    hnScore: 50,
    lastDiscussed: 100,
  },
  // "compiler" once, in the title.
  compilers: {
    title: 'Compilers explained',
    text: 'lexing, parsing and code generation',
    hnScore: 10,
    lastDiscussed: 300,
  },
  // No "compiler" at all.
  gardens: {
    title: 'Rock gardens',
    text: 'raking gravel',
    hnScore: 30,
    lastDiscussed: 200,
  },
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
    await index(corpus);
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  async function index(cards: Record<string, TalkData>) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    for (let [name, data] of Object.entries(cards)) {
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
        searchData: { ...data, [SEARCH_TEXT_KEY]: searchTextFor(data) },
        markdown: `# ${data.title}\n\n${data.text}`,
        deps: new Set(),
        displayNames: ['Talk'],
        types: [talkKey],
        isolatedHtml: `<div>${name}</div>`,
      });
    }
    await batch.done();
  }

  async function ids(query: Query) {
    let { cards } = await engine.searchCards(new URL(testRealm), query);
    return cards.map((card) => String(card.id).split('/').pop());
  }

  const on = talkRef;

  test('the stored row keeps the weighted vector, not the tiered text', async function (assert) {
    let [row] = (await adapter.execute(
      `SELECT search_doc, ts_filter(search_tsv, '{a}')::text AS title_words,
              ts_filter(search_tsv, '{d}')::text AS body_words
         FROM boxel_index WHERE url = $1 AND type = 'instance'`,
      { bind: [url('compilers')], coerceTypes: { search_doc: 'JSON' } },
    )) as {
      search_doc: Record<string, unknown>;
      title_words: string;
      body_words: string;
    }[];
    assert.false(
      SEARCH_TEXT_KEY in row.search_doc,
      'the promoted doc has no tiered text',
    );
    assert.strictEqual(row.search_doc.title, 'Compilers explained');
    assert.true(
      row.title_words.includes("'compil'"),
      `the title's words carry weight A: ${row.title_words}`,
    );
    assert.true(
      row.body_words.includes("'generat'"),
      `the body's words carry weight D: ${row.body_words}`,
    );
    assert.false(
      row.body_words.includes("'compil'"),
      `a title word is not in the body tier: ${row.body_words}`,
    );
  });

  test('a word in a title outranks the same word repeated in the body', async function (assert) {
    assert.deepEqual(
      await ids({
        filter: { on, matches: 'compiler' },
        sort: [{ by: '_matchRelevance' }],
      }),
      ['compilers.json', 'parsing.json'],
    );
  });

  test("scope: 'title' matches title words only", async function (assert) {
    assert.deepEqual(
      await ids({ filter: { on, matches: 'compiler', scope: 'title' } }),
      ['compilers.json'],
    );
    assert.deepEqual(
      await ids({ filter: { on, matches: 'gravel', scope: 'title' } }),
      [],
      'a body-only word does not match',
    );
  });

  test('_relevance with a matches term leads with text relevance', async function (assert) {
    assert.deepEqual(
      await ids({
        filter: { on, matches: 'compiler' },
        sort: [
          {
            by: '_relevance',
            on,
            weights: { text: 1, recency: 0, popularity: 0 },
          },
        ],
      }),
      ['compilers.json', 'parsing.json'],
    );
  });

  test("_relevance without a term ranks by the type's declared signals", async function (assert) {
    assert.deepEqual(
      await ids({
        filter: { type: on },
        sort: [{ by: '_relevance', weights: { recency: 0 } }],
      }),
      ['parsing.json', 'gardens.json', 'compilers.json'],
      'popularity alone, by the field declared rank: popularity; the anchor comes from the filter',
    );
    assert.deepEqual(
      await ids({
        filter: { type: on },
        sort: [{ by: '_relevance', on, weights: { popularity: 0 } }],
      }),
      ['compilers.json', 'gardens.json', 'parsing.json'],
      'recency alone, by the static searchDefaults choice',
    );
    assert.deepEqual(
      await ids({
        filter: { type: on },
        sort: [
          { by: '_relevance', on, weights: { popularity: -1, recency: 0 } },
        ],
      }),
      ['compilers.json', 'gardens.json', 'parsing.json'],
      'a negative weight inverts a signal',
    );
  });

  test('_relevance with nothing to rank by is refused', async function (assert) {
    await assert.rejects(
      engine.searchCards(new URL(testRealm), {
        sort: [{ by: '_relevance' }],
      }),
      /nothing to rank by/,
    );
  });

  test('the wire grammar checks _relevance and scope', function (assert) {
    assert.throws(
      () =>
        assertQuery({
          sort: [{ by: '_relevance', weights: { fame: 1 } }],
        }),
      (err: unknown) =>
        err instanceof InvalidQueryError && /unknown signal/.test(err.message),
    );
    assert.throws(
      () =>
        assertQuery({
          sort: [{ by: '_blend', of: [{ by: '_relevance' }] }],
        }),
      /cannot contain a relevance sort/,
    );
    assert.throws(
      () => assertQuery({ filter: { matches: 'x', scope: 'body' } }),
      /scope must be "title"/,
    );
    assert.throws(
      () => assertQuery({ filter: { eq: { title: 'x' }, scope: 'title' } }),
      /scope belongs beside matches/,
    );
  });
});
